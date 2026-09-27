# EchoTrace — Production Implementation Plan

**Observability & QA layer for ElevenLabs voice agents**

---

## 1. Problem Statement & Scope

Companies deploying ElevenAgents/Speech Engine voice agents have no visibility into agent behavior at scale: script drift, hallucinated claims, compliance violations, latency spikes, and sentiment trends are invisible until a customer complains. EchoTrace ingests call data and gives ops/support teams a dashboard + alerting layer to catch this — reliably, at scale, and multi-tenant.

**Production scope (v1 GA), vs. the earlier hackathon MVP:**
- Durable, at-least-once ingestion with backpressure handling (webhook spikes, retries, replay)
- Horizontally scalable analysis workers, decoupled from ingestion via a real queue
- Multi-tenant from day one (org isolation at the data and auth layer)
- Cost-controlled LLM-as-judge pipeline (caching, sampling, budget guardrails)
- Alerting with proper dedup, escalation policies, and delivery guarantees
- Observability of EchoTrace itself (metrics, tracing, logs, SLOs)
- Deployed as multiple independently scalable services, not a single unit

**Still deliberately out of scope for v1:** live call-barging/intervention, fine-tuned custom drift-detection models (LLM-as-judge remains the default), full self-serve billing (metering yes, billing UI later).

---

## 2. Architecture Overview

```
                     ElevenLabs Agent Calls
                              │
                              ▼
                  ┌───────────────────────┐
                  │  Ingestion Service     │  (stateless, horizontally scaled)
                  │  - webhook receiver    │
                  │  - HMAC verification   │
                  │  - idempotency check   │
                  └──────────┬────────────┘
                              │  writes raw payload to blob/object storage
                              │  enqueues job (call_id, payload ref)
                              ▼
                  ┌───────────────────────┐
                  │   Redis (Streams)      │  ingest queue + consumer groups
                  │   + Dead Letter Stream │
                  └──────────┬────────────┘
                              ▼
                  ┌───────────────────────┐
                  │  Normalization Workers │  (pool, auto-scaled)
                  │  raw → CallRecord      │
                  └──────────┬────────────┘
                              ▼
                  ┌───────────────────────┐        ┌────────────────────┐
                  │   Postgres (primary)   │◀──────▶│  Redis (cache)      │
                  │   calls / contracts     │        │  - contract cache    │
                  └──────────┬────────────┘        │  - rule-check cache  │
                              │                      │  - dedup keys        │
                              ▼                      └────────────────────┘
                  ┌───────────────────────┐
                  │  Rule-Check Workers     │  (cheap, run first, no LLM)
                  └──────────┬────────────┘
                              │  only unresolved/ambiguous calls proceed
                              ▼
                  ┌───────────────────────┐
                  │  Redis (Streams)        │  llm-judge queue (separate,
                  │  llm-judge-queue        │  rate/cost isolated from ingest)
                  └──────────┬────────────┘
                              ▼
                  ┌───────────────────────┐
                  │  LLM-Judge Workers      │  (concurrency-limited,
                  │  Claude API, JSON mode  │   token-budget aware, retries)
                  └──────────┬────────────┘
                              ▼
                  ┌───────────────────────┐        ┌────────────────────┐
                  │  Metrics Store          │──────▶│  Alerting Service   │
                  │  Postgres + rollups     │        │  Redis-backed dedup │
                  │  (or Timescale later)   │        │  Slack/PagerDuty    │
                  └──────────┬────────────┘        └────────────────────┘
                              ▼
                  ┌───────────────────────┐
                  │  API Layer (read)       │  cached hot paths via Redis
                  └──────────┬────────────┘
                              ▼
                  ┌───────────────────────┐
                  │  Dashboard (UI)         │
                  └───────────────────────┘
```

**Key production shift from the MVP:** every stage is a separate, independently scalable, independently deployable service communicating over Redis Streams (or a managed equivalent), not an in-process call chain. This means a spike in webhook volume or a slow LLM provider never backs up ingestion, and any single worker type can be scaled or restarted without downtime elsewhere.

---

## 3. Data Ingestion Layer

### A. Webhook receiver
- Stateless service behind a load balancer, horizontally scaled (Kubernetes HPA on CPU + queue depth, or equivalent).
- Endpoint: `POST /webhooks/elevenlabs/call-complete`
- **HMAC signature verification** on every request; reject unsigned/invalid immediately, log to a security audit stream.
- **Idempotency:** dedupe on `call_id` using a Redis `SET NX` with a TTL (e.g. 24h) so retried webhooks from ElevenLabs don't double-process. Return 200 immediately on a known duplicate.
- **Never process inline.** Persist the raw payload to object storage (S3-compatible) first, then push a lightweight job (`{call_id, payload_ref, received_at}`) onto a Redis Stream. This decouples "did we durably receive it" from "did we finish processing it" — if a downstream worker crashes mid-processing, the raw payload isn't lost.
- Respond to the webhook within the ElevenLabs timeout window (target < 500ms p99) — anything slower risks ElevenLabs treating it as a failed delivery and retrying, compounding load.

### B. MCP client (near-real-time / pull-based)
- Separate long-running service (not on the request path of the webhook receiver) that polls or subscribes to active agent sessions via MCP.
- Publishes partial-call events onto their own Redis Stream (`live-events`) so in-progress-call flagging doesn't compete with post-call processing for the same consumer group.
- Should degrade gracefully: if MCP connectivity drops, fall back to webhook-only mode without losing post-call analysis.

### Queueing choice: Redis Streams (with upgrade path)
- **Why Redis Streams over a simple list/pub-sub:** consumer groups give you at-least-once delivery, per-consumer acknowledgment, and automatic redelivery of unacked messages (`XPENDING`/`XCLAIM`) if a worker dies mid-job — critical for not silently dropping calls.
- **Dead-letter handling:** after N delivery attempts (e.g. 5) with exponential backoff, move the message to a `*-dlq` stream instead of retrying forever. Alert if the DLQ depth grows.
- **Upgrade path:** if volume outgrows a single Redis instance's throughput/durability guarantees, the same consumer-group pattern maps cleanly onto Kafka or a managed queue (SQS + a Kinesis-like stream) later — don't over-invest in Redis-specific features that block that migration.
- Run Redis with AOF persistence enabled (or a managed Redis with durability guarantees) — an in-memory-only queue is a data-loss risk for anything beyond a demo.

### CallRecord schema (core fields — unchanged from MVP, plus tenancy)
```json
{
  "org_id": "string",
  "call_id": "string",
  "agent_id": "string",
  "timestamp": "ISO8601",
  "duration_sec": "number",
  "transcript": [
    {
      "speaker": "agent|user",
      "text": "string",
      "timestamp_offset": "number",
      "audio_tags": ["whispers", "..."]
    }
  ],
  "end_reason": "completed|escalated|dropped",
  "audio_ref": "url or blob ref (optional, for spot-checking)",
  "schema_version": "number"
}
```
`org_id` and `schema_version` are the two fields the MVP schema didn't need but production does: multi-tenant isolation and safe schema evolution as the payload shape changes.

---

## 4. Storage Layer

- **Transcript/raw data:** Postgres (JSONB column) for structured/queryable fields; raw webhook payloads land in object storage (S3-compatible) first, referenced by URL — don't put large blobs in Postgres rows.
- **Metrics/aggregates:** Postgres to start, with pre-aggregated rollup tables (hourly/daily) refreshed by a scheduled job, so the dashboard never scans raw `call_scores` for trend charts. Move to a time-series store (TimescaleDB, or a managed equivalent) once rollup-table maintenance becomes a bottleneck — don't adopt one prematurely.
- **Read scaling:** a read replica for the dashboard's read-heavy queries, separate from the write path used by ingestion/analysis, so a slow dashboard query never contends with call processing.
- **Audio:** object storage, org-scoped buckets/prefixes, lifecycle policy to expire/archive after a retention window (compliance-driven — see Section 9).
- **Redis usage (distinct from the queue):**
  - Script-contract cache (contracts change rarely, read on every call — cache with a short TTL and invalidate on contract update)
  - Rule-check dedup/result cache
  - Webhook idempotency keys
  - Alert dedup keys (Section 6)
  - Rate-limit counters for the LLM-judge budget (Section 5b)

### Tables (additions over MVP)
- `orgs` (tenant record, plan/quota)
- `calls` (raw record, `org_id` foreign key, indexed)
- `call_scores` (per-call analysis output — drift_score, compliance_flags, sentiment, `judge_model_version`)
- `script_contracts` (versioned, `org_id` scoped)
- `alerts` (triggered alerts, status, acknowledged_by, `org_id` scoped)
- `processing_audit` (append-only log of each call's pipeline stage transitions — for debugging "why wasn't this call flagged")
- All tenant-scoped tables get row-level security or an equivalent enforced-at-the-query-layer tenant filter — never rely on application code alone to filter by `org_id`.

---

## 5. Analysis Engine — the core differentiator

### 5a. Script Contract definition
Same shape as MVP, now versioned and org-scoped, cached in Redis, invalidated on write:
```json
{
  "org_id": "string",
  "agent_id": "string",
  "version": "number",
  "required_disclosures": ["This call may be recorded", "..."],
  "banned_phrases": ["I guarantee", "..."],
  "expected_flow": ["greeting", "identify_issue", "resolution_offer", "closing"],
  "tone_target": "professional, empathetic"
}
```
Every `call_scores` row records which contract `version` it was scored against, so contract edits don't retroactively change the meaning of historical scores.

### 5b. LLM-as-judge scoring pipeline — cost- and reliability-hardened
This is the part that breaks first under real load if built naively. Production hardening on top of the MVP design:

- **Separate queue, separate worker pool.** LLM-judge workers pull from their own Redis Stream, isolated from ingestion/rule-check workers, so a slow or rate-limited LLM provider never backs up webhook receiving.
- **Concurrency + token-budget limiting.** Track in-flight LLM calls and daily token spend per org in Redis (`INCR` with TTL). Throttle or queue-and-delay once an org nears its budget rather than failing calls outright.
- **Caching identical/near-identical judge calls.** If the same transcript segment (or a very similar one, hashed) has already been judged under the same contract version, skip the LLM call and reuse the cached verdict — real deployments see repeated call patterns (FAQ-style calls) constantly.
- **Retries with backoff + circuit breaker.** Transient API errors get retried (bounded); sustained provider outages trip a circuit breaker that routes calls to "rule-checks only, flagged for delayed LLM review" rather than queuing indefinitely.
- **Structured output validation.** Force JSON mode, but also schema-validate the response before writing to `call_scores`; on validation failure, retry once with a stricter prompt, then fall back to a "needs manual review" state rather than writing malformed data.
- **Sampling for cost control at scale.** Once volume is high, consider judging 100% of calls with rule-checks but only a configurable sample (or all rule-flagged calls plus a random sample of clean ones) with the full LLM judge — tunable per org/plan tier.

### 5c. Rule-based fast checks (unchanged principle, now the real first line of defense)
- Regex/exact match on banned phrases, duration outliers, `end_reason == escalated` — run synchronously in a lightweight worker pool, no LLM cost.
- Results cached/stored so the LLM-judge stage can skip re-deriving them.
- This stage is what keeps the LLM bill sane: only calls that survive rule-checks without an obvious flag (or that are sampled) proceed to the LLM queue.

---

## 6. Alerting Layer

- Threshold-based: `drift_score > 0.7`, any banned-phrase hit, or a spike in an agent's flag rate over a rolling window.
- **Dedup via Redis:** before sending, `SET NX` a key like `alert:{org_id}:{agent_id}:{issue_type}` with a TTL matching the dedup window (e.g. 1 hour) — atomic, so concurrent alert workers can't double-send the same alert under load (a plain "check-then-send" without Redis has a race condition here).
- **Delivery:** Slack webhook as the fast/demo-friendly channel; add PagerDuty/email for production severity tiers (a compliance-flag alert and a "duration slightly high" alert shouldn't page the same way).
- **Delivery guarantees:** alert jobs go through their own Redis Stream too, with retry/DLQ — a failed Slack API call shouldn't silently drop the alert.
- Alert payload includes `call_id`, flagged issue, contract version, and a deep link to the dashboard timeline.

---

## 7. Dashboard (UI) & API Layer

**Two views, unchanged from MVP in spirit, now backed by cached/rolled-up data:**

### A. Aggregate view
- Cards (total calls, avg drift score, compliance flag rate, escalation rate) read from pre-computed rollups, not live aggregation over raw rows.
- Trend charts and the "agents ranked by flag rate" table use the same rollups, cached in Redis with a short TTL (e.g. 60s) to absorb dashboard refresh traffic without hitting Postgres on every load.

### B. Per-call timeline view
- Transcript rendered turn-by-turn, inline flag badges, sentiment overlay, audio-tag annotations — same as MVP.
- Fetched by `call_id` directly from Postgres (not cached — this view is low-traffic per record and needs to be current).

**API layer:** a stateless REST (or GraphQL) service, separate deployable from the workers, reading from the replica + Redis cache. Rate-limit per API key/org using the same Redis counter pattern as the LLM budget.

**Stack:** React + Tailwind + Recharts frontend (unchanged — it was already a reasonable choice); FastAPI or Node/Express API layer, now explicitly stateless and horizontally scaled behind a load balancer, no in-process queue or worker logic living inside it.

---

## 8. Tech Stack Summary

| Layer | Choice | Why (production lens) |
|---|---|---|
| Ingestion | Node/Express or FastAPI, stateless, N replicas | Fast to scale horizontally; no local state to lose on restart |
| Queue | **Redis Streams** (consumer groups, DLQ) | At-least-once delivery, crash-safe redelivery, isolates ingestion from slow downstream stages; clean upgrade path to Kafka/SQS if volume demands it |
| Cache | **Redis** (separate logical DBs/keyspaces from the queue) | Contract cache, idempotency keys, alert dedup, rate/budget limiting — all need atomic, fast, TTL'd state |
| Object storage | S3-compatible | Raw payloads, audio; cheap, durable, lifecycle-managed for retention |
| DB | Postgres (primary + read replica) | Transactional integrity for scores/alerts; replica isolates dashboard reads from write path |
| Analysis LLM | Claude API, structured JSON output, schema-validated | Reliable judge; validation + fallback state prevents malformed data from reaching users |
| Frontend | React + Tailwind + Recharts | Already fast to build a clean dashboard; unchanged |
| Alerts | Slack (default) + PagerDuty (severity-tiered) | Redis-backed dedup avoids alert fatigue and double-sends under concurrent load |
| Auth | Per-org API keys + row-level tenant isolation in Postgres | Multi-tenant from day one, not bolted on later |
| Deployment | Containerized services (K8s or equivalent), each stage independently scalable | Ingestion spikes, LLM slowness, and dashboard load never contend with each other |
| Observability | Structured logs, metrics (Prometheus-style), tracing across queue hops | You need to see EchoTrace's own health, not just the data it's collecting |

---

## 9. Operational Concerns (new — not present in the MVP plan)

- **Multi-tenancy:** every table tenant-scoped; every query path enforces `org_id` at the data layer, not just in application code.
- **Secrets management:** ElevenLabs webhook secrets, Claude API keys, Slack/PagerDuty tokens in a secrets manager (not env files committed anywhere), rotated on a schedule.
- **Data retention & compliance:** transcripts and audio may contain PII/customer data — define a retention window per org, automate expiry (S3 lifecycle rules, scheduled Postgres purges), and support a deletion request path.
- **Observability of EchoTrace itself:** queue depth per stream, consumer lag, LLM-judge error rate and latency, alert delivery success rate, DLQ growth — these need their own dashboards/alerts, or you find out EchoTrace is broken from a customer instead of a metric.
- **Backpressure and graceful degradation:** define explicit behavior for "LLM provider is down," "queue depth exceeds threshold," and "Postgres write path is saturated" — degrade to rule-checks-only or delayed processing rather than dropping calls or crashing ingestion.
- **CI/CD:** each service independently deployable and rollback-able; schema migrations run as a separate, reviewed step (especially for `script_contracts` versioning, which other code depends on).

---

## 10. Phase-Wise Implementation Plan

Each phase below has a goal, concrete tasks, deliverables, and exit criteria — the criteria that must be true before starting the next phase. Durations are engineering-time estimates for a small team (2-4 engineers); adjust for team size.

### Phase 0 — Foundations & Environment Setup (~3-5 days)
**Goal:** nothing below can start safely without this in place.
- Provision cloud accounts/projects, container registry, and a K8s cluster (or equivalent: ECS, Cloud Run) with separate `dev` / `staging` / `prod` environments.
- Stand up managed Postgres and managed Redis instances for `dev` (AOF/durability on for Redis even in dev, to catch persistence bugs early).
- Set up object storage buckets with per-environment prefixes.
- Set up secrets manager (Vault, AWS Secrets Manager, or equivalent); no secrets in env files or repo from day one.
- Initialize CI pipeline: lint, test, build, push image on every PR; block merge on failure.
- Define the multi-tenant `org_id` convention and write the row-level-security policy template before any table is created.

**Deliverables:** working CI pipeline, provisioned dev environment, secrets manager wired up, an `orgs` table with RLS policy as the reference pattern.
**Exit criteria:** a "hello world" service can be deployed to `dev` through CI, read a secret, and write a tenant-scoped row to Postgres.

---

### Phase 1 — Durable Ingestion (~1.5-2 weeks)
**Goal:** never lose a call, even under retry storms or partial outages.
- Build the webhook receiver service: `POST /webhooks/elevenlabs/call-complete`, HMAC signature verification, structured error responses.
- Implement idempotency via Redis `SET NX` keyed on `call_id`, TTL'd.
- Persist raw payload to object storage before any processing; store only the object reference downstream.
- Stand up the Redis Streams ingest queue with a consumer group; implement the DLQ stream and retry/backoff policy.
- Build normalization workers: raw payload → validated `CallRecord`, written to Postgres (`calls` table, `org_id` + `schema_version` populated).
- Write the multi-tenant Postgres schema (`orgs`, `calls`, `script_contracts` skeleton) with RLS enforced, not just app-layer filtering.
- Load-test the webhook endpoint for burst traffic (simulate retry storms) and confirm p99 response time target (<500ms) holds.
- Instrument from day one: request logs, queue depth metric, consumer lag metric.

**Deliverables:** deployed ingestion service + normalization workers in `staging`, populated `calls` table from synthetic + (if available) real ElevenLabs test traffic, DLQ dashboard.
**Exit criteria:** replaying the same webhook 100x produces exactly one `calls` row; killing a normalization worker mid-job results in the message being redelivered and processed exactly once downstream; queue depth and DLQ depth are visible on a dashboard.

---

### Phase 2 — Rule-Based Checks + Basic Dashboard (~1.5-2 weeks)
**Goal:** cheap, reliable flagging live end-to-end before any LLM cost is introduced.
- Build rule-check workers: banned-phrase regex/exact match, duration-outlier detection, `end_reason == escalated` flag.
- Write results to `call_scores` (rule-only fields populated; LLM fields null/pending).
- Build `script_contracts` CRUD (API + minimal UI), versioned, org-scoped, cached in Redis with invalidation on write.
- Build the alerting service: threshold checks on rule-based flags, Redis `SET NX` dedup, Slack webhook delivery, alert jobs routed through their own Redis Stream with retry/DLQ.
- Build the dashboard's two core views against **real pipeline data** (not synthetic): aggregate cards/table (direct queries are fine at this stage, rollups come in Phase 4) and the per-call timeline view with inline flag badges.
- Basic per-org API key auth on the read API.

**Deliverables:** working dashboard in `staging` showing live-flagged calls; Slack alerts firing correctly with no duplicates under concurrent load; contract edit reflected in scoring within one cache TTL window.
**Exit criteria:** a seeded "bad call" (banned phrase, escalated) is visible in the dashboard and produces exactly one Slack alert within the target latency, even when the rule-check stage is intentionally run with multiple concurrent workers.

---

### Phase 3 — LLM-Judge Pipeline (~2-3 weeks)
**Goal:** the core differentiator, hardened against cost and reliability failure modes from the start.
- Stand up the isolated `llm-judge-queue` Redis Stream and worker pool, separate from ingestion/rule-check workers.
- Write the judge prompt template: flow-checklist scoring, banned-phrase semantic check, hallucination/unverifiable-claim flagging, sentiment trajectory, tone match — structured JSON output only.
- Implement schema validation on the LLM response; on failure, retry once with a stricter prompt, then fall back to a `needs_manual_review` state.
- Implement per-org concurrency and token-budget limiting via Redis counters; throttle/queue-and-delay near budget rather than hard-failing.
- Implement response caching for identical/near-identical transcript segments (hash-based) under the same contract version.
- Implement a circuit breaker: sustained LLM provider errors route calls to "rule-checks only, flagged for delayed review" instead of piling up in the queue.
- Wire `call_scores` LLM fields (drift_score, compliance_flags, sentiment, `judge_model_version`) and surface them in the dashboard timeline (sentiment overlay, tone-drift badges).
- Extend alerting thresholds to include `drift_score` and LLM-flagged compliance issues.

**Deliverables:** end-to-end flow from call → rule-check → LLM judge → `call_scores` → dashboard/alert, running in `staging` against real or realistic transcripts; a documented and tested fallback path for provider outages.
**Exit criteria:** intentionally taking the LLM provider offline in `staging` results in calls degrading to "rule-checks only, pending review" rather than queue buildup or dropped calls; a deliberately malformed LLM response does not corrupt `call_scores`; repeated identical transcripts don't trigger duplicate LLM spend (verified via cache-hit metric).

---

### Phase 4 — Scale Hardening (~1.5-2 weeks)
**Goal:** confirm the system holds up at realistic production volume, not just in functional testing.
- Add a Postgres read replica; point all dashboard/API reads at it, keep writes on primary.
- Build the rollup job (hourly/daily aggregates) and switch aggregate dashboard views to read from rollups instead of raw tables.
- Add Redis-backed caching (short TTL) on the aggregate API responses to absorb dashboard refresh/poll traffic.
- Run a load test simulating peak expected call volume (e.g. Xx normal daily volume in a burst) against ingestion; confirm queue depth recovers within a defined SLO after the burst.
- Run a soak test (sustained load over hours) on the LLM-judge pipeline to validate budget limiting and cache hit rates hold up, not just in a short burst.
- Verify DLQ monitoring/alerting is itself alerting correctly (test by deliberately forcing a message to fail repeatedly).

**Deliverables:** load-test report with measured p50/p99 latencies and recovery times at target scale; rollup-backed dashboard confirmed faster under load than the Phase 2 direct-query version.
**Exit criteria:** ingestion sustains the target burst volume without exceeding the defined queue-depth SLO or dropping messages; dashboard p99 load time stays within target under simulated concurrent dashboard users.

---

### Phase 5 — Operational Maturity & Launch Readiness (~1.5-2 weeks, can overlap with Phase 4)
**Goal:** the system is safe to operate, not just functionally complete.
- Build observability dashboards for EchoTrace itself: queue depth and consumer lag per stream, LLM-judge error rate/latency, alert delivery success rate, DLQ growth trend.
- Wire alerting on EchoTrace's own health metrics (e.g. DLQ depth exceeding a threshold, consumer lag growing unbounded) — separate channel from customer-facing alerts.
- Implement data retention automation: object storage lifecycle rules, scheduled Postgres purge jobs, and a documented deletion-request path per org.
- Finalize secrets rotation policy and confirm rotating a key doesn't require a redeploy.
- Write and rehearse the runbook for the top 3-5 failure modes (LLM provider outage, Redis unavailability, Postgres failover, DLQ backlog).
- Confirm CI/CD supports independent rollback of any single service, and that schema migrations (especially `script_contracts` versioning) run as a reviewed, separate step from application deploys.
- Security review: verify RLS is enforced at the query layer (attempt a cross-org query and confirm it's blocked even with a valid but wrong-org API key).

**Deliverables:** operational runbook, health dashboards live in `prod`, retention automation verified against a test org's data, a passed cross-tenant access test.
**Exit criteria:** the team can answer "is EchoTrace healthy right now" from a dashboard without querying application logs; a simulated LLM outage and a simulated Redis restart are both handled per the runbook without data loss or a paged customer-facing alert; go/no-go review completed for `prod` launch.

---

### Summary Timeline

| Phase | Focus | Est. Duration |
|---|---|---|
| 0 | Foundations & environment setup | 3-5 days |
| 1 | Durable ingestion | 1.5-2 weeks |
| 2 | Rule-based checks + basic dashboard | 1.5-2 weeks |
| 3 | LLM-judge pipeline | 2-3 weeks |
| 4 | Scale hardening | 1.5-2 weeks |
| 5 | Operational maturity & launch readiness | 1.5-2 weeks (overlaps Phase 4) |

**Total: roughly 8-11 weeks** for a small team to go from zero to a production-ready v1, versus the original 12-hour hackathon MVP scope. Phases 1-3 are sequential (each depends on the last); Phases 4 and 5 can run partially in parallel once Phase 3 is functionally complete.

---

## 11. Demo/Launch Narrative (unchanged core, now backed by real resilience)

> *"An ElevenLabs agent made a policy claim it wasn't authorized to make, mid-call. EchoTrace caught it within seconds, flagged it, and alerted the ops team — before the customer ever escalated. And it kept catching that pattern reliably at 10,000 calls/day without dropping a single one or paging the team over noise."*

The second sentence is the production pitch on top of the original hackathon story: not just "it works," but "it works under load, without losing data, and without becoming an alert-fatigue problem itself."

---

## 12. Next Steps — Drafted

### 12a. LLM-Judge Prompt Template & Schema

**System prompt:**
```
You are a call-quality judge for a voice-agent observability system.
You will be given a call transcript and a script contract. Score the
call strictly against the contract. Respond with ONLY a single JSON
object — no preamble, no markdown fences, no explanation outside the
JSON. If a field cannot be determined, use null and explain why in
the corresponding "*_notes" field.
```

**User message template:**
```
CONTRACT (version {contract_version}):
{contract_json}

TRANSCRIPT:
{transcript_turns}

Score this call against the contract. Return JSON matching exactly
this schema:

{
  "flow_checklist": {
    "<stage_name>": { "hit": boolean, "turn_index": number|null }
  },
  "banned_phrase_hits": [
    { "phrase": string, "turn_index": number, "match_type": "exact"|"semantic" }
  ],
  "unverifiable_claims": [
    { "turn_index": number, "claim": string, "confidence": number }
  ],
  "sentiment": {
    "start": number,
    "end": number,
    "trajectory_notes": string
  },
  "tone_match": {
    "target": string,
    "observed": string,
    "match_score": number
  },
  "drift_score": number,
  "drift_score_notes": string
}
```
- `drift_score` is a single 0.0-1.0 rollup the alerting layer thresholds against; define its exact weighting formula (e.g. weighted sum of missed flow stages + banned-phrase hits + tone mismatch) as a versioned constant so historical scores stay interpretable if the formula changes later.
- `unverifiable_claims[].confidence` lets you tune how aggressively the system flags hallucinations vs. false positives without changing the prompt.

**Schema validation rules (applied before writing to `call_scores`):**
- Reject if top-level JSON doesn't parse, or any required key is missing.
- `sentiment.start`/`end` and `tone_match.match_score` must be numeric and within `[-1, 1]` / `[0, 1]` respectively — clamp or reject out-of-range values.
- `flow_checklist` keys must exactly match the contract's `expected_flow` array (a mismatch usually means the model paraphrased a stage name — reject and retry once with a reminder to use exact keys).
- On any validation failure after one retry: write a `call_scores` row with `status = 'needs_manual_review'` and the raw model output preserved for debugging, rather than dropping the call.

---

### 12b. Postgres DDL (core tables, with row-level security)

```sql
-- Tenancy
CREATE TABLE orgs (
  org_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  plan_tier   TEXT NOT NULL DEFAULT 'standard',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw call records
CREATE TABLE calls (
  call_id         TEXT NOT NULL,
  org_id          UUID NOT NULL REFERENCES orgs(org_id),
  agent_id        TEXT NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  duration_sec    NUMERIC NOT NULL,
  transcript      JSONB NOT NULL,
  end_reason      TEXT NOT NULL CHECK (end_reason IN ('completed','escalated','dropped')),
  audio_ref       TEXT,
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, call_id)
);
CREATE INDEX idx_calls_org_agent_time ON calls (org_id, agent_id, occurred_at DESC);

-- Versioned script contracts
CREATE TABLE script_contracts (
  org_id                UUID NOT NULL REFERENCES orgs(org_id),
  agent_id              TEXT NOT NULL,
  version               INT NOT NULL,
  required_disclosures  JSONB NOT NULL DEFAULT '[]',
  banned_phrases        JSONB NOT NULL DEFAULT '[]',
  expected_flow         JSONB NOT NULL,
  tone_target           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, agent_id, version)
);

-- Per-call analysis output
CREATE TABLE call_scores (
  org_id              UUID NOT NULL,
  call_id             TEXT NOT NULL,
  contract_version    INT NOT NULL,
  drift_score         NUMERIC,
  compliance_flags    JSONB NOT NULL DEFAULT '[]',
  sentiment           JSONB,
  judge_model_version TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','scored','needs_manual_review','rule_checks_only')),
  scored_at           TIMESTAMPTZ,
  PRIMARY KEY (org_id, call_id),
  FOREIGN KEY (org_id, call_id) REFERENCES calls (org_id, call_id)
);

-- Alerts
CREATE TABLE alerts (
  alert_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(org_id),
  call_id         TEXT NOT NULL,
  issue_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low','normal','high')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  acknowledged_by TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pipeline audit trail
CREATE TABLE processing_audit (
  org_id      UUID NOT NULL,
  call_id     TEXT NOT NULL,
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL,
  detail      JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Row-level security (applied per tenant-scoped table):**
```sql
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_calls ON calls
  USING (org_id = current_setting('app.current_org_id')::UUID);

-- Repeat the same pattern for call_scores, script_contracts, alerts, processing_audit.
```
The application sets `app.current_org_id` at the start of every connection/transaction (from the authenticated API key), so even a bug in application-layer filtering can't leak cross-org data — the database itself refuses the row.

---

### 12c. Redis Streams Consumer-Group Configuration

| Stream | Consumer Group | Consumers | Claim/Retry Policy | DLQ Threshold |
|---|---|---|---|---|
| `ingest-raw` | `normalize-workers` | auto-scaled pool | Unacked >30s → `XCLAIM` to another consumer; max 5 delivery attempts | Move to `ingest-raw-dlq` after 5 attempts, exponential backoff (1s, 5s, 30s, 2m, 10m) between attempts |
| `rule-check-queue` | `rule-check-workers` | fixed small pool (cheap, fast) | Unacked >10s → reclaim | 3 attempts, then `rule-check-dlq` |
| `llm-judge-queue` | `llm-judge-workers` | concurrency-capped per org (Redis counter) | Unacked >120s → reclaim (LLM calls can be slow) | 5 attempts with backoff (5s, 30s, 2m, 10m, 30m); on provider outage, circuit breaker reroutes to `rule-checks-only` path instead of retrying into DLQ |
| `alert-queue` | `alert-workers` | small fixed pool | Unacked >15s → reclaim | 5 attempts, then `alert-dlq` — DLQ growth on this stream pages on-call directly (a silently failing alert path is itself an incident) |
| `live-events` (MCP) | `live-event-workers` | small pool | Unacked >5s → reclaim (near-real-time, short-lived relevance) | 2 attempts, then drop with a metric increment (stale live events aren't worth DLQ-replaying) |

**Operational conventions:**
- Every consumer runs `XREADGROUP` with `NOACK` disabled — explicit `XACK` only after the job's side effects (DB write, etc.) are durably committed, so a crash between "read" and "commit" results in redelivery, not silent loss.
- A scheduled job runs `XPENDING` on each stream/group every minute to catch messages stuck longer than their claim threshold (covers the case where a consumer died without ever attempting `XCLAIM` itself).
- DLQ depth on every stream is scraped as a metric; alert when any DLQ grows by more than N messages in a 5-minute window, not just on absolute depth (catches active failures faster than a static threshold).

---

### 12d. Load-Testing Plan — Webhook Ingestion Path

**Objectives:** confirm the ingestion path meets its p99 latency target and never drops a webhook, even under retry-storm conditions where ElevenLabs re-sends on perceived timeout.

**Test scenarios:**
1. **Steady-state baseline** — sustained load at expected average daily volume spread evenly, confirm p50/p99 latency and zero errors.
2. **Burst load** — Nx the average rate in a short window (simulate a large customer's peak calling hours), confirm queue depth rises and drains within the defined SLO afterward, and p99 latency stays under the ElevenLabs timeout threshold throughout.
3. **Duplicate/retry storm** — replay the same set of webhook payloads multiple times concurrently, confirm idempotency holds (exactly one `calls` row per `call_id`, verified by direct DB count, not just by the response codes).
4. **Downstream slowdown** — artificially slow or pause the normalization workers while ingestion continues at baseline load, confirm the queue absorbs the backlog without the webhook receiver itself slowing down or erroring (this is the core "decoupling worked" test).
5. **Partial outage** — kill a subset of normalization workers mid-test, confirm in-flight messages are reclaimed and processed exactly once, with no gap in `calls` rows.

**Tooling:** a load-generation tool (k6, Locust, or Vegeta) driving synthetic webhook payloads with valid HMAC signatures against `staging`; Grafana/Prometheus (or equivalent) dashboards for real-time queue depth, consumer lag, and latency during each run.

**Pass/fail criteria:** documented per scenario before the test runs (e.g. "p99 < 500ms sustained," "zero duplicate `calls` rows across 3x replay," "queue drains to baseline within 10 minutes of burst ending") — these become the Phase 4 exit-criteria evidence, not just a one-off report.

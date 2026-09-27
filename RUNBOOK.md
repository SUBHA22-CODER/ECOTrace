# EchoTrace Operational Runbook

This document details incident handling procedures, health monitoring, and recovery runbooks for the EchoTrace production observability layer.

---

## 1. Top Incident Scenarios & Response Runbooks

### Incident A: LLM Provider API Outage / Sustained Rate Limiting
- **Symptom:** `llm-judge-queue` depth grows while latency increases; error logs report Anthropic/Claude API timeouts or `529 Overloaded`.
- **Automated Defense:**
  - EchoTrace's built-in **Circuit Breaker** automatically trips to `OPEN` after 3 consecutive failures.
  - Calls are routed automatically to `rule_checks_only` with a `needs_manual_review` flag without backing up ingestion or dropping calls.
- **Manual Intervention Runbook:**
  1. Inspect status: `GET /api/observability` and verify `circuit_breaker: "OPEN"`.
  2. Ingest stream continues unaffected at sub-5ms latency.
  3. Once the upstream LLM provider status recovers, the circuit breaker enters `HALF_OPEN` and auto-resumes full evaluation.
  4. Run delayed replay on backlog:
     ```bash
     node -e "require('./services/workers/llm-judge').llmJudgeWorker.reprocessReviewCalls()"
     ```

---

### Incident B: ElevenLabs Webhook Retry Storm
- **Symptom:** Ingestion requests spike 10x-50x due to network partition between ElevenLabs edge and cloud provider.
- **Automated Defense:**
  - Atomic Redis `SET NX` idempotency key `idempotency:webhook:{org_id}:{call_id}` with a 24-hour TTL acknowledges duplicates with `200 OK` within 2-5ms.
  - Zero duplicate rows are written to the `calls` table.
- **Verification Runbook:**
  ```bash
  node tests/load-test.js
  ```
  Confirm output: `Accepted: 1, Duplicate acknowledgments: 99`.

---

### Incident C: Dead Letter Queue (DLQ) Backlog Alert
- **Symptom:** Alert channel receives notification: `DLQ_BACKLOG_DETECTED on ingest-raw-dlq or alert-dlq`.
- **Investigation Runbook:**
  1. Check DLQ metrics on `/api/observability`.
  2. Inspect failed payloads and failure reasons:
     ```bash
     # Check DLQ stream entries
     docker exec -it echotrace-redis redis-cli XRANGE ingest-raw-dlq - + COUNT 10
     ```
  3. If failure was due to transient storage disconnect, trigger redelivery of DLQ messages into active consumer group.

---

### Incident D: Secret Rotation (Webhook Secret & API Keys)
- **Zero-Downtime Rotation:**
  - EchoTrace reads tenant secrets dynamically from `orgs.webhook_secret` with fallback to `process.env.ELEVENLABS_WEBHOOK_SECRET`.
  - Update the secret in database:
    ```sql
    UPDATE orgs SET webhook_secret = 'whsec_new_rotated_secret_key' WHERE org_id = '...';
    ```
  - No service restart or redeploy required.

---

## 2. Key Metrics & SLO Targets

| Metric | Target SLO | Alert Threshold |
|---|---|---|
| Webhook Response Time (p99) | `< 500ms` | `> 400ms` |
| Webhook Loss Rate | `0.00%` | `> 0 dropped calls` |
| Redis Streams Consumer Lag | `< 5000ms` | `> 30s` |
| DLQ Growth Rate | `0 msg/hr` | `> 3 msg in 5 min` |
| Alert Duplicate Suppression | `100% in 1h window` | `> 0 race duplicate` |

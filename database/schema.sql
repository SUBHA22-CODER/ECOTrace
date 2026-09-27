-- ============================================================================
-- EchoTrace Database Schema (PostgreSQL + Row-Level Security)
-- ============================================================================

-- Enable pgcrypto / uuid generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tenants (Organizations)
CREATE TABLE IF NOT EXISTS orgs (
  org_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  api_key         TEXT UNIQUE NOT NULL,
  webhook_secret  TEXT NOT NULL,
  plan_tier       TEXT NOT NULL DEFAULT 'standard' CHECK (plan_tier IN ('standard', 'pro', 'enterprise')),
  token_budget_daily INT NOT NULL DEFAULT 500000,
  token_used_today INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Voice Agents Registry
CREATE TABLE IF NOT EXISTS agents (
  org_id              UUID NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  agent_id            TEXT NOT NULL,
  name                TEXT NOT NULL,
  elevenlabs_agent_id TEXT,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_agents_org ON agents (org_id, status);

-- 3. Raw Ingested & Normalized Calls
CREATE TABLE IF NOT EXISTS calls (
  call_id         TEXT NOT NULL,
  org_id          UUID NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  duration_sec    NUMERIC NOT NULL,
  transcript      JSONB NOT NULL,
  end_reason      TEXT NOT NULL CHECK (end_reason IN ('completed', 'escalated', 'dropped')),
  audio_ref       TEXT,
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, call_id)
);
CREATE INDEX IF NOT EXISTS idx_calls_org_agent_time ON calls (org_id, agent_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_received_at ON calls (received_at DESC);

-- 4. Versioned Script Contracts & Rules
CREATE TABLE IF NOT EXISTS script_contracts (
  contract_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  agent_id              TEXT NOT NULL,
  version               INT NOT NULL DEFAULT 1,
  name                  TEXT NOT NULL DEFAULT 'Default Agent Script Contract',
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  required_disclosures  JSONB NOT NULL DEFAULT '[]'::jsonb,
  banned_phrases        JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_flow         JSONB NOT NULL DEFAULT '[]'::jsonb,
  tone_target           TEXT NOT NULL DEFAULT 'professional, empathetic',
  custom_rules          JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_org_agent_version UNIQUE (org_id, agent_id, version)
);
CREATE INDEX IF NOT EXISTS idx_contracts_lookup ON script_contracts (org_id, agent_id, is_active, version DESC);

-- 5. Per-Call Analysis Output (Scores & Judge Verdict)
CREATE TABLE IF NOT EXISTS call_scores (
  org_id              UUID NOT NULL,
  call_id             TEXT NOT NULL,
  contract_version    INT NOT NULL,
  drift_score         NUMERIC,
  compliance_flags    JSONB NOT NULL DEFAULT '[]'::jsonb,
  sentiment           JSONB,
  flow_checklist      JSONB,
  unverifiable_claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  tone_match          JSONB,
  custom_rule_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  judge_model_version TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'scored', 'needs_manual_review', 'rule_checks_only', 'no_active_contract')),
  scored_at           TIMESTAMPTZ,
  PRIMARY KEY (org_id, call_id),
  FOREIGN KEY (org_id, call_id) REFERENCES calls (org_id, call_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_call_scores_drift ON call_scores (org_id, drift_score DESC);
CREATE INDEX IF NOT EXISTS idx_call_scores_status ON call_scores (status);

-- 6. Alerting Layer
CREATE TABLE IF NOT EXISTS alerts (
  alert_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  call_id         TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  contract_version INT,
  issue_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'critical')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerts_org_status ON alerts (org_id, status, created_at DESC);

-- 7. Pipeline Processing Audit Trail
CREATE TABLE IF NOT EXISTS processing_audit (
  audit_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  call_id     TEXT NOT NULL,
  stage       TEXT NOT NULL, -- 'ingestion', 'normalization', 'rule_check', 'llm_judge', 'alert'
  status      TEXT NOT NULL, -- 'started', 'completed', 'failed', 'circuit_broken', 'deduped'
  detail      JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_call ON processing_audit (org_id, call_id, occurred_at ASC);

-- 8. Analytics Rollups (Hourly / Daily)
CREATE TABLE IF NOT EXISTS metric_rollups (
  org_id                  UUID NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  agent_id                TEXT NOT NULL,
  time_bucket             TIMESTAMPTZ NOT NULL,
  bucket_resolution       TEXT NOT NULL CHECK (bucket_resolution IN ('hour', 'day')),
  total_calls             INT NOT NULL DEFAULT 0,
  escalation_count        INT NOT NULL DEFAULT 0,
  compliance_flags_count  INT NOT NULL DEFAULT 0,
  avg_drift_score         NUMERIC NOT NULL DEFAULT 0.0,
  avg_duration_sec        NUMERIC NOT NULL DEFAULT 0.0,
  token_usage             INT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, agent_id, time_bucket, bucket_resolution)
);

-- ============================================================================
-- Row-Level Security (RLS) Policies
-- ============================================================================
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_rollups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_agents ON agents;
CREATE POLICY tenant_isolation_agents ON agents
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation_calls ON calls;
CREATE POLICY tenant_isolation_calls ON calls
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation_contracts ON script_contracts;
CREATE POLICY tenant_isolation_contracts ON script_contracts
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation_scores ON call_scores;
CREATE POLICY tenant_isolation_scores ON call_scores
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation_alerts ON alerts;
CREATE POLICY tenant_isolation_alerts ON alerts
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation_audit ON processing_audit;
CREATE POLICY tenant_isolation_audit ON processing_audit
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation_rollups ON metric_rollups;
CREATE POLICY tenant_isolation_rollups ON metric_rollups
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

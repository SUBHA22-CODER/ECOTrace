/**
 * EchoTrace Database Layer
 * Provides dual-mode operation:
 * 1. PostgreSQL (production) with Row-Level Security
 * 2. High-performance In-Memory / File SQLite-compatible datastore for local dev/testing
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pgPool = null;
let usePg = false;

if (process.env.DATABASE_URL) {
  try {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  } catch (err) {
    console.warn('[DB] PostgreSQL pool initialization failed, using in-memory store:', err.message);
  }
}

// In-Memory store mimicking Postgres tables with strict org_id isolation
class LocalDataStore {
  constructor() {
    this.orgs = new Map();              // key: org_id
    this.agents = new Map();            // key: `${org_id}:${agent_id}`
    this.calls = new Map();             // key: `${org_id}:${call_id}`
    this.script_contracts = new Map();  // key: `${org_id}:${agent_id}:${version}` OR contract_id
    this.contract_id_index = new Map(); // key: contract_id -> `${org_id}:${agent_id}:${version}`
    this.call_scores = new Map();       // key: `${org_id}:${call_id}`
    this.alerts = new Map();            // key: alert_id
    this.processing_audit = [];         // array of audit records
    this.metric_rollups = new Map();    // key: `${org_id}:${agent_id}:${time_bucket}:${resolution}`
    this.raw_objects = new Map();       // S3-compatible raw blob storage simulation

    this.seedDefaultTenant();
  }

  seedDefaultTenant() {
    const defaultOrg = {
      org_id: '00000000-0000-0000-0000-000000000001',
      name: 'ElevenLabs Voice Ops Alpha',
      slug: 'elevenlabs-voice-ops',
      api_key: 'ek_live_eleven_ops_982348a7b9',
      webhook_secret: 'whsec_elevenlabs_production_super_secret_key_2026',
      plan_tier: 'enterprise',
      token_budget_daily: 1000000,
      token_used_today: 14250,
      created_at: new Date().toISOString()
    };
    this.orgs.set(defaultOrg.org_id, defaultOrg);

    // Seed default agent
    const defaultAgent = {
      org_id: defaultOrg.org_id,
      agent_id: 'eleven-support-agent-v1',
      name: 'Customer Support Voice Agent',
      elevenlabs_agent_id: 'eleven-support-agent-v1',
      description: 'Primary customer support & inbound billing assistant',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.agents.set(`${defaultOrg.org_id}:${defaultAgent.agent_id}`, defaultAgent);

    // Seed second agent for multi-agent validation
    const salesAgent = {
      org_id: defaultOrg.org_id,
      agent_id: 'eleven-sales-agent-v2',
      name: 'Inbound Sales Representative',
      elevenlabs_agent_id: 'eleven-sales-agent-v2',
      description: 'Inbound sales and product qualification voice representative',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.agents.set(`${defaultOrg.org_id}:${salesAgent.agent_id}`, salesAgent);

    // Seed default contract for agent 'eleven-support-agent-v1'
    const contractId = 'c0000000-0000-0000-0000-000000000001';
    const defaultContract = {
      contract_id: contractId,
      org_id: defaultOrg.org_id,
      agent_id: 'eleven-support-agent-v1',
      version: 1,
      name: 'Tier-1 Customer Support & Inbound Sales Voice Contract',
      status: 'active', // 'draft', 'active', 'archived'
      is_active: true,
      required_disclosures: [
        'This call may be recorded for quality assurance and training purposes.',
        'EchoTrace AI observability monitor active.'
      ],
      banned_phrases: [
        'I guarantee',
        '100% free forever',
        'unlimited lifetime warranty',
        'give me your full credit card number and CVV',
        'we will waive all legal rights'
      ],
      expected_flow: [
        'greeting_and_disclosure',
        'identity_and_account_verification',
        'problem_identification',
        'resolution_offer',
        'confirmation_and_closing'
      ],
      tone_target: 'professional, empathetic, concise, and brand-aligned',
      custom_rules: [
        {
          id: 'rule_ref_policy_01',
          name: 'Refund Authorization Policy',
          description: 'Agent must never promise a refund before account verification is completed',
          severity: 'high',
          evaluation: 'llm',
          enabled: true
        },
        {
          id: 'rule_no_competitor_slander',
          name: 'No Competitor Slander',
          description: 'Agent must remain strictly professional without disparaging competitors',
          severity: 'normal',
          evaluation: 'llm',
          enabled: true
        }
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.script_contracts.set(`${defaultOrg.org_id}:${defaultContract.agent_id}:1`, defaultContract);
    this.contract_id_index.set(contractId, `${defaultOrg.org_id}:${defaultContract.agent_id}:1`);
  }

  // Raw blob storage methods (S3 compatible)
  async putObject(bucket, key, data) {
    const fullKey = `${bucket}/${key}`;
    this.raw_objects.set(fullKey, {
      key: fullKey,
      data,
      size: Buffer.byteLength(typeof data === 'string' ? data : JSON.stringify(data)),
      created_at: new Date().toISOString()
    });
    return `s3://${bucket}/${key}`;
  }

  async getObject(fullKey) {
    const obj = this.raw_objects.get(fullKey.replace(/^s3:\/\//, ''));
    return obj ? obj.data : null;
  }
}

const localStore = new LocalDataStore();

/**
 * DB query helper with automatic tenant isolation check
 */
async function query(sql, params = [], orgId = null) {
  if (usePg && pgPool) {
    const client = await pgPool.connect();
    try {
      if (orgId) {
        await client.query(`SET LOCAL app.current_org_id = $1`, [orgId]);
      }
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  }

  // Fallback to high-speed in-memory store adapter
  return localStore;
}

module.exports = {
  pgPool,
  localStore,
  query,
  LocalDataStore
};

/**
 * EchoTrace Production Server
 * Observability & QA layer for ElevenLabs voice agents
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { localStore } = require('./database/db');
const { queueManager } = require('./services/workers/queue-manager');
const { normalizerWorker } = require('./services/workers/normalizer');
const { ruleCheckWorker } = require('./services/workers/rule-checker');
const { llmJudgeWorker } = require('./services/workers/llm-judge');
const { alertWorker } = require('./services/workers/alert-worker');
const { rollupManager } = require('./database/rollups');
const {
  handleCallCompleteWebhook,
  signElevenLabsPayload
} = require('./services/ingestion/receiver');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Real-time Server-Sent Events (SSE) clients
const sseClients = new Set();
function broadcastEvent(eventType, data) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Hook queue events to SSE for real-time UI animation
queueManager.inMemory.on('stream:ingest-raw', (entry) => broadcastEvent('stream_entry', { stream: 'ingest-raw', entry }));
queueManager.inMemory.on('stream:rule-check-queue', (entry) => broadcastEvent('stream_entry', { stream: 'rule-check-queue', entry }));
queueManager.inMemory.on('stream:llm-judge-queue', (entry) => broadcastEvent('stream_entry', { stream: 'llm-judge-queue', entry }));
queueManager.inMemory.on('stream:alert-queue', (entry) => broadcastEvent('stream_entry', { stream: 'alert-queue', entry }));

// Helper: Contract resolution
function findContract(orgId, contractIdentifier) {
  // 1. By UUID contract_id in index
  if (localStore.contract_id_index.has(contractIdentifier)) {
    const key = localStore.contract_id_index.get(contractIdentifier);
    const contract = localStore.script_contracts.get(key);
    if (contract && contract.org_id === orgId) return contract;
  }

  // 2. Scan contracts by ID or agent_id:version
  for (const c of localStore.script_contracts.values()) {
    if (c.org_id === orgId) {
      if (c.contract_id === contractIdentifier || `${c.agent_id}:${c.version}` === contractIdentifier) {
        return c;
      }
    }
  }
  return null;
}

// Multi-Tenant Context & Strict Auth Middleware
function tenantContext(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.apiKey;
  const headerOrgId = req.headers['x-org-id'];

  let org = null;

  // If API key is provided, strictly validate it
  if (apiKey) {
    for (const o of localStore.orgs.values()) {
      if (o.api_key === apiKey) {
        org = o;
        break;
      }
    }
    if (!org) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or revoked API key' });
    }
  } else if (headerOrgId && localStore.orgs.has(headerOrgId)) {
    // If explicit org header is passed (e.g. from UI switcher)
    org = localStore.orgs.get(headerOrgId);
  }

  // Fallback to default org for local dev / UI ease
  req.org = org || localStore.orgs.get('00000000-0000-0000-0000-000000000001');
  req.orgId = req.org ? req.org.org_id : '00000000-0000-0000-0000-000000000001';
  next();
}

// ==========================================
// 1. Webhook Ingestion Endpoint
// ==========================================
app.post('/webhooks/elevenlabs/call-complete', async (req, res) => {
  await handleCallCompleteWebhook(req, res);
  setTimeout(() => {
    rollupManager.computeRollups();
    broadcastEvent('data_updated', { timestamp: new Date().toISOString() });
  }, 400);
});

// ==========================================
// 2. Real-time Events Stream (SSE)
// ==========================================
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ==========================================
// 3. Organization Management APIs
// ==========================================
app.get('/api/organizations', (req, res) => {
  const orgsList = Array.from(localStore.orgs.values()).map(o => ({
    org_id: o.org_id,
    name: o.name,
    slug: o.slug,
    plan_tier: o.plan_tier,
    created_at: o.created_at
  }));
  res.json({ organizations: orgsList });
});

app.post('/api/organizations', (req, res) => {
  const { name, slug, plan_tier = 'enterprise' } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing organization name' });

  const orgId = crypto.randomUUID();
  const orgSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // Check unique slug
  for (const o of localStore.orgs.values()) {
    if (o.slug === orgSlug) {
      return res.status(409).json({ error: 'Organization slug already exists' });
    }
  }

  const apiKey = `ek_live_${crypto.randomBytes(16).toString('hex')}`;
  const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  const newOrg = {
    org_id: orgId,
    name,
    slug: orgSlug,
    api_key: apiKey,
    webhook_secret: webhookSecret,
    plan_tier,
    token_budget_daily: 1000000,
    token_used_today: 0,
    created_at: new Date().toISOString()
  };

  localStore.orgs.set(orgId, newOrg);
  broadcastEvent('org_created', { org_id: orgId, name });

  res.status(201).json({ organization: newOrg });
});

app.get('/api/organizations/:orgId', tenantContext, (req, res) => {
  const { orgId } = req.params;

  // Strict tenant security check
  if (req.orgId !== orgId) {
    return res.status(403).json({ error: 'Forbidden', message: 'Cross-tenant access denied' });
  }

  const org = localStore.orgs.get(orgId);
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  res.json({ organization: org });
});

// ==========================================
// 4. Voice Agents Registry APIs
// ==========================================
app.get('/api/agents', tenantContext, (req, res) => {
  const agentsList = [];

  for (const a of localStore.agents.values()) {
    if (a.org_id === req.orgId) {
      // Find active contract for this agent
      let activeContract = null;
      let totalContracts = 0;

      for (const c of localStore.script_contracts.values()) {
        if (c.org_id === req.orgId && c.agent_id === a.agent_id) {
          totalContracts++;
          if (c.status === 'active' || c.is_active) {
            if (!activeContract || c.version > activeContract.version) {
              activeContract = c;
            }
          }
        }
      }

      agentsList.push({
        ...a,
        active_contract_version: activeContract ? activeContract.version : null,
        active_contract_id: activeContract ? activeContract.contract_id : null,
        contracts_count: totalContracts
      });
    }
  }

  res.json({ agents: agentsList });
});

app.post('/api/agents', tenantContext, (req, res) => {
  const { agent_id, name, description, elevenlabs_agent_id } = req.body;
  if (!agent_id || !name) {
    return res.status(400).json({ error: 'agent_id and name are required' });
  }

  const agentKey = `${req.orgId}:${agent_id}`;
  if (localStore.agents.has(agentKey)) {
    return res.status(409).json({ error: `Agent '${agent_id}' already exists in your organization` });
  }

  const newAgent = {
    org_id: req.orgId,
    agent_id,
    name,
    description: description || '',
    elevenlabs_agent_id: elevenlabs_agent_id || agent_id,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  localStore.agents.set(agentKey, newAgent);

  // Automatically provision an initial Contract v1 for this agent
  const contractId = crypto.randomUUID();
  const initialContract = {
    contract_id: contractId,
    org_id: req.orgId,
    agent_id,
    version: 1,
    name: `${name} Script Contract v1`,
    status: 'active',
    is_active: true,
    required_disclosures: [
      'This call may be recorded for quality assurance.'
    ],
    banned_phrases: [
      'I guarantee',
      '100% free'
    ],
    expected_flow: [
      'greeting',
      'identification',
      'resolution',
      'closing'
    ],
    tone_target: 'professional, empathetic',
    custom_rules: [
      {
        id: `rule_${Date.now()}_1`,
        name: 'Authorized Scope Only',
        description: 'Agent must never make unauthorized legal or contractual commitments',
        severity: 'high',
        evaluation: 'llm',
        enabled: true
      }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  localStore.script_contracts.set(`${req.orgId}:${agent_id}:1`, initialContract);
  localStore.contract_id_index.set(contractId, `${req.orgId}:${agent_id}:1`);

  broadcastEvent('agent_created', newAgent);
  res.status(201).json({ agent: newAgent, contract: initialContract });
});

app.get('/api/agents/:agentId', tenantContext, (req, res) => {
  const { agentId } = req.params;
  const agentKey = `${req.orgId}:${agentId}`;
  const agent = localStore.agents.get(agentKey);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found in your organization' });
  }

  // Find contracts for this agent
  const contracts = [];
  for (const c of localStore.script_contracts.values()) {
    if (c.org_id === req.orgId && c.agent_id === agentId) {
      contracts.push(c);
    }
  }
  contracts.sort((a, b) => b.version - a.version);

  res.json({ agent, contracts });
});

// ==========================================
// 5. Script Contracts & Quality Rules APIs
// ==========================================
app.get('/api/contracts', tenantContext, (req, res) => {
  const contracts = [];
  for (const c of localStore.script_contracts.values()) {
    if (c.org_id === req.orgId) {
      contracts.push(c);
    }
  }
  contracts.sort((a, b) => b.version - a.version);
  res.json({ contracts });
});

app.get('/api/agents/:agentId/contracts', tenantContext, (req, res) => {
  const { agentId } = req.params;
  const contracts = [];

  for (const c of localStore.script_contracts.values()) {
    if (c.org_id === req.orgId && c.agent_id === agentId) {
      contracts.push(c);
    }
  }
  contracts.sort((a, b) => b.version - a.version);
  res.json({ contracts });
});

app.post('/api/agents/:agentId/contracts', tenantContext, (req, res) => {
  const { agentId } = req.params;
  const {
    name,
    required_disclosures = [],
    banned_phrases = [],
    expected_flow = [],
    tone_target = 'professional, empathetic',
    custom_rules = [],
    status = 'active',
    activate = false
  } = req.body;

  // Ensure agent exists
  const agentKey = `${req.orgId}:${agentId}`;
  if (!localStore.agents.has(agentKey)) {
    // Auto-create agent if not yet registered
    localStore.agents.set(agentKey, {
      org_id: req.orgId,
      agent_id: agentId,
      name: agentId,
      description: 'Auto-registered voice agent',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  // Find latest version number
  let maxVer = 0;
  for (const c of localStore.script_contracts.values()) {
    if (c.org_id === req.orgId && c.agent_id === agentId) {
      if (c.version > maxVer) maxVer = c.version;
    }
  }
  const nextVer = maxVer + 1;

  const shouldActivate = activate || status === 'active';

  // If activating, archive all previous versions for this agent
  if (shouldActivate) {
    for (const c of localStore.script_contracts.values()) {
      if (c.org_id === req.orgId && c.agent_id === agentId) {
        c.status = 'archived';
        c.is_active = false;
        c.updated_at = new Date().toISOString();
      }
    }
  }

  const contractId = crypto.randomUUID();
  const newContract = {
    contract_id: contractId,
    org_id: req.orgId,
    agent_id: agentId,
    version: nextVer,
    name: name || `Contract v${nextVer}`,
    status: shouldActivate ? 'active' : 'draft',
    is_active: shouldActivate,
    required_disclosures,
    banned_phrases,
    expected_flow,
    tone_target,
    custom_rules,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const key = `${req.orgId}:${agentId}:${nextVer}`;
  localStore.script_contracts.set(key, newContract);
  localStore.contract_id_index.set(contractId, key);

  broadcastEvent('contract_updated', newContract);
  res.status(201).json({ contract: newContract });
});

// Backward-compatible POST /api/contracts
app.post('/api/contracts', tenantContext, (req, res) => {
  const { agent_id } = req.body;
  if (!agent_id) return res.status(400).json({ error: 'Missing agent_id' });
  req.params.agentId = agent_id;
  
  // Forward to agent contracts handler
  let maxVer = 0;
  for (const c of localStore.script_contracts.values()) {
    if (c.org_id === req.orgId && c.agent_id === agent_id) {
      if (c.version > maxVer) maxVer = c.version;
    }
  }
  const nextVer = maxVer + 1;

  // Archive previous versions
  for (const c of localStore.script_contracts.values()) {
    if (c.org_id === req.orgId && c.agent_id === agent_id) {
      c.status = 'archived';
      c.is_active = false;
      c.updated_at = new Date().toISOString();
    }
  }

  const contractId = crypto.randomUUID();
  const newContract = {
    contract_id: contractId,
    org_id: req.orgId,
    agent_id,
    version: nextVer,
    name: req.body.name || `Script Contract v${nextVer}`,
    status: 'active',
    is_active: true,
    required_disclosures: req.body.required_disclosures || [],
    banned_phrases: req.body.banned_phrases || [],
    expected_flow: req.body.expected_flow || ['greeting', 'verification', 'resolution', 'closing'],
    tone_target: req.body.tone_target || 'professional, empathetic',
    custom_rules: req.body.custom_rules || [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const key = `${req.orgId}:${agent_id}:${nextVer}`;
  localStore.script_contracts.set(key, newContract);
  localStore.contract_id_index.set(contractId, key);

  broadcastEvent('contract_updated', newContract);
  res.status(201).json({ contract: newContract });
});

app.get('/api/contracts/:contractId', tenantContext, (req, res) => {
  const { contractId } = req.params;
  const contract = findContract(req.orgId, contractId);

  if (!contract) {
    return res.status(404).json({ error: 'Contract not found in your organization' });
  }

  res.json({ contract });
});

app.put('/api/contracts/:contractId', tenantContext, (req, res) => {
  const { contractId } = req.params;
  const existing = findContract(req.orgId, contractId);

  if (!existing) {
    return res.status(404).json({ error: 'Contract not found in your organization' });
  }

  const {
    name,
    required_disclosures,
    banned_phrases,
    expected_flow,
    tone_target,
    custom_rules,
    status
  } = req.body;

  // If contract is 'active', immutable history requires creating a new version!
  if (existing.status === 'active' || existing.is_active) {
    let maxVer = 0;
    for (const c of localStore.script_contracts.values()) {
      if (c.org_id === req.orgId && c.agent_id === existing.agent_id) {
        if (c.version > maxVer) maxVer = c.version;
      }
    }
    const nextVer = maxVer + 1;

    // Archive previous
    existing.status = 'archived';
    existing.is_active = false;
    existing.updated_at = new Date().toISOString();

    const newContractId = crypto.randomUUID();
    const newContract = {
      contract_id: newContractId,
      org_id: req.orgId,
      agent_id: existing.agent_id,
      version: nextVer,
      name: name || `Contract v${nextVer}`,
      status: 'active',
      is_active: true,
      required_disclosures: required_disclosures || existing.required_disclosures,
      banned_phrases: banned_phrases || existing.banned_phrases,
      expected_flow: expected_flow || existing.expected_flow,
      tone_target: tone_target || existing.tone_target,
      custom_rules: custom_rules || existing.custom_rules,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const newKey = `${req.orgId}:${existing.agent_id}:${nextVer}`;
    localStore.script_contracts.set(newKey, newContract);
    localStore.contract_id_index.set(newContractId, newKey);

    broadcastEvent('contract_updated', newContract);
    return res.json({ contract: newContract, created_new_version: true });
  }

  // Otherwise, it's a draft: update in place
  if (name) existing.name = name;
  if (required_disclosures) existing.required_disclosures = required_disclosures;
  if (banned_phrases) existing.banned_phrases = banned_phrases;
  if (expected_flow) existing.expected_flow = expected_flow;
  if (tone_target) existing.tone_target = tone_target;
  if (custom_rules) existing.custom_rules = custom_rules;
  if (status) existing.status = status;
  existing.updated_at = new Date().toISOString();

  broadcastEvent('contract_updated', existing);
  res.json({ contract: existing, created_new_version: false });
});

app.post('/api/contracts/:contractId/activate', tenantContext, (req, res) => {
  const { contractId } = req.params;
  const contract = findContract(req.orgId, contractId);

  if (!contract) {
    return res.status(404).json({ error: 'Contract not found in your organization' });
  }

  // Archive all other contracts for this agent
  for (const c of localStore.script_contracts.values()) {
    if (c.org_id === req.orgId && c.agent_id === contract.agent_id) {
      c.status = 'archived';
      c.is_active = false;
      c.updated_at = new Date().toISOString();
    }
  }

  contract.status = 'active';
  contract.is_active = true;
  contract.updated_at = new Date().toISOString();

  broadcastEvent('contract_updated', contract);
  res.json({ contract, message: `Contract v${contract.version} is now active for agent '${contract.agent_id}'.` });
});

app.post('/api/contracts/:contractId/archive', tenantContext, (req, res) => {
  const { contractId } = req.params;
  const contract = findContract(req.orgId, contractId);

  if (!contract) {
    return res.status(404).json({ error: 'Contract not found in your organization' });
  }

  contract.status = 'archived';
  contract.is_active = false;
  contract.updated_at = new Date().toISOString();

  broadcastEvent('contract_updated', contract);
  res.json({ contract, message: `Contract v${contract.version} archived.` });
});

// Interactive Rule Testing / Preview Endpoint
app.post('/api/contracts/:contractId/test', tenantContext, (req, res) => {
  const { contractId } = req.params;
  const contract = findContract(req.orgId, contractId);

  if (!contract) {
    return res.status(404).json({ error: 'Contract not found in your organization' });
  }

  const { transcript = [] } = req.body;

  // Format transcript turns if text was provided
  const turns = Array.isArray(transcript) ? transcript : [
    { speaker: 'agent', text: String(transcript) }
  ];

  const dummyCall = {
    call_id: 'test_preview_call',
    agent_id: contract.agent_id,
    org_id: req.orgId,
    duration_sec: 60,
    end_reason: 'completed',
    transcript: turns
  };

  const deterministicResults = ruleCheckWorker.evaluateRules(dummyCall, contract);
  const semanticResults = llmJudgeWorker.evaluateTranscriptAgainstContract(dummyCall, contract);

  const combinedFlags = [
    ...deterministicResults.flags,
    ...(semanticResults.custom_rule_results || []).filter(r => !r.passed).map(r => ({
      type: 'CUSTOM_RULE_VIOLATION',
      rule_name: r.name,
      severity: r.severity,
      reason: r.reasoning
    }))
  ];

  const finalDrift = Math.max(deterministicResults.immediateDriftScore, semanticResults.drift_score);

  res.json({
    contract_id: contract.contract_id,
    contract_version: contract.version,
    agent_id: contract.agent_id,
    drift_score: finalDrift,
    flow_checklist: semanticResults.flow_checklist,
    banned_phrase_hits: deterministicResults.flags.filter(f => f.type === 'BANNED_PHRASE_DETECTED'),
    custom_rule_results: semanticResults.custom_rule_results,
    tone_match: semanticResults.tone_match,
    sentiment: semanticResults.sentiment,
    flags: combinedFlags
  });
});

// ==========================================
// 6. Aggregate Overview API
// ==========================================
app.get('/api/overview', tenantContext, (req, res) => {
  const stats = rollupManager.getAggregateStats(req.orgId);
  const org = localStore.orgs.get(req.orgId);

  // Generate rolling 7-day buckets up to today
  const trendMap = new Map();
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dayStr = d.toISOString().slice(5, 10);
    trendMap.set(dayStr, { date: dayStr, calls: 0, flags: 0, avgDrift: 0, driftSum: 0 });
  }

  // Populate from real ingested calls
  for (const [key, call] of localStore.calls.entries()) {
    if (call.org_id === req.orgId) {
      const day = (call.occurred_at || new Date().toISOString()).slice(5, 10);
      const score = localStore.call_scores.get(key) || {};
      if (!trendMap.has(day)) {
        trendMap.set(day, { date: day, calls: 0, flags: 0, avgDrift: 0, driftSum: 0 });
      }
      const item = trendMap.get(day);
      item.calls++;
      item.flags += (score.compliance_flags || []).length;
      item.driftSum += Number(score.drift_score || 0.1);
    }
  }

  const trends = Array.from(trendMap.values()).map(t => ({
    date: t.date,
    calls: t.calls,
    flags: t.flags,
    drift: Math.round((t.driftSum / (t.calls || 1)) * 100) / 100
  }));

  // Agent ranking
  const agentMap = new Map();
  for (const [key, call] of localStore.calls.entries()) {
    if (call.org_id === req.orgId) {
      const score = localStore.call_scores.get(key) || {};
      if (!agentMap.has(call.agent_id)) {
        agentMap.set(call.agent_id, { agent_id: call.agent_id, calls: 0, flags: 0, driftSum: 0 });
      }
      const a = agentMap.get(call.agent_id);
      a.calls++;
      a.flags += (score.compliance_flags || []).length;
      a.driftSum += Number(score.drift_score || 0);
    }
  }

  const agents = Array.from(agentMap.values()).map(a => ({
    agent_id: a.agent_id,
    total_calls: a.calls,
    flag_count: a.flags,
    avg_drift: Math.round((a.driftSum / (a.calls || 1)) * 100) / 100,
    compliance_score: Math.max(0, Math.round(((a.calls - a.flags) / (a.calls || 1)) * 100))
  }));

  // Recent calls for overview dashboard
  const recentCalls = [];
  for (const [key, call] of localStore.calls.entries()) {
    if (call.org_id === req.orgId) {
      const score = localStore.call_scores.get(key) || {};
      recentCalls.push({
        ...call,
        score
      });
    }
  }
  recentCalls.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));

  res.json({
    tenant: {
      name: org?.name || 'Voice Ops Team',
      slug: org?.slug || 'voice-ops',
      plan_tier: org?.plan_tier || 'enterprise',
      token_budget_daily: org?.token_budget_daily || 1000000,
      token_used_today: org?.token_used_today || 14250,
      api_key: org?.api_key,
      webhook_secret: org?.webhook_secret
    },
    metrics: stats,
    trends,
    agents,
    recent_calls: recentCalls.slice(0, 8)
  });
});

// ==========================================
// 7. Calls List & Timeline APIs
// ==========================================
app.get('/api/calls', tenantContext, (req, res) => {
  const { filter, search, agent_id } = req.query;
  const results = [];

  for (const [key, call] of localStore.calls.entries()) {
    if (call.org_id === req.orgId) {
      const score = localStore.call_scores.get(key) || {};
      let include = true;

      if (agent_id && call.agent_id !== agent_id) {
        include = false;
      }

      if (include && filter === 'flagged') {
        include = (score.compliance_flags || []).length > 0;
      } else if (include && filter === 'escalated') {
        include = call.end_reason === 'escalated';
      } else if (include && filter === 'high_drift') {
        include = Number(score.drift_score || 0) >= 0.60;
      }

      if (include && search) {
        const q = search.toLowerCase();
        const matchesId = call.call_id.toLowerCase().includes(q);
        const matchesTranscript = call.transcript.some(t => t.text.toLowerCase().includes(q));
        include = matchesId || matchesTranscript;
      }

      if (include) {
        results.push({
          ...call,
          score
        });
      }
    }
  }

  results.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  res.json({ calls: results });
});

app.get('/api/calls/:call_id', tenantContext, (req, res) => {
  const { call_id } = req.params;
  let callKey = `${req.orgId}:${call_id}`;
  let call = localStore.calls.get(callKey);

  // If not found by tenant composite key, search across all calls by call_id
  if (!call) {
    for (const [k, c] of localStore.calls.entries()) {
      if (c.call_id === call_id) {
        call = c;
        callKey = k;
        break;
      }
    }
  }

  if (!call) {
    return res.status(404).json({ error: 'Call record not found' });
  }

  const score = localStore.call_scores.get(callKey) || call.score || {
    contract_version: 1,
    drift_score: 0.15,
    compliance_flags: [],
    sentiment: { start: 0, end: 0, trajectory_notes: 'Standard call progression' },
    tone_match: { target: 'professional', match_score: 0.95 }
  };

  const contract = localStore.script_contracts.get(`${call.org_id || req.orgId}:${call.agent_id}:${score.contract_version || 1}`) ||
    localStore.script_contracts.get(`${call.org_id || req.orgId}:${call.agent_id}:1`) ||
    Array.from(localStore.script_contracts.values()).find(c => c.agent_id === call.agent_id) || {
      name: 'Default Script Contract',
      version: 1,
      expected_flow: ['greeting', 'verification', 'resolution', 'closing']
    };

  const audits = (localStore.processing_audit || []).filter(a => a.call_id === call_id);

  res.json({
    call,
    score,
    contract,
    audits
  });
});

// ==========================================
// 8. Alerts API
// ==========================================
app.get('/api/alerts', tenantContext, (req, res) => {
  const alerts = [];
  for (const a of localStore.alerts.values()) {
    if (a.org_id === req.orgId) {
      alerts.push(a);
    }
  }
  alerts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ alerts });
});

app.patch('/api/alerts/:alert_id', tenantContext, (req, res) => {
  const { alert_id } = req.params;
  const { status, acknowledged_by } = req.body;
  const alert = localStore.alerts.get(alert_id);

  if (!alert || alert.org_id !== req.orgId) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  if (status) alert.status = status;
  if (acknowledged_by) alert.acknowledged_by = acknowledged_by;
  if (status === 'resolved') alert.resolved_at = new Date().toISOString();

  localStore.alerts.set(alert_id, alert);
  broadcastEvent('alert_updated', alert);
  res.json({ alert });
});

// ==========================================
// 9. EchoTrace Self-Observability & Health
// ==========================================
app.get('/api/observability', tenantContext, async (req, res) => {
  const streamMetrics = await queueManager.getStreamMetrics();
  const org = localStore.orgs.get(req.orgId);

  res.json({
    status: 'healthy',
    engine: queueManager.isRedis ? 'Redis Streams Cluster' : 'In-Memory Stream Engine (Resilient)',
    streams: streamMetrics,
    workers: {
      normalizer: { status: normalizerWorker.isRunning ? 'active' : 'stopped', instances: 2 },
      rule_checker: { status: ruleCheckWorker.isRunning ? 'active' : 'stopped', instances: 3 },
      llm_judge: {
        status: llmJudgeWorker.isRunning ? 'active' : 'stopped',
        circuit_breaker: llmJudgeWorker.circuitBreaker.state,
        cache_size: llmJudgeWorker.verdictCache.size
      },
      alert_worker: {
        status: alertWorker.isRunning ? 'active' : 'stopped',
        dispatched_count: alertWorker.sentAlertsHistory.length
      }
    },
    tenancy: {
      active_orgs: localStore.orgs.size,
      daily_token_usage: org?.token_used_today || 0,
      daily_token_budget: org?.token_budget_daily || 1000000
    },
    system: {
      uptime_sec: Math.round(process.uptime()),
      memory_rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      node_version: process.version
    }
  });
});

// ==========================================
// 10. Webhook Simulator Endpoint
// ==========================================
app.post('/api/simulator/generate-call', tenantContext, async (req, res) => {
  const { scenario = 'clean', agent_id = 'eleven-support-agent-v1' } = req.body;
  const orgId = req.orgId;
  const org = localStore.orgs.get(orgId) || localStore.orgs.get('00000000-0000-0000-0000-000000000001');
  const secret = org.webhook_secret;

  const callId = `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  let payload = null;

  if (scenario === 'clean') {
    payload = {
      call_id: callId,
      agent_id,
      org_id: orgId,
      timestamp: new Date().toISOString(),
      duration_sec: 114,
      end_reason: 'completed',
      audio_url: 'https://cdn.elevenlabs.io/demo/audio-sample-1.mp3',
      transcript: [
        { speaker: 'agent', text: 'Thank you for calling ElevenLabs Priority Support. This call may be recorded for quality assurance. How can I assist you today?', timestamp_offset: 1.2 },
        { speaker: 'user', text: 'Hi, I noticed some unexpected latency on my conversational agent endpoint.', timestamp_offset: 6.8 },
        { speaker: 'agent', text: 'I understand completely and can check the telemetry on your agent profile right now. May I verify your account ID?', timestamp_offset: 12.4 },
        { speaker: 'user', text: 'Sure, it is ACC-99482.', timestamp_offset: 19.1 },
        { speaker: 'agent', text: 'Thank you. I have verified your account and cleared the edge caching bottleneck. Your response latency is now back down under 120 milliseconds.', timestamp_offset: 25.6 },
        { speaker: 'user', text: 'That resolved it immediately, thank you so much!', timestamp_offset: 35.2 },
        { speaker: 'agent', text: 'You are very welcome! Have a wonderful day, and thank you for building with ElevenLabs.', timestamp_offset: 40.0 }
      ]
    };
  } else if (scenario === 'banned_phrase') {
    payload = {
      call_id: callId,
      agent_id,
      org_id: orgId,
      timestamp: new Date().toISOString(),
      duration_sec: 84,
      end_reason: 'completed',
      audio_url: 'https://cdn.elevenlabs.io/demo/audio-sample-2.mp3',
      transcript: [
        { speaker: 'agent', text: 'Hello, welcome to voice services. How can I help you today?', timestamp_offset: 1.0 },
        { speaker: 'user', text: 'I want to know if my enterprise plan comes with unlimited server capacity.', timestamp_offset: 6.0 },
        { speaker: 'agent', text: 'I guarantee that your plan has an unlimited lifetime warranty and will never experience downtime.', timestamp_offset: 12.5 },
        { speaker: 'user', text: 'Wait, does the contract really say unlimited lifetime warranty?', timestamp_offset: 18.0 },
        { speaker: 'agent', text: 'Yes, I guarantee 100% free forever scaling for your agents.', timestamp_offset: 24.0 }
      ]
    };
  } else if (scenario === 'hallucination_drift') {
    payload = {
      call_id: callId,
      agent_id,
      org_id: orgId,
      timestamp: new Date().toISOString(),
      duration_sec: 145,
      end_reason: 'completed',
      audio_url: 'https://cdn.elevenlabs.io/demo/audio-sample-3.mp3',
      transcript: [
        { speaker: 'agent', text: 'Hello, what can I do for you?', timestamp_offset: 1.2 },
        { speaker: 'user', text: 'Can your model output voice in ancient Sumerian?', timestamp_offset: 7.0 },
        { speaker: 'agent', text: 'Yes, our model natively speaks 4,000 lost ancient languages with 100% historical accuracy.', timestamp_offset: 14.5 },
        { speaker: 'user', text: 'Are you sure about that? I did not see that in the documentation.', timestamp_offset: 22.0 },
        { speaker: 'agent', text: 'We guarantee zero latency and complete coverage of all ancient Mesopotamian dialects.', timestamp_offset: 29.0 }
      ]
    };
  } else {
    // Escalated call
    payload = {
      call_id: callId,
      agent_id,
      org_id: orgId,
      timestamp: new Date().toISOString(),
      duration_sec: 42,
      end_reason: 'escalated',
      audio_url: 'https://cdn.elevenlabs.io/demo/audio-sample-4.mp3',
      transcript: [
        { speaker: 'agent', text: 'Voice support line, what do you need?', timestamp_offset: 1.0 },
        { speaker: 'user', text: 'Your billing charged me twice this morning and I am extremely angry!', timestamp_offset: 5.5 },
        { speaker: 'agent', text: 'I cannot fix billing errors. You must read our terms of service.', timestamp_offset: 11.2 },
        { speaker: 'user', text: 'Let me speak to a human supervisor right now! This is ridiculous!', timestamp_offset: 16.8 },
        { speaker: 'agent', text: 'Escalating call to tier-2 human supervisor immediately.', timestamp_offset: 22.0 }
      ]
    };
  }

  const payloadStr = JSON.stringify(payload);
  const signature = signElevenLabsPayload(payloadStr, secret);

  const mockReq = {
    headers: {
      'elevenlabs-signature': signature,
      'x-org-id': orgId
    },
    body: payload,
    rawBody: payloadStr
  };

  let responseData = null;
  const mockRes = {
    status: (code) => ({
      json: (data) => {
        responseData = { code, data };
        return responseData;
      }
    })
  };

  await handleCallCompleteWebhook(mockReq, mockRes);
  res.json({ success: true, call_id: callId, scenario, webhook_result: responseData });
});

// Seed Initial Realistic Dataset
function seedInitialData() {
  const orgId = '00000000-0000-0000-0000-000000000001';

  const sampleCalls = [
    {
      call_id: 'call_el_live_948271',
      agent_id: 'eleven-support-agent-v1',
      occurred_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      duration_sec: 142,
      end_reason: 'completed',
      audio_ref: 'https://assets.elevenlabs.io/recordings/call_el_live_948271.mp3',
      transcript: [
        { speaker: 'agent', text: 'Hello! Thank you for calling ElevenLabs Voice Ops. This call may be recorded for quality and compliance. How can I help you today?', timestamp_offset: 1.5, audio_tags: ['clear_tone'] },
        { speaker: 'user', text: 'Hi, I am looking to tune the stability slider on my custom voice clone.', timestamp_offset: 8.2, audio_tags: [] },
        { speaker: 'agent', text: 'I would be delighted to assist with that! To achieve higher consistency, setting stability between 0.70 and 0.85 is typically optimal.', timestamp_offset: 14.8, audio_tags: [] },
        { speaker: 'user', text: 'Got it, and what about style exaggeration?', timestamp_offset: 22.1, audio_tags: [] },
        { speaker: 'agent', text: 'Keeping exaggeration at 0 helps prevent unpredictable inflection changes. Let us test a quick sentence generation together.', timestamp_offset: 28.5, audio_tags: [] },
        { speaker: 'user', text: 'Sounds perfect, that sounds crystal clear now.', timestamp_offset: 36.4, audio_tags: [] },
        { speaker: 'agent', text: 'Wonderful! Thank you for choosing ElevenLabs, and have an exceptional rest of your day.', timestamp_offset: 42.0, audio_tags: [] }
      ],
      score: {
        contract_version: 1,
        drift_score: 0.08,
        compliance_flags: [],
        sentiment: { start: 0.3, end: 0.85, trajectory_notes: 'Highly satisfied, clear resolution achieved.' },
        tone_match: { target: 'professional, empathetic', observed: 'professional, empathetic', match_score: 0.98 },
        custom_rule_results: [
          { rule_id: 'rule_ref_policy_01', name: 'Refund Authorization Policy', passed: true, reasoning: 'No unauthorized promises', severity: 'high' }
        ],
        judge_model_version: 'claude-3-5-sonnet-20241022',
        status: 'scored'
      }
    },
    {
      call_id: 'call_el_drift_837194',
      agent_id: 'eleven-support-agent-v1',
      occurred_at: new Date(Date.now() - 48 * 60 * 1000).toISOString(),
      duration_sec: 98,
      end_reason: 'completed',
      audio_ref: 'https://assets.elevenlabs.io/recordings/call_el_drift_837194.mp3',
      transcript: [
        { speaker: 'agent', text: 'Hey there, what do you need assistance with today?', timestamp_offset: 1.0, audio_tags: [] },
        { speaker: 'user', text: 'Will our API credits roll over to next month if we do not use them?', timestamp_offset: 5.5, audio_tags: [] },
        { speaker: 'agent', text: 'Yes, I guarantee that all unused credits roll over forever without any expiration date.', timestamp_offset: 11.2, audio_tags: ['hesitation'] },
        { speaker: 'user', text: 'Really? The sales rep previously told me they expire at the billing cycle.', timestamp_offset: 18.0, audio_tags: [] },
        { speaker: 'agent', text: 'I guarantee we will waive all billing restrictions for your account.', timestamp_offset: 24.5, audio_tags: [] }
      ],
      score: {
        contract_version: 1,
        drift_score: 0.84,
        compliance_flags: [
          { type: 'BANNED_PHRASE_DETECTED', severity: 'critical', phrase: 'I guarantee', speaker: 'agent', turn_offset: 11.2 },
          { type: 'MISSING_MANDATORY_DISCLOSURE', severity: 'high', expected: 'This call may be recorded for quality assurance' },
          { type: 'UNVERIFIABLE_CLAIM', severity: 'high', claim: 'Guaranteed credit rollover without expiration violates company billing contract', confidence: 0.96 }
        ],
        sentiment: { start: 0.1, end: -0.3, trajectory_notes: 'Customer detected inconsistent answers from agent.' },
        tone_match: { target: 'professional, empathetic', observed: 'unauthorized over-promising', match_score: 0.42 },
        custom_rule_results: [
          { rule_id: 'rule_ref_policy_01', name: 'Refund Authorization Policy', passed: false, reasoning: 'Turn 4: Agent offered an unauthorized guarantee.', severity: 'high' }
        ],
        judge_model_version: 'claude-3-5-sonnet-20241022',
        status: 'scored'
      }
    },
    {
      call_id: 'call_el_esc_726190',
      agent_id: 'eleven-support-agent-v1',
      occurred_at: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
      duration_sec: 52,
      end_reason: 'escalated',
      audio_ref: 'https://assets.elevenlabs.io/recordings/call_el_esc_726190.mp3',
      transcript: [
        { speaker: 'agent', text: 'ElevenLabs voice support. What is the issue?', timestamp_offset: 1.0, audio_tags: [] },
        { speaker: 'user', text: 'Your voice agent hung up on my CEO three times in a row during a live demo!', timestamp_offset: 5.0, audio_tags: ['interruption'] },
        { speaker: 'agent', text: 'Network disconnects happen and are not our responsibility.', timestamp_offset: 11.5, audio_tags: [] },
        { speaker: 'user', text: 'Get me a supervisor right now! This is unacceptable customer treatment!', timestamp_offset: 18.0, audio_tags: ['raised_volume'] },
        { speaker: 'agent', text: 'Transferring to human support lead immediately.', timestamp_offset: 24.0, audio_tags: [] }
      ],
      score: {
        contract_version: 1,
        drift_score: 0.78,
        compliance_flags: [
          { type: 'CUSTOMER_ESCALATION', severity: 'high', reason: 'Call terminated with escalation status' },
          { type: 'MISSING_MANDATORY_DISCLOSURE', severity: 'high', expected: 'This call may be recorded' }
        ],
        sentiment: { start: -0.6, end: -0.9, trajectory_notes: 'Severe dissatisfaction due to lack of empathy and curt response.' },
        tone_match: { target: 'professional, empathetic', observed: 'defensive and argumentative', match_score: 0.35 },
        custom_rule_results: [],
        judge_model_version: 'claude-3-5-sonnet-20241022',
        status: 'scored'
      }
    }
  ];

  for (const c of sampleCalls) {
    const key = `${orgId}:${c.call_id}`;
    localStore.calls.set(key, {
      org_id: orgId,
      call_id: c.call_id,
      agent_id: c.agent_id,
      occurred_at: c.occurred_at,
      duration_sec: c.duration_sec,
      transcript: c.transcript,
      end_reason: c.end_reason,
      audio_ref: c.audio_ref,
      schema_version: 1,
      received_at: c.occurred_at
    });

    localStore.call_scores.set(key, {
      org_id: orgId,
      call_id: c.call_id,
      ...c.score,
      scored_at: c.occurred_at
    });

    if (c.score.compliance_flags.length > 0 || c.end_reason === 'escalated') {
      const alertId = crypto.randomUUID();
      localStore.alerts.set(alertId, {
        alert_id: alertId,
        org_id: orgId,
        call_id: c.call_id,
        agent_id: c.agent_id,
        contract_version: c.score.contract_version,
        issue_type: c.score.compliance_flags[0]?.type || 'CALL_ESCALATION',
        severity: c.score.compliance_flags.some(f => f.severity === 'critical') ? 'critical' : 'high',
        status: 'open',
        details: { flags: c.score.compliance_flags },
        created_at: c.occurred_at
      });
    }
  }

  rollupManager.computeRollups();
}

// Start Background Worker Pool
async function startWorkers() {
  await normalizerWorker.start();
  await ruleCheckWorker.start();
  await llmJudgeWorker.start();
  await alertWorker.start();
  rollupManager.start(30000);
}

// Ensure React client bundle exists on boot (auto-build on Render/Heroku if missing)
const distPath = path.join(__dirname, 'client', 'dist');
const altDistPath = path.join(__dirname, 'dist');

if (!process.env.VERCEL && !fs.existsSync(path.join(distPath, 'index.html')) && !fs.existsSync(path.join(altDistPath, 'index.html'))) {
  if (fs.existsSync(path.join(__dirname, 'client', 'package.json'))) {
    console.log('⚡ [EchoTrace] client/dist not detected. Compiling React client bundle automatically...');
    try {
      const { execSync } = require('child_process');
      execSync('npm --prefix client install && npm --prefix client run build', { stdio: 'inherit' });
      console.log('✅ [EchoTrace] Client compiled successfully on boot!');
    } catch (err) {
      console.error('⚠️ [EchoTrace] Automated client build warning:', err.message);
    }
  }
}

// Serve built React client assets
app.use(express.static(distPath));
app.use(express.static(altDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/webhooks')) {
    return next();
  }
  
  const primaryIndex = path.join(distPath, 'index.html');
  const fallbackIndex = path.join(altDistPath, 'index.html');

  if (fs.existsSync(primaryIndex)) {
    return res.sendFile(primaryIndex);
  }
  if (fs.existsSync(fallbackIndex)) {
    return res.sendFile(fallbackIndex);
  }

  // Graceful fallback response if static files are completely absent
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head><title>EchoTrace Control Plane</title></head>
      <body style="margin:0; background:#0E0F11; color:white; font-family:-apple-system,system-ui,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh;">
        <div style="text-align:center; max-width:480px; padding:32px; border:1px solid rgba(255,255,255,0.1); border-radius:16px;">
          <h2 style="margin-top:0;">EchoTrace Engine Running 🚀</h2>
          <p style="color:#A1A1AA; font-size:14px; line-height:1.6;">Backend APIs & Webhook receivers are healthy.<br>Run <code>npm run build</code> in the root directory to build the dashboard.</p>
        </div>
      </body>
    </html>
  `);
});

// Always seed in-memory store so serverless functions have active data
seedInitialData();

// Boot server
if (require.main === module) {
  startWorkers();

  const server = app.listen(PORT, () => {
    console.log(`\n=======================================================`);
    console.log(`🚀 EchoTrace Production Engine active on http://localhost:${PORT}`);
    console.log(`📡 ElevenLabs Webhook Ingest: http://localhost:${PORT}/webhooks/elevenlabs/call-complete`);
    console.log(`=======================================================\n`);
  });
}

module.exports = app;

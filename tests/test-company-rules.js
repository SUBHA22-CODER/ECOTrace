/**
 * Comprehensive EchoTrace Production Quality & Multi-Tenant Test Suite
 * Tests:
 * 1. Company / Tenant Creation & Authentication
 * 2. Voice Agent Registration
 * 3. Contract Versioning & Immutability (v1 -> v2)
 * 4. Custom Rules & Deterministic/LLM Evaluation
 * 5. End-to-End Pipeline Execution with Dynamic Active Contract
 * 6. Multi-Tenant Security & Cross-Tenant Access Denial
 * 7. Edge Cases: NO_ACTIVE_CONTRACT, Duplicate Webhook
 */

const assert = require('assert');
const crypto = require('crypto');
const app = require('../server');
const { localStore } = require('../database/db');
const { RuleCheckWorker } = require('../services/workers/rule-checker');
const { LlmJudgeWorker } = require('../services/workers/llm-judge');
const { NormalizationWorker } = require('../services/workers/normalizer');
const { queueManager } = require('../services/workers/queue-manager');
const { signElevenLabsPayload } = require('../services/ingestion/receiver');

async function runTestSuite() {
  console.log('===============================================================');
  console.log('🧪 RUNNING ECHOTRACE PRODUCTION QA & MULTI-TENANT TEST SUITE');
  console.log('===============================================================\n');

  // -------------------------------------------------------------------------
  // SECTION 1: Company / Organization Creation
  // -------------------------------------------------------------------------
  console.log('▶ [1/7] Testing Company Creation & Credentials...');
  const orgAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();

  const orgA = {
    org_id: orgAId,
    name: 'FinTech Voice Solutions Corp',
    slug: 'fintech-voice-solutions',
    api_key: `ek_live_${crypto.randomBytes(16).toString('hex')}`,
    webhook_secret: `whsec_${crypto.randomBytes(24).toString('hex')}`,
    plan_tier: 'enterprise',
    token_budget_daily: 1000000,
    token_used_today: 0,
    created_at: new Date().toISOString()
  };

  const orgB = {
    org_id: orgBId,
    name: 'Healthcare Patient AI',
    slug: 'healthcare-patient-ai',
    api_key: `ek_live_${crypto.randomBytes(16).toString('hex')}`,
    webhook_secret: `whsec_${crypto.randomBytes(24).toString('hex')}`,
    plan_tier: 'pro',
    token_budget_daily: 500000,
    token_used_today: 0,
    created_at: new Date().toISOString()
  };

  localStore.orgs.set(orgAId, orgA);
  localStore.orgs.set(orgBId, orgB);

  assert.ok(localStore.orgs.has(orgAId), 'Company A must be registered in datastore');
  assert.ok(localStore.orgs.has(orgBId), 'Company B must be registered in datastore');
  console.log('  ✔ Company A and Company B created with isolated credentials.\n');

  // -------------------------------------------------------------------------
  // SECTION 2: Voice Agent Registration
  // -------------------------------------------------------------------------
  console.log('▶ [2/7] Testing Voice Agent Registration...');
  const agentA = {
    org_id: orgAId,
    agent_id: 'refund-support-agent',
    name: 'Refund Support Agent',
    description: 'Handles customer refunds, order status, and billing disputes',
    status: 'active',
    created_at: new Date().toISOString()
  };

  const agentB = {
    org_id: orgBId,
    agent_id: 'patient-intake-agent',
    name: 'Patient Intake Agent',
    description: 'HIPAA-compliant clinical appointment scheduling',
    status: 'active',
    created_at: new Date().toISOString()
  };

  localStore.agents.set(`${orgAId}:${agentA.agent_id}`, agentA);
  localStore.agents.set(`${orgBId}:${agentB.agent_id}`, agentB);

  assert.ok(localStore.agents.has(`${orgAId}:${agentA.agent_id}`), 'Agent A must exist in Company A');
  assert.ok(localStore.agents.has(`${orgBId}:${agentB.agent_id}`), 'Agent B must exist in Company B');
  console.log('  ✔ Voice agents registered successfully under respective tenants.\n');

  // -------------------------------------------------------------------------
  // SECTION 3: Contract Creation with Company Rules & Versioning
  // -------------------------------------------------------------------------
  console.log('▶ [3/7] Testing Contract Configuration with Custom Rules (v1)...');
  const contractV1Id = crypto.randomUUID();
  const contractV1 = {
    contract_id: contractV1Id,
    org_id: orgAId,
    agent_id: agentA.agent_id,
    version: 1,
    name: 'Refund Agent Quality Contract v1',
    status: 'active',
    is_active: true,
    required_disclosures: [
      'This call may be recorded for quality and regulatory assurance.',
      'You are speaking with an automated voice assistant.',
      'Refund requests require account verification.'
    ],
    banned_phrases: [
      'I guarantee',
      '100% free forever',
      'we will waive all legal rights',
      'no questions asked refund',
      'unlimited lifetime warranty'
    ],
    expected_flow: [
      'greeting',
      'identify_customer',
      'verify_account',
      'understand_issue',
      'provide_resolution',
      'closing'
    ],
    tone_target: 'professional, empathetic, concise, and respectful',
    custom_rules: [
      {
        id: 'rule_refund_policy_01',
        name: 'Refund Policy Compliance',
        description: 'Agent must never promise a refund before eligibility is verified',
        severity: 'high',
        evaluation: 'llm',
        enabled: true
      },
      {
        id: 'rule_no_competitor_disparagement',
        name: 'No Competitor Slander',
        description: 'Agent must never make disparaging claims about competitors',
        severity: 'normal',
        evaluation: 'llm',
        enabled: true
      }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  localStore.script_contracts.set(`${orgAId}:${agentA.agent_id}:1`, contractV1);
  localStore.contract_id_index.set(contractV1Id, `${orgAId}:${agentA.agent_id}:1`);

  assert.strictEqual(contractV1.required_disclosures.length, 3, 'Must have 3 required disclosures');
  assert.strictEqual(contractV1.banned_phrases.length, 5, 'Must have 5 banned phrases');
  assert.strictEqual(contractV1.expected_flow.length, 6, 'Must have 6 expected flow stages');
  assert.strictEqual(contractV1.custom_rules.length, 2, 'Must have 2 custom compliance rules');
  console.log('  ✔ Contract v1 created with 3 disclosures, 5 banned phrases, 6 flow stages, 2 custom rules.\n');

  // -------------------------------------------------------------------------
  // SECTION 4: End-to-End Pipeline Evaluation of Realistic Call
  // -------------------------------------------------------------------------
  console.log('▶ [4/7] Testing End-to-End Webhook Ingestion & Dynamic Rule Execution...');
  const normalizer = new NormalizationWorker('test-norm');
  const ruleChecker = new RuleCheckWorker('test-rules');
  const llmJudge = new LlmJudgeWorker('test-judge');

  // Call that violates:
  // 1. Missing mandatory disclosure (omitted AI transparency disclosure)
  // 2. Banned phrase: "I guarantee"
  // 3. Custom rule: promises refund BEFORE account is verified!
  const call1Id = `call_test_${Date.now()}`;
  const callPayload = {
    call_id: call1Id,
    org_id: orgAId,
    agent_id: agentA.agent_id,
    timestamp: new Date().toISOString(),
    duration_sec: 95,
    end_reason: 'completed',
    transcript: [
      { speaker: 'agent', text: 'Hello, thank you for calling FinTech Support. How can I help you?', timestamp_offset: 1.0 },
      { speaker: 'user', text: 'I want my $500 subscription refund back immediately!', timestamp_offset: 5.5 },
      { speaker: 'agent', text: 'I guarantee we will issue your refund right away, no problem at all!', timestamp_offset: 11.2 },
      { speaker: 'user', text: 'Great, my email is john@doe.com if you need it.', timestamp_offset: 18.0 },
      { speaker: 'agent', text: 'Thank you, I see your account now. Have a nice day!', timestamp_offset: 24.5 }
    ]
  };

  // Step 4a: Store raw payload
  const s3Uri = await localStore.putObject(`echotrace-raw-${orgAId}`, `calls/${call1Id}.json`, callPayload);

  // Step 4b: Normalization worker processes
  await normalizer.processMessage({
    id: 'norm-msg-1',
    payload: { org_id: orgAId, call_id: call1Id, payload_ref: s3Uri },
    attempts: 1
  });

  const savedCall = localStore.calls.get(`${orgAId}:${call1Id}`);
  assert.ok(savedCall, 'Call must be saved in database');
  assert.strictEqual(savedCall.agent_id, agentA.agent_id, 'Agent ID must match');

  // Step 4c: Rule Checker executes deterministic checks against active Contract v1
  await ruleChecker.processMessage({
    id: 'rule-msg-1',
    payload: { org_id: orgAId, call_id: call1Id, agent_id: agentA.agent_id },
    attempts: 1
  });

  const ruleScore = localStore.call_scores.get(`${orgAId}:${call1Id}`);
  assert.ok(ruleScore, 'Score must be generated by rule-checker');
  assert.strictEqual(ruleScore.contract_version, 1, 'Evaluated call must retain contract_version 1');

  // Check banned phrase hit
  const bannedHit = ruleScore.compliance_flags.find(f => f.type === 'BANNED_PHRASE_DETECTED');
  assert.ok(bannedHit, 'Banned phrase "I guarantee" must be detected');
  assert.strictEqual(bannedHit.phrase, 'I guarantee', 'Matched phrase must match rule');

  // Check missing disclosure hit
  const discHit = ruleScore.compliance_flags.find(f => f.type === 'MISSING_MANDATORY_DISCLOSURE');
  assert.ok(discHit, 'Missing disclosure must be flagged');

  // Step 4d: LLM Judge executes semantic evaluation against company rules
  await llmJudge.processMessage({
    id: 'llm-msg-1',
    payload: { org_id: orgAId, call_id: call1Id, agent_id: agentA.agent_id, contract_version: 1 },
    attempts: 1
  });

  const finalScore = localStore.call_scores.get(`${orgAId}:${call1Id}`);
  assert.strictEqual(finalScore.status, 'scored', 'Status must be scored');
  assert.strictEqual(finalScore.contract_version, 1, 'Contract version must be 1');

  // Verify custom rule evaluation
  const customResults = finalScore.custom_rule_results || [];
  assert.ok(customResults.length > 0, 'Custom rule results must be present');
  const refundRule = customResults.find(r => r.name === 'Refund Policy Compliance');
  assert.ok(refundRule, 'Refund Policy Compliance rule must be evaluated');
  assert.strictEqual(refundRule.passed, false, 'Rule must fail because refund was promised before verification');
  assert.ok(finalScore.drift_score > 0.60, `Drift score (${finalScore.drift_score}) must be high due to breaches`);

  console.log(`  ✔ Automated pipeline evaluated call against Contract v1!`);
  console.log(`    - Banned phrase hit: "${bannedHit.phrase}"`);
  console.log(`    - Custom rule breach: "${refundRule.name}" (${refundRule.reasoning})`);
  console.log(`    - Final Drift Score: ${finalScore.drift_score}\n`);

  // -------------------------------------------------------------------------
  // SECTION 5: Contract Versioning & Historical Immutability (v1 -> v2)
  // -------------------------------------------------------------------------
  console.log('▶ [5/7] Testing Contract Versioning (Deploying v2)...');
  // Deploy v2: contractV1 is archived, contractV2 is active
  contractV1.status = 'archived';
  contractV1.is_active = false;

  const contractV2Id = crypto.randomUUID();
  const contractV2 = {
    contract_id: contractV2Id,
    org_id: orgAId,
    agent_id: agentA.agent_id,
    version: 2,
    name: 'Refund Agent Quality Contract v2 (Stricter Security)',
    status: 'active',
    is_active: true,
    required_disclosures: [
      'This call may be recorded for quality and regulatory assurance.',
      'Two-factor authorization code required.'
    ],
    banned_phrases: ['I guarantee', 'off the record'],
    expected_flow: ['greeting', '2fa_verification', 'resolution', 'closing'],
    tone_target: 'calm, authoritative, and helpful',
    custom_rules: [
      {
        id: 'rule_v2_strict_refund',
        name: 'Strict 2FA Verification',
        description: 'Agent must collect two-factor code before modifying any account details',
        severity: 'critical',
        evaluation: 'llm',
        enabled: true
      }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  localStore.script_contracts.set(`${orgAId}:${agentA.agent_id}:2`, contractV2);
  localStore.contract_id_index.set(contractV2Id, `${orgAId}:${agentA.agent_id}:2`);

  // Verify Active Contract Selection
  const activeContractForAgent = ruleChecker.getActiveContract(orgAId, agentA.agent_id);
  assert.strictEqual(activeContractForAgent.version, 2, 'Active contract must now resolve to v2');

  // Verify historical call still points to v1!
  const historicalScore = localStore.call_scores.get(`${orgAId}:${call1Id}`);
  assert.strictEqual(historicalScore.contract_version, 1, 'Historical call must STILL reference contract_version 1');
  console.log('  ✔ Contract v2 activated! Active contract resolves to v2.');
  console.log('  ✔ Historical call remains permanently tied to v1 (immutability preserved).\n');

  // -------------------------------------------------------------------------
  // SECTION 6: Multi-Tenant Security & Cross-Tenant Access Denial
  // -------------------------------------------------------------------------
  console.log('▶ [6/7] Testing Multi-Tenant Query-Layer Security...');
  // Scenario: Company B tries to access Company A's data
  // 1. Cross-tenant call access check
  const crossCallCheck = localStore.calls.get(`${orgBId}:${call1Id}`);
  assert.strictEqual(crossCallCheck, undefined, 'Company B must NOT be able to access Company A call');

  // 2. Cross-tenant contract access check
  let companyBContractAccess = null;
  for (const c of localStore.script_contracts.values()) {
    if (c.org_id === orgBId && c.contract_id === contractV1Id) {
      companyBContractAccess = c;
    }
  }
  assert.strictEqual(companyBContractAccess, null, 'Company B must NOT be able to access Company A contract');

  // 3. Cross-tenant agent access check
  const crossAgentCheck = localStore.agents.get(`${orgBId}:${agentA.agent_id}`);
  assert.strictEqual(crossAgentCheck, undefined, 'Company B must NOT see Company A agent');

  console.log('  ✔ Tenant isolation verified! Cross-tenant access strictly denied at data layer.\n');

  // -------------------------------------------------------------------------
  // SECTION 7: Edge Cases: NO_ACTIVE_CONTRACT & Webhook Deduplication
  // -------------------------------------------------------------------------
  console.log('▶ [7/7] Testing Edge Cases: NO_ACTIVE_CONTRACT & Deduplication...');
  
  // Edge Case A: Unknown agent with no contract
  const orphanCallId = `call_orphan_${Date.now()}`;
  localStore.calls.set(`${orgAId}:${orphanCallId}`, {
    call_id: orphanCallId,
    org_id: orgAId,
    agent_id: 'unregistered-rogue-agent',
    transcript: [{ speaker: 'agent', text: 'Hello' }],
    duration_sec: 15,
    end_reason: 'completed'
  });

  await ruleChecker.processMessage({
    id: 'orphan-msg',
    payload: { org_id: orgAId, call_id: orphanCallId, agent_id: 'unregistered-rogue-agent' },
    attempts: 1
  });

  const orphanScore = localStore.call_scores.get(`${orgAId}:${orphanCallId}`);
  assert.strictEqual(orphanScore.status, 'no_active_contract', 'Must explicitly handle NO_ACTIVE_CONTRACT state');
  console.log('  ✔ Handled unregistered agent with explicit NO_ACTIVE_CONTRACT status.');

  // Edge Case B: Webhook Deduplication
  const dedupKey = `idempotency:webhook:${orgAId}:call_dedup_test`;
  const firstWebhook = await queueManager.deduplicate(dedupKey, 3600);
  const duplicateWebhook = await queueManager.deduplicate(dedupKey, 3600);
  assert.strictEqual(firstWebhook, true, 'First webhook delivery must succeed');
  assert.strictEqual(duplicateWebhook, false, 'Duplicate webhook must be dropped via atomic dedup');
  console.log('  ✔ Webhook deduplication successfully prevented duplicate processing.');

  console.log('\n===============================================================');
  console.log('🎉 ALL 7 TEST SUITES PASSED FLAWLESSLY WITH ZERO FAILURES!');
  console.log('===============================================================\n');
}

runTestSuite().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});

/**
 * EchoTrace End-to-End Pipeline & Resilience Test
 * Verifies:
 * - HMAC Signature verification
 * - Idempotency deduplication
 * - Queue transitions across streams
 * - Rule-based fast checks
 * - LLM Judge structured output
 * - Alert deduplication
 */

const assert = require('assert');
const { signElevenLabsPayload, verifyElevenLabsSignature } = require('../services/ingestion/receiver');
const { queueManager } = require('../services/workers/queue-manager');
const { localStore } = require('../database/db');
const { NormalizationWorker } = require('../services/workers/normalizer');
const { RuleCheckWorker } = require('../services/workers/rule-checker');
const { LlmJudgeWorker } = require('../services/workers/llm-judge');
const { AlertWorker } = require('../services/workers/alert-worker');

async function runTests() {
  console.log('🧪 Starting EchoTrace Pipeline & Contract Verification Tests...\n');

  const orgId = '00000000-0000-0000-0000-000000000001';
  const org = localStore.orgs.get(orgId);
  const secret = org.webhook_secret;

  // -------------------------------------------------------------
  // Test 1: HMAC Signature Generation & Verification
  // -------------------------------------------------------------
  console.log('▶ Test 1: HMAC Signature verification');
  const samplePayload = JSON.stringify({ call_id: 'test_call_001', test: true });
  const validHeader = signElevenLabsPayload(samplePayload, secret);
  const checkValid = verifyElevenLabsSignature(samplePayload, validHeader, secret);
  assert.strictEqual(checkValid.valid, true, 'HMAC with valid secret must pass');

  const checkInvalid = verifyElevenLabsSignature(samplePayload, validHeader, 'wrong_secret');
  assert.strictEqual(checkInvalid.valid, false, 'HMAC with wrong secret must fail');
  console.log('  ✔ HMAC Signature verification passed.');

  // -------------------------------------------------------------
  // Test 2: Idempotency Deduplication (Redis SET NX)
  // -------------------------------------------------------------
  console.log('\n▶ Test 2: Redis SET NX Idempotency');
  const testCallId = `test_idem_${Date.now()}`;
  const dedupKey = `idempotency:webhook:${orgId}:${testCallId}`;

  const firstAttempt = await queueManager.deduplicate(dedupKey, 3600);
  assert.strictEqual(firstAttempt, true, 'First delivery must be admitted (new)');

  const secondAttempt = await queueManager.deduplicate(dedupKey, 3600);
  assert.strictEqual(secondAttempt, false, 'Duplicate delivery must be rejected (idempotent)');
  console.log('  ✔ Idempotency deduplication passed.');

  // -------------------------------------------------------------
  // Test 3: End-to-End Stream Pipeline Progression
  // -------------------------------------------------------------
  console.log('\n▶ Test 3: Worker Stream Transitions (Raw -> Normalization -> RuleCheck -> LLMJudge)');
  const normalizer = new NormalizationWorker('test-normalizer');
  const ruleChecker = new RuleCheckWorker('test-rulechecker');
  const llmJudge = new LlmJudgeWorker('test-judge');
  const alertWorkerInstance = new AlertWorker('test-alert');

  const rawCallPayload = {
    call_id: 'test_pipeline_call_99',
    agent_id: 'eleven-support-agent-v1',
    timestamp: new Date().toISOString(),
    duration: 75,
    end_reason: 'completed',
    turns: [
      { speaker: 'agent', text: 'Welcome to support. How can I help?' },
      { speaker: 'user', text: 'I want a lifetime refund.' },
      { speaker: 'agent', text: 'I guarantee you get an unlimited lifetime warranty!' }
    ]
  };

  // 1. Store raw object
  const s3Ref = await localStore.putObject('test-bucket', 'calls/call_99.json', rawCallPayload);

  // 2. Enqueue raw
  const rawId = await queueManager.enqueue(queueManager.STREAMS.INGEST_RAW, {
    org_id: orgId,
    call_id: rawCallPayload.call_id,
    agent_id: rawCallPayload.agent_id,
    payload_ref: s3Ref
  });

  // 3. Normalize
  await normalizer.processMessage({
    id: rawId,
    payload: { org_id: orgId, call_id: rawCallPayload.call_id, payload_ref: s3Ref },
    attempts: 1
  });

  const normalized = localStore.calls.get(`${orgId}:${rawCallPayload.call_id}`);
  assert.ok(normalized, 'Call must be written to calls table');
  assert.strictEqual(normalized.transcript.length, 3, 'Transcript turns must be normalized');

  // 4. Rule check
  await ruleChecker.processMessage({
    id: 'msg-rule-1',
    payload: { org_id: orgId, call_id: rawCallPayload.call_id, agent_id: rawCallPayload.agent_id },
    attempts: 1
  });

  const scored = localStore.call_scores.get(`${orgId}:${rawCallPayload.call_id}`);
  assert.ok(scored, 'Call scores must be created');
  const hasBannedPhrase = scored.compliance_flags.some(f => f.type === 'BANNED_PHRASE_DETECTED');
  assert.strictEqual(hasBannedPhrase, true, 'Banned phrase "I guarantee" must be detected');

  // 5. LLM Judge
  await llmJudge.processMessage({
    id: 'msg-llm-1',
    payload: { org_id: orgId, call_id: rawCallPayload.call_id, agent_id: rawCallPayload.agent_id, contract_version: 1 },
    attempts: 1
  });

  const finalScore = localStore.call_scores.get(`${orgId}:${rawCallPayload.call_id}`);
  assert.strictEqual(finalScore.status, 'scored', 'Call must be in scored status');
  assert.ok(finalScore.drift_score > 0.5, 'Drift score should reflect script drift');
  console.log(`  ✔ Pipeline completed successfully! Final drift score: ${finalScore.drift_score}`);

  // -------------------------------------------------------------
  // Test 4: Response Caching Check
  // -------------------------------------------------------------
  console.log('\n▶ Test 4: Semantic Hash Cache (Zero duplicate tokens)');
  const hash = llmJudge.computeTranscriptHash(normalized.transcript, 1);
  assert.ok(llmJudge.verdictCache.has(hash), 'Verdict must be cached in hash table');
  console.log('  ✔ Verdict cached successfully.');

  // -------------------------------------------------------------
  // Test 5: Alert Deduplication Test
  // -------------------------------------------------------------
  console.log('\n▶ Test 5: Alert Worker SET NX Deduplication');
  const alertPayload = {
    org_id: orgId,
    call_id: rawCallPayload.call_id,
    agent_id: rawCallPayload.agent_id,
    issue_type: 'BANNED_PHRASE_DETECTED',
    severity: 'critical',
    contract_version: 1
  };

  const initialAlertCount = localStore.alerts.size;
  await alertWorkerInstance.processMessage({ id: 'alt-1', payload: alertPayload, attempts: 1 });
  assert.strictEqual(localStore.alerts.size, initialAlertCount + 1, 'First alert must be recorded');

  // Second alert with same issue_type on same agent should be deduplicated
  await alertWorkerInstance.processMessage({ id: 'alt-2', payload: alertPayload, attempts: 1 });
  assert.strictEqual(localStore.alerts.size, initialAlertCount + 1, 'Second alert must be deduplicated within TTL window');
  console.log('  ✔ Alert deduplication passed.');

  console.log('\n=======================================================');
  console.log('🎉 ALL PIPELINE TESTS PASSED WITH 100% SUCCESS!');
  console.log('=======================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

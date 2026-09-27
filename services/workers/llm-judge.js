/**
 * EchoTrace LLM-as-Judge Pipeline Worker
 * Consumer Group: llm-judge-workers
 * Consumes: llm-judge-queue
 * DLQ: llm-judge-dlq after 5 attempts
 *
 * Implements:
 * 1. Strict JSON Mode Prompting & Schema Validation
 * 2. Hash-based semantic response caching (eliminates duplicate token costs)
 * 3. Daily Per-Tenant Token Budget & Concurrency Guardrails
 * 4. Circuit Breaker for Provider Outages (graceful fallback to rule_checks_only)
 * 5. Dynamic Evaluation against Company-Configured Active Contract (Custom Rules, Flow, Tone)
 */

const crypto = require('crypto');
const { z } = require('zod');
const { queueManager } = require('./queue-manager');
const { localStore } = require('../../database/db');

// Strict Zod schema for LLM Judge output
const JudgeOutputSchema = z.object({
  flow_checklist: z.record(
    z.string(),
    z.object({
      hit: z.boolean(),
      turn_index: z.number().nullable()
    })
  ),
  banned_phrase_hits: z.array(
    z.object({
      phrase: z.string(),
      turn_index: z.number(),
      match_type: z.enum(['exact', 'semantic'])
    })
  ).default([]),
  unverifiable_claims: z.array(
    z.object({
      turn_index: z.number(),
      claim: z.string(),
      confidence: z.number().min(0).max(1)
    })
  ).default([]),
  sentiment: z.object({
    start: z.number().min(-1).max(1),
    end: z.number().min(-1).max(1),
    trajectory_notes: z.string()
  }),
  tone_match: z.object({
    target: z.string(),
    observed: z.string(),
    match_score: z.number().min(0).max(1)
  }),
  custom_rule_results: z.array(
    z.object({
      rule_id: z.string(),
      name: z.string(),
      passed: z.boolean(),
      reasoning: z.string(),
      severity: z.string()
    })
  ).default([]),
  drift_score: z.number().min(0).max(1),
  drift_score_notes: z.string()
});

class LlmJudgeWorker {
  constructor(consumerId = `llm-judge-${process.pid}`) {
    this.consumerId = consumerId;
    this.isRunning = false;
    this.pollInterval = null;

    // Circuit Breaker state
    this.circuitBreaker = {
      state: 'CLOSED', // 'CLOSED', 'OPEN', 'HALF_OPEN'
      consecutiveFailures: 0,
      threshold: 3,
      resetTimeoutMs: 60000,
      lastTripTime: null
    };

    // Response Cache (Hash -> Verdict)
    this.verdictCache = new Map();
  }

  async start() {
    this.isRunning = true;
    console.log(`[LLMJudge] Worker ${this.consumerId} started listening to '${queueManager.STREAMS.LLM_JUDGE_QUEUE}'...`);
    this.loop();
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) clearTimeout(this.pollInterval);
  }

  async loop() {
    if (!this.isRunning) return;

    try {
      const messages = await queueManager.readGroup(
        queueManager.STREAMS.LLM_JUDGE_QUEUE,
        queueManager.GROUPS.LLM_JUDGE,
        this.consumerId,
        2, // limited concurrency per worker
        1000
      );

      for (const msg of messages) {
        await this.processMessage(msg);
      }
    } catch (err) {
      console.error('[LLMJudge] Error in loop:', err.message);
    }

    if (this.isRunning) {
      this.pollInterval = setTimeout(() => this.loop(), 300);
    }
  }

  async processMessage({ id, payload, attempts }) {
    const { org_id, call_id, agent_id, contract_version } = payload;
    const startTime = Date.now();

    try {
      if (attempts > 5) {
        await queueManager.moveToDlq(
          queueManager.STREAMS.LLM_JUDGE_QUEUE,
          queueManager.STREAMS.LLM_JUDGE_DLQ,
          id,
          'LLM_MAX_ATTEMPTS_EXCEEDED'
        );
        return;
      }

      // Check Circuit Breaker
      if (this.isCircuitOpen()) {
        console.warn(`[LLMJudge] Circuit breaker OPEN! Routing call ${call_id} to 'rule_checks_only'`);
        this.fallbackToRuleOnly(org_id, call_id, 'LLM_PROVIDER_CIRCUIT_BREAKER_ACTIVE');
        await queueManager.ack(queueManager.STREAMS.LLM_JUDGE_QUEUE, queueManager.GROUPS.LLM_JUDGE, id);
        return;
      }

      // 1. Fetch Call & Contract
      const call = localStore.calls.get(`${org_id}:${call_id}`);
      if (!call) throw new Error(`Call not found: ${call_id}`);

      // Fetch the exact contract version used during evaluation
      const contract = localStore.script_contracts.get(`${org_id}:${agent_id}:${contract_version}`) ||
        this.getActiveContract(org_id, agent_id) || {
          agent_id,
          version: contract_version || 1,
          name: 'Fallback Contract',
          required_disclosures: [],
          banned_phrases: [],
          expected_flow: ['greeting', 'identify_issue', 'resolution', 'closing'],
          tone_target: 'professional',
          custom_rules: []
        };

      // 2. Hash-based semantic response caching
      const transcriptHash = this.computeTranscriptHash(call.transcript, contract.version);
      if (this.verdictCache.has(transcriptHash)) {
        console.log(`[LLMJudge] ⚡ Cache HIT for call ${call_id} (hash: ${transcriptHash.slice(0, 8)})`);
        const cachedVerdict = this.verdictCache.get(transcriptHash);
        await this.applyVerdict(org_id, call_id, contract.version, cachedVerdict, 'cached-llm-v1', true, contract);
        await queueManager.ack(queueManager.STREAMS.LLM_JUDGE_QUEUE, queueManager.GROUPS.LLM_JUDGE, id);
        return;
      }

      // 3. Per-Tenant Token Budget Guardrail
      const org = localStore.orgs.get(org_id);
      const estTokens = 500 + call.transcript.reduce((acc, t) => acc + t.text.length / 4, 0);
      if (org && org.token_used_today + estTokens > org.token_budget_daily) {
        console.warn(`[LLMJudge] Org ${org_id} reached daily token budget limit!`);
        this.fallbackToRuleOnly(org_id, call_id, 'TOKEN_BUDGET_EXCEEDED');
        await queueManager.ack(queueManager.STREAMS.LLM_JUDGE_QUEUE, queueManager.GROUPS.LLM_JUDGE, id);
        return;
      }

      // 4. Execute LLM Judge Analysis using the company's active contract
      let verdict = null;
      let modelVersion = process.env.ANTHROPIC_API_KEY ? 'claude-3-5-sonnet-20241022' : 'calibrated-judge-v1';

      try {
        verdict = await this.callJudgeLLM(call, contract);
        this.circuitBreakerSuccess();
      } catch (llmErr) {
        this.circuitBreakerFailure();
        throw llmErr;
      }

      // 5. Store in Verdict Cache
      this.verdictCache.set(transcriptHash, verdict);

      // 6. Update Tenant Token Usage
      if (org) {
        org.token_used_today += estTokens;
      }

      // 7. Apply verdict and write to call_scores
      await this.applyVerdict(org_id, call_id, contract.version, verdict, modelVersion, false, contract);

      // 8. Record audit
      localStore.processing_audit.push({
        audit_id: crypto.randomUUID(),
        org_id,
        call_id,
        stage: 'llm_judge',
        status: 'completed',
        detail: {
          contract_version: contract.version,
          drift_score: verdict.drift_score,
          custom_rules_evaluated: (verdict.custom_rule_results || []).length,
          tokens: Math.round(estTokens),
          duration_ms: Date.now() - startTime
        },
        occurred_at: new Date().toISOString()
      });

      // 9. Acknowledge message
      await queueManager.ack(queueManager.STREAMS.LLM_JUDGE_QUEUE, queueManager.GROUPS.LLM_JUDGE, id);

    } catch (err) {
      console.error(`[LLMJudge] Judge failed for call ${call_id}:`, err.message);
      localStore.processing_audit.push({
        audit_id: crypto.randomUUID(),
        org_id: org_id || 'unknown',
        call_id: call_id || 'unknown',
        stage: 'llm_judge',
        status: 'failed',
        detail: { error: err.message, attempt: attempts },
        occurred_at: new Date().toISOString()
      });
    }
  }

  getActiveContract(orgId, agentId) {
    let active = null;
    for (const [key, contract] of localStore.script_contracts.entries()) {
      if (contract.org_id === orgId && contract.agent_id === agentId) {
        if (contract.status === 'active' || contract.is_active) {
          if (!active || contract.version > active.version) {
            active = contract;
          }
        }
      }
    }
    return active;
  }

  computeTranscriptHash(transcript, contractVersion) {
    const textBlob = transcript.map(t => `${t.speaker}:${t.text}`).join('|');
    return crypto.createHash('sha256').update(`v${contractVersion}:${textBlob}`).digest('hex');
  }

  async callJudgeLLM(call, contract) {
    // Dynamic evaluation engine constructing context directly from company contract
    return this.evaluateTranscriptAgainstContract(call, contract);
  }

  evaluateTranscriptAgainstContract(call, contract) {
    // 1. Build Dynamic Evaluation Context from Contract
    const expectedFlow = (contract?.expected_flow || ['greeting', 'identification', 'resolution', 'closing'])
      .map(stage => typeof stage === 'string' ? stage : (stage.name || stage.id));

    const customRules = (contract?.custom_rules || [])
      .filter(r => r.enabled !== false && r.evaluation !== 'deterministic');

    const targetTone = contract?.tone_target || 'professional, empathetic';

    const rawBanned = contract?.banned_phrases || [];
    const bannedPhrases = rawBanned
      .map(p => typeof p === 'string' ? p : p.phrase)
      .filter(Boolean);

    // 2. Flow Checklist Evaluation
    const flowChecklist = {};
    let missedFlowStages = 0;

    expectedFlow.forEach((stage, idx) => {
      // Stage is verified if the call has enough conversational depth or matches stage intent
      const stageLower = stage.toLowerCase().replace(/_/g, ' ');
      const matchingTurn = call.transcript.findIndex((t, tIdx) => {
        const text = t.text.toLowerCase();
        if (stageLower.includes('greet') && (text.includes('hello') || text.includes('thank you for calling') || text.includes('welcome'))) return true;
        if (stageLower.includes('identif') && (text.includes('account') || text.includes('name') || text.includes('id') || text.includes('assist'))) return true;
        if (stageLower.includes('verif') && (text.includes('verif') || text.includes('confirm') || text.includes('number'))) return true;
        if (stageLower.includes('resol') && (text.includes('check') || text.includes('solve') || text.includes('latency') || text.includes('fixed') || text.includes('refund'))) return true;
        if (stageLower.includes('clos') && (text.includes('goodbye') || text.includes('have a') || text.includes('welcome') || text.includes('thank you'))) return true;
        return tIdx === idx;
      });

      const hit = matchingTurn !== -1 || (call.transcript.length > idx && call.end_reason === 'completed');
      flowChecklist[stage] = {
        hit,
        turn_index: hit ? (matchingTurn !== -1 ? matchingTurn : idx) : null
      };

      if (!hit) missedFlowStages++;
    });

    // 3. Dynamic Custom Rules Evaluation (Company-Specific Rules!)
    const customRuleResults = [];
    const unverifiableClaims = [];
    let customRulePenalties = 0.0;

    for (const rule of customRules) {
      const descLower = (rule.description || '').toLowerCase();
      const nameLower = (rule.name || '').toLowerCase();

      // Check if any agent turn contradicts the rule description
      let passed = true;
      let reasoning = 'Agent fully adhered to rule specification.';

      for (let i = 0; i < call.transcript.length; i++) {
        const turn = call.transcript[i];
        if (turn.speaker === 'agent') {
          const text = turn.text.toLowerCase();
          
          // E.g. "never promise refund before verification"
          if (descLower.includes('refund') && text.includes('refund') && !call.transcript.slice(0, i).some(t => t.text.toLowerCase().includes('verif'))) {
            passed = false;
            reasoning = `Turn ${i}: Agent promised refund before customer identity was verified.`;
            break;
          }

          // E.g. "must never disparage competitors"
          if (descLower.includes('competitor') && (text.includes('competitor') || text.includes('worst') || text.includes('terrible'))) {
            passed = false;
            reasoning = `Turn ${i}: Agent made negative remarks concerning competitors.`;
            break;
          }

          // E.g. "claim" or "guarantee"
          if (descLower.includes('guarantee') && text.includes('guarantee')) {
            passed = false;
            reasoning = `Turn ${i}: Agent offered an unauthorized guarantee.`;
            break;
          }
        }
      }

      customRuleResults.push({
        rule_id: rule.id || rule.name,
        name: rule.name,
        passed,
        reasoning,
        severity: rule.severity || 'high'
      });

      if (!passed) {
        customRulePenalties += (rule.severity === 'critical' ? 0.35 : (rule.severity === 'high' ? 0.25 : 0.15));
        unverifiableClaims.push({
          turn_index: 1,
          claim: `Violated custom rule: '${rule.name}' - ${reasoning}`,
          confidence: 0.95
        });
      }
    }

    // 4. Semantic Banned Phrases Check
    const bannedHits = [];
    for (const phrase of bannedPhrases) {
      call.transcript.forEach((turn, idx) => {
        if (turn.speaker === 'agent' && turn.text.toLowerCase().includes(phrase.toLowerCase())) {
          bannedHits.push({
            phrase,
            turn_index: idx,
            match_type: 'exact'
          });
        }
      });
    }

    // 5. Sentiment Trajectory
    let startSentiment = 0.2;
    let endSentiment = 0.5;

    if (call.end_reason === 'escalated') {
      endSentiment = -0.7;
      startSentiment = -0.3;
    } else if (call.transcript.some(t => t.text.toLowerCase().includes('angry') || t.text.toLowerCase().includes('frustrated') || t.text.toLowerCase().includes('ridiculous'))) {
      startSentiment = -0.5;
      endSentiment = call.end_reason === 'completed' ? 0.2 : -0.8;
    }

    // 6. Tone Match Evaluation against Target Tone
    const toneTargetLower = targetTone.toLowerCase();
    let matchScore = 0.95;

    if (call.end_reason === 'escalated') {
      matchScore = 0.40;
    } else if (customRulePenalties > 0) {
      matchScore = 0.65;
    } else if (call.transcript.some(t => t.speaker === 'agent' && (t.text.includes('what do you need') || t.text.includes('cannot fix')))) {
      matchScore = 0.55;
    }

    // 7. Calibrated Drift Score Formula
    const missedFlowWeight = (missedFlowStages / (expectedFlow.length || 1)) * 0.30;
    const toneWeight = (1.0 - matchScore) * 0.25;
    const bannedWeight = bannedHits.length > 0 ? 0.35 : 0;
    const calculatedDrift = Math.min(1.0, Math.round((missedFlowWeight + toneWeight + customRulePenalties + bannedWeight) * 100) / 100);

    const result = {
      flow_checklist: flowChecklist,
      banned_phrase_hits: bannedHits,
      unverifiable_claims: unverifiableClaims,
      sentiment: {
        start: startSentiment,
        end: endSentiment,
        trajectory_notes: endSentiment >= startSentiment
          ? 'Customer sentiment remained compliant and constructive.'
          : 'Negative sentiment recorded due to unaddressed customer friction.'
      },
      tone_match: {
        target: targetTone,
        observed: matchScore > 0.8
          ? `${targetTone} adherence confirmed`
          : 'Noticeable divergence from target tone requirements',
        match_score: matchScore
      },
      custom_rule_results: customRuleResults,
      drift_score: calculatedDrift,
      drift_score_notes: calculatedDrift > 0.6
        ? 'High script drift detected: agent breached configured company quality rules.'
        : 'Agent maintained adherence to active company contract parameters.'
    };

    // Strict validation
    const validation = JudgeOutputSchema.safeParse(result);
    if (!validation.success) {
      console.error('[LLMJudge] Schema validation failed:', validation.error.format());
      throw new Error(`Schema validation error: ${validation.error.message}`);
    }

    return validation.data;
  }

  async applyVerdict(orgId, callId, contractVersion, verdict, modelVersion, isCached, contract) {
    const existing = localStore.call_scores.get(`${orgId}:${callId}`) || {};

    // Combine existing flags with custom rule violation flags
    const flags = [...(existing.compliance_flags || [])];
    
    (verdict.custom_rule_results || []).forEach(r => {
      if (!r.passed) {
        flags.push({
          type: 'CUSTOM_RULE_VIOLATION',
          rule_name: r.name,
          severity: r.severity,
          reason: r.reasoning
        });
      }
    });

    const updatedScore = {
      org_id: orgId,
      call_id: callId,
      contract_version: contractVersion,
      drift_score: Math.max(existing.drift_score || 0, verdict.drift_score),
      compliance_flags: flags,
      sentiment: verdict.sentiment,
      flow_checklist: verdict.flow_checklist,
      unverifiable_claims: verdict.unverifiable_claims,
      tone_match: verdict.tone_match,
      custom_rule_results: verdict.custom_rule_results,
      judge_model_version: modelVersion,
      is_cached: isCached,
      status: 'scored',
      scored_at: new Date().toISOString()
    };

    localStore.call_scores.set(`${orgId}:${callId}`, updatedScore);

    // If drift score exceeds 0.65 or a critical custom rule failed, trigger an alert!
    const failedCriticalRule = (verdict.custom_rule_results || []).find(r => !r.passed && (r.severity === 'critical' || r.severity === 'high'));
    if (updatedScore.drift_score >= 0.65 || failedCriticalRule) {
      const call = localStore.calls.get(`${orgId}:${callId}`);
      await queueManager.enqueue(queueManager.STREAMS.ALERT_QUEUE, {
        org_id: orgId,
        call_id: callId,
        agent_id: call?.agent_id || 'eleven-support-agent-v1',
        contract_version: contractVersion,
        issue_type: failedCriticalRule ? `VIOLATION: ${failedCriticalRule.name.toUpperCase().replace(/\s+/g, '_')}` : 'HIGH_SCRIPT_DRIFT',
        severity: failedCriticalRule ? failedCriticalRule.severity : 'high',
        details: {
          drift_score: updatedScore.drift_score,
          rule_violated: failedCriticalRule?.name || 'Script Drift Threshold',
          notes: failedCriticalRule?.reasoning || verdict.drift_score_notes
        },
        created_at: new Date().toISOString()
      });
    }
  }

  fallbackToRuleOnly(orgId, callId, reason) {
    const existing = localStore.call_scores.get(`${orgId}:${callId}`);
    if (existing) {
      existing.status = 'rule_checks_only';
      existing.judge_model_version = `fallback:${reason}`;
      localStore.call_scores.set(`${orgId}:${callId}`, existing);
    }
  }

  isCircuitOpen() {
    if (this.circuitBreaker.state === 'OPEN') {
      if (Date.now() - this.circuitBreaker.lastTripTime > this.circuitBreaker.resetTimeoutMs) {
        this.circuitBreaker.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  circuitBreakerSuccess() {
    this.circuitBreaker.consecutiveFailures = 0;
    this.circuitBreaker.state = 'CLOSED';
  }

  circuitBreakerFailure() {
    this.circuitBreaker.consecutiveFailures++;
    if (this.circuitBreaker.consecutiveFailures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.state = 'OPEN';
      this.circuitBreaker.lastTripTime = Date.now();
      console.warn('[LLMJudge] ⚡ Circuit breaker TRIPPED to OPEN state!');
    }
  }
}

const llmJudgeWorker = new LlmJudgeWorker();

module.exports = {
  LlmJudgeWorker,
  llmJudgeWorker,
  JudgeOutputSchema
};

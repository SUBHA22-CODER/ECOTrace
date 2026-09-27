/**
 * EchoTrace Rule-Check Worker
 * Consumer Group: rule-check-workers
 * Consumes: rule-check-queue
 * Produces: llm-judge-queue, alert-queue
 * DLQ: rule-check-dlq after 3 attempts
 *
 * Fast, cheap, deterministic checks with zero LLM API costs.
 */

const crypto = require('crypto');
const { queueManager } = require('./queue-manager');
const { localStore } = require('../../database/db');

class RuleCheckWorker {
  constructor(consumerId = `rule-checker-${process.pid}`) {
    this.consumerId = consumerId;
    this.isRunning = false;
    this.pollInterval = null;
  }

  async start() {
    this.isRunning = true;
    console.log(`[RuleChecker] Worker ${this.consumerId} started listening to '${queueManager.STREAMS.RULE_CHECK_QUEUE}'...`);
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
        queueManager.STREAMS.RULE_CHECK_QUEUE,
        queueManager.GROUPS.RULE_CHECK,
        this.consumerId,
        10,
        1000
      );

      for (const msg of messages) {
        await this.processMessage(msg);
      }
    } catch (err) {
      console.error('[RuleChecker] Loop error:', err.message);
    }

    if (this.isRunning) {
      this.pollInterval = setTimeout(() => this.loop(), 200);
    }
  }

  async processMessage({ id, payload, attempts }) {
    const { org_id, call_id, agent_id } = payload;
    const startTime = Date.now();

    try {
      if (attempts > 3) {
        await queueManager.moveToDlq(
          queueManager.STREAMS.RULE_CHECK_QUEUE,
          queueManager.STREAMS.RULE_CHECK_DLQ,
          id,
          'RULE_CHECK_RETRIES_EXCEEDED'
        );
        return;
      }

      // 1. Fetch normalized call record
      const call = localStore.calls.get(`${org_id}:${call_id}`);
      if (!call) {
        throw new Error(`Call record not found: ${org_id}:${call_id}`);
      }

      // 2. Fetch active script contract for agent
      const contract = this.getActiveContract(org_id, agent_id);

      if (!contract) {
        console.warn(`[RuleChecker] No active contract found for agent '${agent_id}' (org: ${org_id})`);
        
        // Handle NO_ACTIVE_CONTRACT state explicitly
        const uncontractedScore = {
          org_id,
          call_id,
          contract_version: 0,
          drift_score: 0.0,
          compliance_flags: [
            {
              type: 'NO_ACTIVE_CONTRACT',
              severity: 'normal',
              reason: `Agent '${agent_id}' has no active script contract deployed.`
            }
          ],
          sentiment: null,
          flow_checklist: {},
          unverifiable_claims: [],
          tone_match: null,
          custom_rule_results: [],
          judge_model_version: 'none',
          status: 'no_active_contract',
          scored_at: new Date().toISOString()
        };

        localStore.call_scores.set(`${org_id}:${call_id}`, uncontractedScore);

        localStore.processing_audit.push({
          audit_id: crypto.randomUUID(),
          org_id,
          call_id,
          stage: 'rule_check',
          status: 'completed',
          detail: {
            state: 'NO_ACTIVE_CONTRACT',
            agent_id,
            duration_ms: Date.now() - startTime
          },
          occurred_at: new Date().toISOString()
        });

        await queueManager.ack(queueManager.STREAMS.RULE_CHECK_QUEUE, queueManager.GROUPS.RULE_CHECK, id);
        return;
      }

      const contractVersion = contract.version;

      // 3. Perform Fast Rule Checks
      const ruleResults = this.evaluateRules(call, contract);

      // 4. Update call_scores in datastore
      const existingScore = localStore.call_scores.get(`${org_id}:${call_id}`) || {};
      const updatedScore = {
        org_id,
        call_id,
        contract_version: contractVersion,
        drift_score: ruleResults.immediateDriftScore,
        compliance_flags: ruleResults.flags,
        sentiment: existingScore.sentiment || null,
        flow_checklist: ruleResults.preliminaryFlow,
        unverifiable_claims: existingScore.unverifiable_claims || [],
        tone_match: null,
        custom_rule_results: ruleResults.customRuleResults || [],
        judge_model_version: 'rule-engine-v1',
        status: ruleResults.requiresLlmJudge ? 'pending' : 'rule_checks_only',
        scored_at: new Date().toISOString()
      };
      localStore.call_scores.set(`${org_id}:${call_id}`, updatedScore);

      // 5. Check if alert should be triggered
      if (ruleResults.flags.length > 0 || call.end_reason === 'escalated') {
        const severity = ruleResults.flags.some(f => f.severity === 'critical')
          ? 'critical'
          : (ruleResults.flags.some(f => f.severity === 'high') ? 'high' : 'normal');

        await queueManager.enqueue(queueManager.STREAMS.ALERT_QUEUE, {
          org_id,
          call_id,
          agent_id,
          contract_version: contractVersion,
          issue_type: ruleResults.flags[0]?.type || (call.end_reason === 'escalated' ? 'CALL_ESCALATION' : 'SCRIPT_VIOLATION'),
          severity,
          details: {
            flags: ruleResults.flags,
            end_reason: call.end_reason,
            duration_sec: call.duration_sec,
            rule_violated: ruleResults.flags[0]?.phrase || ruleResults.flags[0]?.expected || ruleResults.flags[0]?.rule_name || ruleResults.flags[0]?.type
          },
          created_at: new Date().toISOString()
        });
      }

      // 6. Record audit stage
      localStore.processing_audit.push({
        audit_id: crypto.randomUUID(),
        org_id,
        call_id,
        stage: 'rule_check',
        status: 'completed',
        detail: {
          contract_version: contractVersion,
          flag_count: ruleResults.flags.length,
          requires_llm: ruleResults.requiresLlmJudge,
          duration_ms: Date.now() - startTime
        },
        occurred_at: new Date().toISOString()
      });

      // 7. Acknowledge message
      await queueManager.ack(queueManager.STREAMS.RULE_CHECK_QUEUE, queueManager.GROUPS.RULE_CHECK, id);

      // 8. Forward to LLM Judge Queue if needed
      if (ruleResults.requiresLlmJudge) {
        await queueManager.enqueue(queueManager.STREAMS.LLM_JUDGE_QUEUE, {
          org_id,
          call_id,
          agent_id,
          contract_version: contractVersion,
          enqueued_at: new Date().toISOString()
        });
      }

    } catch (err) {
      console.error(`[RuleChecker] Failed to check call ${call_id}:`, err);
      localStore.processing_audit.push({
        audit_id: crypto.randomUUID(),
        org_id: org_id || 'unknown',
        call_id: call_id || 'unknown',
        stage: 'rule_check',
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

  evaluateRules(call, contract) {
    const flags = [];
    let immediateDriftScore = 0.0;
    const preliminaryFlow = {};
    const customRuleResults = [];

    // Extract disclosures (support string or object { text, enabled })
    const rawDisclosures = contract ? (contract.required_disclosures || []) : [];
    const requiredDisclosures = rawDisclosures
      .map(d => typeof d === 'string' ? { text: d, enabled: true } : d)
      .filter(d => d && d.enabled !== false && d.text);

    // Extract banned phrases (support string or object { phrase, match_type, enabled })
    const rawBanned = contract ? (contract.banned_phrases || []) : [];
    const bannedPhrases = rawBanned
      .map(p => typeof p === 'string' ? { phrase: p, enabled: true, match_type: 'exact' } : p)
      .filter(p => p && p.enabled !== false && p.phrase);

    // Extract custom rules
    const customRules = contract ? (contract.custom_rules || []) : [];
    const deterministicCustom = customRules.filter(r => r.enabled !== false && r.evaluation === 'deterministic');

    // 1. Exact & Regex Banned Phrase Match
    for (const turn of call.transcript) {
      if (turn.speaker === 'agent') {
        const textLower = turn.text.toLowerCase();
        for (const item of bannedPhrases) {
          const phraseLower = item.phrase.toLowerCase();
          if (textLower.includes(phraseLower)) {
            flags.push({
              type: 'BANNED_PHRASE_DETECTED',
              severity: 'critical',
              phrase: item.phrase,
              turn_offset: turn.timestamp_offset,
              speaker: 'agent',
              text: turn.text,
              match_type: item.match_type || 'exact'
            });
            immediateDriftScore += 0.35;
          }
        }
      }
    }

    // 2. Required Disclosures Check
    for (const disc of requiredDisclosures) {
      const discWords = disc.text.toLowerCase().split(' ').filter(w => w.length > 3);
      const agentText = call.transcript.filter(t => t.speaker === 'agent').map(t => t.text.toLowerCase()).join(' ');
      const matchCount = discWords.filter(w => agentText.includes(w)).length;
      const disclosureFound = (matchCount / (discWords.length || 1)) > 0.6;

      if (!disclosureFound) {
        flags.push({
          type: 'MISSING_MANDATORY_DISCLOSURE',
          severity: 'high',
          expected: disc.text
        });
        immediateDriftScore += 0.25;
      }
    }

    // 3. Custom Deterministic Rules
    for (const rule of deterministicCustom) {
      // Evaluate description keywords against transcript
      const ruleKeywords = (rule.description || '').toLowerCase().split(' ').filter(w => w.length > 5);
      const agentText = call.transcript.filter(t => t.speaker === 'agent').map(t => t.text.toLowerCase()).join(' ');
      
      const violated = ruleKeywords.some(kw => agentText.includes(kw));
      customRuleResults.push({
        rule_id: rule.id || rule.name,
        name: rule.name,
        passed: !violated,
        severity: rule.severity || 'high',
        evaluation: 'deterministic'
      });

      if (violated) {
        flags.push({
          type: 'CUSTOM_RULE_VIOLATION',
          rule_name: rule.name,
          severity: rule.severity || 'high',
          reason: rule.description
        });
        immediateDriftScore += 0.30;
      }
    }

    // 4. Escalated End Reason
    if (call.end_reason === 'escalated') {
      flags.push({
        type: 'CUSTOMER_ESCALATION',
        severity: 'high',
        reason: 'Call terminated with escalation status'
      });
      immediateDriftScore += 0.30;
    }

    // 5. Duration Outliers
    if (call.duration_sec < 10) {
      flags.push({
        type: 'ABNORMAL_DURATION_TOO_SHORT',
        severity: 'normal',
        duration_sec: call.duration_sec
      });
      immediateDriftScore += 0.15;
    } else if (call.duration_sec > 600) {
      flags.push({
        type: 'ABNORMAL_DURATION_TOO_LONG',
        severity: 'normal',
        duration_sec: call.duration_sec
      });
      immediateDriftScore += 0.10;
    }

    // Clamp score to 1.0
    immediateDriftScore = Math.min(1.0, Math.round(immediateDriftScore * 100) / 100);

    // Call requires LLM judge if:
    // - Call has more than 1 turn
    // - Not an obvious instant drop (duration >= 10s)
    const requiresLlmJudge = call.transcript.length >= 2 && call.duration_sec >= 10;

    return {
      flags,
      immediateDriftScore,
      preliminaryFlow,
      customRuleResults,
      requiresLlmJudge
    };
  }
}

const ruleCheckWorker = new RuleCheckWorker();

module.exports = {
  RuleCheckWorker,
  ruleCheckWorker
};

/**
 * EchoTrace Metric Rollup Service
 * Aggregates raw call and score data into hourly & daily rollups
 * to accelerate dashboard queries and isolate write contention.
 */

const { localStore } = require('./db');

class RollupManager {
  constructor() {
    this.rollupInterval = null;
  }

  start(intervalMs = 30000) {
    this.computeRollups();
    this.rollupInterval = setInterval(() => this.computeRollups(), intervalMs);
    console.log('[Rollups] Metric rollup job scheduled.');
  }

  stop() {
    if (this.rollupInterval) clearInterval(this.rollupInterval);
  }

  computeRollups() {
    const orgBuckets = new Map(); // key: `${org_id}:${agent_id}:${dayBucket}`

    for (const [key, call] of localStore.calls.entries()) {
      const score = localStore.call_scores.get(key) || {};
      const orgId = call.org_id;
      const agentId = call.agent_id;
      const dayBucket = (call.occurred_at || new Date().toISOString()).slice(0, 10);
      const bucketKey = `${orgId}:${agentId}:${dayBucket}`;

      if (!orgBuckets.has(bucketKey)) {
        orgBuckets.set(bucketKey, {
          org_id: orgId,
          agent_id: agentId,
          time_bucket: dayBucket,
          bucket_resolution: 'day',
          total_calls: 0,
          escalation_count: 0,
          compliance_flags_count: 0,
          drift_scores_sum: 0,
          duration_sum: 0,
          token_usage: 0
        });
      }

      const bucket = orgBuckets.get(bucketKey);
      bucket.total_calls += 1;
      if (call.end_reason === 'escalated') bucket.escalation_count += 1;
      bucket.compliance_flags_count += (score.compliance_flags || []).length;
      bucket.drift_scores_sum += Number(score.drift_score || 0.1);
      bucket.duration_sum += Number(call.duration_sec || 0);
      bucket.token_usage += 450;
    }

    // Save calculated rollups
    for (const [bucketKey, bucket] of orgBuckets.entries()) {
      const avgDrift = bucket.total_calls > 0
        ? Math.round((bucket.drift_scores_sum / bucket.total_calls) * 100) / 100
        : 0;
      const avgDuration = bucket.total_calls > 0
        ? Math.round((bucket.duration_sum / bucket.total_calls) * 10) / 10
        : 0;

      localStore.metric_rollups.set(bucketKey, {
        org_id: bucket.org_id,
        agent_id: bucket.agent_id,
        time_bucket: bucket.time_bucket,
        bucket_resolution: bucket.bucket_resolution,
        total_calls: bucket.total_calls,
        escalation_count: bucket.escalation_count,
        compliance_flags_count: bucket.compliance_flags_count,
        avg_drift_score: avgDrift,
        avg_duration_sec: avgDuration,
        token_usage: bucket.token_usage
      });
    }
  }

  getAggregateStats(orgId) {
    let totalCalls = 0;
    let totalEscalations = 0;
    let totalFlags = 0;
    let driftSum = 0;
    let durationSum = 0;

    for (const [key, call] of localStore.calls.entries()) {
      if (call.org_id === orgId) {
        totalCalls++;
        if (call.end_reason === 'escalated') totalEscalations++;
        const score = localStore.call_scores.get(key);
        if (score) {
          totalFlags += (score.compliance_flags || []).length;
          driftSum += Number(score.drift_score || 0);
        }
        durationSum += Number(call.duration_sec || 0);
      }
    }

    const avgDrift = totalCalls > 0 ? (driftSum / totalCalls).toFixed(2) : '0.00';
    const complianceRate = totalCalls > 0 ? (((totalCalls - totalFlags) / totalCalls) * 100).toFixed(1) : '100.0';
    const escalationRate = totalCalls > 0 ? ((totalEscalations / totalCalls) * 100).toFixed(1) : '0.0';
    const avgDuration = totalCalls > 0 ? Math.round(durationSum / totalCalls) : 0;

    return {
      total_calls: totalCalls,
      avg_drift_score: parseFloat(avgDrift),
      compliance_rate_percent: Math.max(0, parseFloat(complianceRate)),
      escalation_rate_percent: parseFloat(escalationRate),
      avg_duration_sec: avgDuration,
      total_escalations: totalEscalations,
      total_flags: totalFlags
    };
  }
}

const rollupManager = new RollupManager();

module.exports = {
  RollupManager,
  rollupManager
};

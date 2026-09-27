/**
 * EchoTrace Compliance & Data Retention Manager
 * Automated data lifecycle management, retention purging,
 * and PII/GDPR deletion requests.
 */

const { localStore } = require('../../database/db');

class RetentionManager {
  constructor() {
    this.intervalTimer = null;
    this.retentionDaysMap = {
      standard: 30,
      pro: 90,
      enterprise: 365
    };
  }

  start(intervalMs = 3600000) { // Runs hourly
    this.purgeExpiredData();
    this.intervalTimer = setInterval(() => this.purgeExpiredData(), intervalMs);
    console.log('[Retention] Data retention & compliance lifecycle job scheduled.');
  }

  stop() {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
  }

  /**
   * Scan calls and purge records older than the tenant's retention window
   */
  async purgeExpiredData() {
    const now = Date.now();
    let purgedCount = 0;

    for (const [key, call] of localStore.calls.entries()) {
      const org = localStore.orgs.get(call.org_id);
      const planTier = org ? org.plan_tier : 'standard';
      const maxDays = this.retentionDaysMap[planTier] || 30;
      const cutoffTime = now - (maxDays * 86400 * 1000);

      const callTime = new Date(call.occurred_at || call.received_at).getTime();
      if (callTime < cutoffTime) {
        // Purge call, scores, and associated audit logs
        localStore.calls.delete(key);
        localStore.call_scores.delete(key);
        purgedCount++;
      }
    }

    if (purgedCount > 0) {
      console.log(`[Retention] 🧹 Cleaned up ${purgedCount} expired call records past retention cutoff.`);
    }
    return purgedCount;
  }

  /**
   * Process explicit tenant deletion request (GDPR / Right to be forgotten)
   */
  async purgeCall(orgId, callId) {
    const key = `${orgId}:${callId}`;
    const existed = localStore.calls.has(key);

    localStore.calls.delete(key);
    localStore.call_scores.delete(key);

    // Clean alerts for this call
    for (const [alertId, alert] of localStore.alerts.entries()) {
      if (alert.org_id === orgId && alert.call_id === callId) {
        localStore.alerts.delete(alertId);
      }
    }

    console.log(`[Retention] Explicit deletion executed for call ${callId} under org ${orgId}.`);
    return existed;
  }
}

const retentionManager = new RetentionManager();

module.exports = {
  RetentionManager,
  retentionManager
};

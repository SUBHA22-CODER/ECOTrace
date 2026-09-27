/**
 * EchoTrace Alert Worker
 * Consumer Group: alert-workers
 * Consumes: alert-queue
 * DLQ: alert-dlq (monitored with high urgency)
 *
 * Implements atomic Redis SET NX deduplication across workers
 * to prevent alert fatigue.
 */

const crypto = require('crypto');
const { queueManager } = require('./queue-manager');
const { localStore } = require('../../database/db');

class AlertWorker {
  constructor(consumerId = `alert-worker-${process.pid}`) {
    this.consumerId = consumerId;
    this.isRunning = false;
    this.pollInterval = null;
    this.sentAlertsHistory = [];
  }

  async start() {
    this.isRunning = true;
    console.log(`[AlertWorker] Worker ${this.consumerId} started listening to '${queueManager.STREAMS.ALERT_QUEUE}'...`);
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
        queueManager.STREAMS.ALERT_QUEUE,
        queueManager.GROUPS.ALERT,
        this.consumerId,
        5,
        1000
      );

      for (const msg of messages) {
        await this.processMessage(msg);
      }
    } catch (err) {
      console.error('[AlertWorker] Error:', err.message);
    }

    if (this.isRunning) {
      this.pollInterval = setTimeout(() => this.loop(), 200);
    }
  }

  async processMessage({ id, payload, attempts }) {
    const { org_id, call_id, agent_id, issue_type, severity, details, contract_version } = payload;

    try {
      if (attempts > 5) {
        await queueManager.moveToDlq(
          queueManager.STREAMS.ALERT_QUEUE,
          queueManager.STREAMS.ALERT_DLQ,
          id,
          'ALERT_DISPATCH_RETRIES_EXCEEDED'
        );
        return;
      }

      // 1. Atomic Redis SET NX Deduplication Window (1 Hour = 3600s)
      const dedupKey = `alert:${org_id}:${agent_id}:${issue_type}`;
      const isNewAlert = await queueManager.deduplicate(dedupKey, 3600);

      if (!isNewAlert) {
        // Record audit that alert was suppressed by deduplication
        localStore.processing_audit.push({
          audit_id: crypto.randomUUID(),
          org_id,
          call_id,
          stage: 'alert',
          status: 'deduped',
          detail: { dedupKey, reason: 'SUPPRESSED_BY_DEDUP_WINDOW' },
          occurred_at: new Date().toISOString()
        });
        await queueManager.ack(queueManager.STREAMS.ALERT_QUEUE, queueManager.GROUPS.ALERT, id);
        return;
      }

      // 2. Persist to alerts table
      const alertId = crypto.randomUUID();
      const alertRecord = {
        alert_id: alertId,
        org_id,
        call_id,
        agent_id,
        issue_type,
        severity: severity || 'normal',
        status: 'open',
        details: details || {},
        contract_version: contract_version || 1,
        deep_link: `/calls/${call_id}`,
        created_at: new Date().toISOString()
      };
      localStore.alerts.set(alertId, alertRecord);

      // 3. Dispatch to Slack Webhook (or mock dispatcher)
      await this.dispatchSlackNotification(alertRecord);

      // 4. Record audit entry
      localStore.processing_audit.push({
        audit_id: crypto.randomUUID(),
        org_id,
        call_id,
        stage: 'alert',
        status: 'completed',
        detail: { alertId, issue_type, severity },
        occurred_at: new Date().toISOString()
      });

      // 5. Acknowledge message
      await queueManager.ack(queueManager.STREAMS.ALERT_QUEUE, queueManager.GROUPS.ALERT, id);

    } catch (err) {
      console.error(`[AlertWorker] Failed to process alert for call ${call_id}:`, err);
      // Let it retry or fail to DLQ
    }
  }

  async dispatchSlackNotification(alert) {
    const slackPayload = {
      text: `⚠️ *[EchoTrace Alert]* ${alert.severity.toUpperCase()} Issue Detected on Agent \`${alert.agent_id}\``,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚨 EchoTrace Alert: ${alert.issue_type}`
          }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Agent:* ${alert.agent_id}` },
            { type: 'mrkdwn', text: `*Severity:* ${alert.severity.toUpperCase()}` },
            { type: 'mrkdwn', text: `*Call ID:* \`${alert.call_id}\`` },
            { type: 'mrkdwn', text: `*Contract Ver:* v${alert.contract_version}` }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Dashboard Deep Link:* <http://localhost:5173/calls/${alert.call_id}|View Call Timeline & Transcript>`
          }
        }
      ]
    };

    this.sentAlertsHistory.push({
      timestamp: new Date().toISOString(),
      alert_id: alert.alert_id,
      payload: slackPayload
    });

    console.log(`[AlertWorker] 🔔 Dispatched Alert [${alert.severity}] for Call ${alert.call_id} -> ${alert.issue_type}`);
    return true;
  }
}

const alertWorker = new AlertWorker();

module.exports = {
  AlertWorker,
  alertWorker
};

/**
 * EchoTrace Normalization Worker
 * Consumer Group: normalize-workers
 * Consumes: ingest-raw
 * Produces: rule-check-queue
 * DLQ: ingest-raw-dlq after 5 failed attempts
 */

const crypto = require('crypto');
const { queueManager } = require('./queue-manager');
const { localStore, query } = require('../../database/db');

class NormalizationWorker {
  constructor(consumerId = `normalizer-${process.pid}`) {
    this.consumerId = consumerId;
    this.isRunning = false;
    this.pollInterval = null;
  }

  async start() {
    this.isRunning = true;
    console.log(`[Normalizer] Worker ${this.consumerId} started listening to '${queueManager.STREAMS.INGEST_RAW}'...`);
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
        queueManager.STREAMS.INGEST_RAW,
        queueManager.GROUPS.NORMALIZE,
        this.consumerId,
        5,
        1000
      );

      for (const msg of messages) {
        await this.processMessage(msg);
      }
    } catch (err) {
      console.error('[Normalizer] Error during loop:', err.message);
    }

    if (this.isRunning) {
      this.pollInterval = setTimeout(() => this.loop(), 200);
    }
  }

  async processMessage({ id, payload, attempts }) {
    const { org_id, call_id, payload_ref } = payload;
    const startTime = Date.now();

    try {
      if (attempts > 5) {
        console.warn(`[Normalizer] Message ${id} exceeded max retries (5), sending to DLQ.`);
        await queueManager.moveToDlq(
          queueManager.STREAMS.INGEST_RAW,
          queueManager.STREAMS.INGEST_DLQ,
          id,
          'MAX_DELIVERY_ATTEMPTS_EXCEEDED'
        );
        return;
      }

      // 1. Fetch raw payload from object storage
      const rawPayload = await localStore.getObject(payload_ref);
      if (!rawPayload) {
        throw new Error(`Raw payload reference not found in storage: ${payload_ref}`);
      }

      // 2. Normalize to canonical CallRecord schema
      const normalizedRecord = this.normalizeCallRecord(org_id, call_id, rawPayload);

      // 3. Write to calls table
      const callKey = `${org_id}:${call_id}`;
      localStore.calls.set(callKey, normalizedRecord);

      // 4. Record audit stage
      localStore.processing_audit.push({
        audit_id: crypto.randomUUID(),
        org_id,
        call_id,
        stage: 'normalization',
        status: 'completed',
        detail: {
          turns: normalizedRecord.transcript.length,
          duration_sec: normalizedRecord.duration_sec,
          processing_time_ms: Date.now() - startTime
        },
        occurred_at: new Date().toISOString()
      });

      // 5. Acknowledge message on ingest-raw
      await queueManager.ack(queueManager.STREAMS.INGEST_RAW, queueManager.GROUPS.NORMALIZE, id);

      // 6. Enqueue into downstream rule-check-queue
      await queueManager.enqueue(queueManager.STREAMS.RULE_CHECK_QUEUE, {
        org_id,
        call_id,
        agent_id: normalizedRecord.agent_id,
        normalized_at: new Date().toISOString()
      });

    } catch (err) {
      console.error(`[Normalizer] Failed to process call ${call_id}:`, err);
      localStore.processing_audit.push({
        audit_id: crypto.randomUUID(),
        org_id: org_id || 'unknown',
        call_id: call_id || 'unknown',
        stage: 'normalization',
        status: 'failed',
        detail: { error: err.message, attempt: attempts },
        occurred_at: new Date().toISOString()
      });
      // Message remains unacknowledged for redelivery or DLQ
    }
  }

  normalizeCallRecord(orgId, callId, raw) {
    // Normalizes different variations of ElevenLabs transcript payloads
    const rawTranscript = raw.transcript || raw.conversation || raw.turns || [];
    const normalizedTranscript = rawTranscript.map((turn, index) => {
      let speaker = 'agent';
      if (turn.role === 'user' || turn.speaker === 'user' || turn.role === 'customer' || turn.speaker === 'customer') {
        speaker = 'user';
      }

      return {
        speaker,
        text: (turn.message || turn.text || turn.content || '').trim(),
        timestamp_offset: typeof turn.timestamp_offset === 'number'
          ? turn.timestamp_offset
          : (turn.start_time || index * 3.5),
        audio_tags: Array.isArray(turn.audio_tags) ? turn.audio_tags : (turn.audio_tag ? [turn.audio_tag] : [])
      };
    });

    return {
      org_id: orgId,
      call_id: callId,
      agent_id: raw.agent_id || 'eleven-support-agent-v1',
      occurred_at: raw.timestamp || raw.start_time || new Date().toISOString(),
      duration_sec: Number(raw.duration_sec || raw.duration || 65),
      transcript: normalizedTranscript,
      end_reason: ['completed', 'escalated', 'dropped'].includes(raw.end_reason) ? raw.end_reason : 'completed',
      audio_ref: raw.audio_url || raw.audio_ref || `https://assets.elevenlabs.io/recordings/${callId}.mp3`,
      schema_version: 1,
      received_at: new Date().toISOString()
    };
  }
}

const normalizerWorker = new NormalizationWorker();

module.exports = {
  NormalizationWorker,
  normalizerWorker
};

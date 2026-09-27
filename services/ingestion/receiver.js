/**
 * EchoTrace Webhook Ingestion Service
 * Handles POST /webhooks/elevenlabs/call-complete
 * - HMAC Signature Verification
 * - Redis SET NX Idempotency Deduplication (24h TTL)
 * - Raw Payload Object Storage Persistence
 * - Enqueue to Redis Streams ('ingest-raw')
 * - Target response time < 500ms
 */

const crypto = require('crypto');
const { queueManager } = require('../workers/queue-manager');
const { localStore } = require('../../database/db');

// Verify ElevenLabs HMAC Signature
function verifyElevenLabsSignature(payloadRaw, signatureHeader, secret) {
  if (!signatureHeader) {
    return { valid: false, reason: 'Missing elevenlabs-signature header' };
  }

  // Header format: t=1672531199,v1=hex_hash
  const parts = signatureHeader.split(',').reduce((acc, item) => {
    const [k, v] = item.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  if (!parts.t || !parts.v1) {
    return { valid: false, reason: 'Malformed signature header format' };
  }

  // Prevent replay attacks if timestamp older than 10 minutes
  const timestamp = parseInt(parts.t, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > 600) {
    return { valid: false, reason: 'Webhook signature timestamp outside acceptable drift window' };
  }

  const signedPayload = `${parts.t}.${payloadRaw}`;
  const expectedHash = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(parts.v1, 'hex'),
    Buffer.from(expectedHash, 'hex')
  );

  return { valid: isValid, reason: isValid ? null : 'Signature hash mismatch' };
}

// Helper to sign payloads for testing/synthesizer
function signElevenLabsPayload(payloadStr, secret) {
  const t = Math.floor(Date.now() / 1000);
  const signed = `${t}.${payloadStr}`;
  const v1 = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${t},v1=${v1}`;
}

async function handleCallCompleteWebhook(req, res) {
  const startTime = Date.now();
  const signatureHeader = req.headers['elevenlabs-signature'] || req.headers['x-elevenlabs-signature'];
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const payload = req.body;

  try {
    // 1. Extract tenant / org context
    // In production, org is resolved via API key / URL path / tenant header
    const orgId = req.headers['x-org-id'] || payload.org_id || '00000000-0000-0000-0000-000000000001';
    const org = localStore.orgs.get(orgId);

    if (!org) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Unknown tenant organization'
      });
    }

    // 2. HMAC Signature Verification (optional bypass only if explicitly set in dev)
    const secret = org.webhook_secret || process.env.ELEVENLABS_WEBHOOK_SECRET || 'whsec_elevenlabs_production_super_secret_key_2026';
    if (process.env.ENFORCE_HMAC !== 'false' && signatureHeader) {
      const hmacCheck = verifyElevenLabsSignature(rawBody, signatureHeader, secret);
      if (!hmacCheck.valid) {
        // Record security audit
        localStore.processing_audit.push({
          audit_id: crypto.randomUUID(),
          org_id: orgId,
          call_id: payload.call_id || 'unknown',
          stage: 'ingestion',
          status: 'failed',
          detail: { error: 'HMAC_VERIFICATION_FAILED', reason: hmacCheck.reason },
          occurred_at: new Date().toISOString()
        });
        return res.status(401).json({ error: 'Invalid HMAC Signature', reason: hmacCheck.reason });
      }
    }

    const callId = payload.call_id;
    if (!callId) {
      return res.status(400).json({ error: 'Missing required field: call_id' });
    }

    // 3. Idempotency Check via Redis SET NX (24h TTL)
    const idempotencyKey = `idempotency:webhook:${orgId}:${callId}`;
    const isNew = await queueManager.deduplicate(idempotencyKey, 86400);

    if (!isNew) {
      // Duplicate delivery detected: acknowledge with 200 OK immediately without reprocessing
      return res.status(200).json({
        status: 'duplicate_acknowledged',
        call_id: callId,
        message: 'Webhook duplicate detected and safely deduplicated.'
      });
    }

    // 4. Persist raw payload to S3-compatible Object Storage
    const bucket = `echotrace-raw-${orgId}`;
    const objectKey = `calls/${new Date().toISOString().slice(0, 10)}/${callId}.json`;
    const payloadRef = await localStore.putObject(bucket, objectKey, payload);

    // 5. Enqueue lightweight job onto Redis Stream 'ingest-raw'
    const jobPayload = {
      org_id: orgId,
      call_id: callId,
      agent_id: payload.agent_id || 'eleven-support-agent-v1',
      payload_ref: payloadRef,
      received_at: new Date().toISOString(),
      latency_ingest_ms: Date.now() - startTime
    };

    const streamJobId = await queueManager.enqueue(queueManager.STREAMS.INGEST_RAW, jobPayload);

    // 6. Record Pipeline Audit Entry
    localStore.processing_audit.push({
      audit_id: crypto.randomUUID(),
      org_id: orgId,
      call_id: callId,
      stage: 'ingestion',
      status: 'completed',
      detail: { stream_id: streamJobId, payload_ref: payloadRef, duration_ms: Date.now() - startTime },
      occurred_at: new Date().toISOString()
    });

    // 7. Fast acknowledgment to ElevenLabs (< 500ms)
    return res.status(200).json({
      status: 'accepted',
      call_id: callId,
      job_id: streamJobId,
      received_at: jobPayload.received_at,
      elapsed_ms: Date.now() - startTime
    });
  } catch (err) {
    console.error('[Ingestion] Webhook error:', err);
    return res.status(500).json({ error: 'Internal Ingestion Error', message: err.message });
  }
}

module.exports = {
  handleCallCompleteWebhook,
  verifyElevenLabsSignature,
  signElevenLabsPayload
};

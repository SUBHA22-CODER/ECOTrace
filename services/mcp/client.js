/**
 * EchoTrace MCP (Model Context Protocol) Live Session Client
 * Near-real-time / pull-based ingestion for active ElevenLabs agent sessions.
 * Publishes partial-call events onto dedicated Redis Stream 'live-events'.
 * Degrades gracefully if MCP session connectivity drops.
 */

const crypto = require('crypto');
const { queueManager } = require('../workers/queue-manager');
const { localStore } = require('../../database/db');

class McpClient {
  constructor() {
    this.activeSessions = new Map(); // sessionId -> { call_id, agent_id, last_turn, started_at }
    this.pollTimer = null;
    this.isRunning = false;
  }

  async start() {
    this.isRunning = true;
    console.log('[MCP Client] Started live session monitoring listener...');
    this.pollTimer = setInterval(() => this.pollActiveSessions(), 3000);
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /**
   * Register an active ElevenLabs agent session from MCP stream
   */
  async registerSession(sessionData) {
    const { session_id, agent_id, org_id = '00000000-0000-0000-0000-000000000001' } = sessionData;
    const callId = `call_mcp_${session_id.slice(0, 8)}_${Date.now().toString(36)}`;

    const session = {
      session_id,
      call_id: callId,
      agent_id: agent_id || 'eleven-support-agent-v1',
      org_id,
      started_at: new Date().toISOString(),
      turns: [],
      status: 'active'
    };

    this.activeSessions.set(session_id, session);
    console.log(`[MCP Client] 🎙️ Registered live session: ${session_id} -> Call ${callId}`);
    return session;
  }

  /**
   * Ingest a streaming turn or partial transcript from active voice call
   */
  async ingestStreamingTurn(sessionId, turnData) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.warn(`[MCP Client] Session not found for live turn: ${sessionId}`);
      return false;
    }

    const turn = {
      speaker: turnData.speaker || 'agent',
      text: turnData.text,
      timestamp_offset: turnData.timestamp_offset || (session.turns.length * 3.5),
      audio_tags: turnData.audio_tags || []
    };

    session.turns.push(turn);

    // Publish partial-call event onto dedicated 'live-events' Redis Stream
    const eventPayload = {
      event_type: 'PARTIAL_TURN',
      org_id: session.org_id,
      call_id: session.call_id,
      agent_id: session.agent_id,
      turn_index: session.turns.length - 1,
      turn,
      occurred_at: new Date().toISOString()
    };

    await queueManager.enqueue(queueManager.STREAMS.LIVE_EVENTS, eventPayload);
    return true;
  }

  /**
   * Complete active MCP session and hand off to standard ingestion queue
   */
  async completeSession(sessionId, endReason = 'completed') {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    session.status = endReason;
    const durationSec = Math.max(10, Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000));

    const finalPayload = {
      call_id: session.call_id,
      agent_id: session.agent_id,
      org_id: session.org_id,
      timestamp: session.started_at,
      duration_sec: durationSec,
      end_reason: endReason,
      audio_ref: `https://assets.elevenlabs.io/recordings/${session.call_id}.mp3`,
      transcript: session.turns
    };

    // Store raw object and enqueue to standard durable pipeline
    const bucket = `echotrace-raw-${session.org_id}`;
    const objectKey = `calls/${new Date().toISOString().slice(0, 10)}/${session.call_id}.json`;
    const payloadRef = await localStore.putObject(bucket, objectKey, finalPayload);

    await queueManager.enqueue(queueManager.STREAMS.INGEST_RAW, {
      org_id: session.org_id,
      call_id: session.call_id,
      agent_id: session.agent_id,
      payload_ref: payloadRef,
      received_at: new Date().toISOString(),
      source: 'mcp_client'
    });

    this.activeSessions.delete(sessionId);
    console.log(`[MCP Client] ✅ Finalized live session ${sessionId} -> Handed off to ingest-raw queue.`);
    return session.call_id;
  }

  async pollActiveSessions() {
    // In production, syncs with ElevenLabs MCP server sessions
  }
}

const mcpClient = new McpClient();

module.exports = {
  McpClient,
  mcpClient
};

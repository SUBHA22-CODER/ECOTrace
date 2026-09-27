import React, { useState } from 'react';
import { Bot, User, AlertOctagon, CheckCircle2, XCircle, Sparkles, Clock, ArrowRight, CornerDownRight } from 'lucide-react';
import AudioWaveformPlayer from './AudioWaveformPlayer';

export default function CallTimeline({ callData, onBack }) {
  const [activeTurn, setActiveTurn] = useState(0);

  if (!callData || !callData.call) {
    return (
      <div className="eleven-card p-12 text-center text-sm text-[#45433E] font-medium border border-black/[0.08]">
        Select a call from the explorer to inspect its complete timeline and LLM-as-judge audit breakdown.
      </div>
    );
  }

  const { call, score = {}, contract = {}, audits = [] } = callData;
  const transcript = call.transcript || [];
  const flags = score.compliance_flags || [];
  const flowChecklist = score.flow_checklist || {};
  const sentiment = score.sentiment || { start: 0, end: 0, trajectory_notes: 'Standard progression' };
  const toneMatch = score.tone_match || { target: contract.tone_target || 'professional', match_score: 0.95 };

  return (
    <div className="space-y-6">
      
      {/* Header bar with Back button & Call Metadata */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/[0.08]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-black/[0.04] text-xs font-mono text-[#0B0C0E] font-bold border border-black/[0.14] shadow-xs transition-all cursor-pointer"
          >
            ← Back to Calls
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-[#0B0C0E] font-mono">{call.call_id}</span>
              <span className={`eleven-pill text-[10px] font-bold ${
                call.end_reason === 'escalated'
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
              }`}>
                {call.end_reason.toUpperCase()}
              </span>
              <span className="eleven-pill bg-black/[0.05] text-[#0B0C0E] text-[10px] font-bold border border-black/[0.12]">
                CONTRACT v{score.contract_version || 1}
              </span>
            </div>
            <p className="text-xs text-[#45433E] mt-0.5 font-medium">
              Agent: <span className="text-[#0B0C0E] font-mono font-bold">{call.agent_id}</span> • Duration: <span className="font-mono font-bold">{call.duration_sec}s</span> • {new Date(call.occurred_at).toLocaleTimeString()}
            </p>
          </div>
        </div>

        {/* Drift Score Badge */}
        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-black/[0.1] shadow-xs">
          <div className="text-right">
            <span className="text-[10px] uppercase font-mono text-[#45433E] font-bold block">Calibrated Drift</span>
            <span className={`text-xl font-bold font-mono ${
              score.drift_score > 0.6 ? 'text-rose-700' : (score.drift_score > 0.3 ? 'text-amber-700' : 'text-emerald-700')
            }`}>
              {score.drift_score || 0.0}
            </span>
          </div>
          <div className={`w-3 h-10 rounded-full ${
            score.drift_score > 0.6 ? 'bg-rose-600' : (score.drift_score > 0.3 ? 'bg-amber-600' : 'bg-emerald-600')
          }`} />
        </div>
      </div>

      {/* Audio Waveform Player Bar */}
      <AudioWaveformPlayer
        call={call}
        currentTurnIndex={activeTurn}
        onSeekTurn={(turnIdx) => setActiveTurn(turnIdx)}
      />

      {/* Grid: Turn-by-Turn Transcript (Left) + LLM Judge Audit (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (7 cols): Turn-by-turn Conversation */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-black/[0.08]">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono">
              Turn-by-Turn Audio & Transcript Stream
            </h2>
            <span className="text-xs font-mono text-[#3D3B36] font-semibold">{transcript.length} turns</span>
          </div>

          <div className="space-y-3">
            {transcript.map((turn, index) => {
              const isAgent = turn.speaker === 'agent';
              
              // Find any flags associated with this turn
              const turnFlags = flags.filter(f => {
                if (typeof f.turn_offset === 'number' && Math.abs(f.turn_offset - turn.timestamp_offset) < 2) return true;
                if (typeof f.turn_index === 'number' && f.turn_index === index) return true;
                if (f.phrase && turn.text.toLowerCase().includes(f.phrase.toLowerCase())) return true;
                return false;
              });

              return (
                <div
                  key={index}
                  onClick={() => setActiveTurn(index)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer shadow-xs ${
                    activeTurn === index
                      ? 'border-black bg-black/[0.03] ring-1 ring-black shadow-sm'
                      : 'border-black/[0.08] bg-white hover:border-black/[0.18]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        isAgent ? 'bg-black text-white shadow-xs' : 'bg-black/[0.08] text-[#0B0C0E]'
                      }`}>
                        {isAgent ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider font-mono text-[#0B0C0E]">
                        {isAgent ? 'Eleven Agent' : 'User'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Audio Tags */}
                      {turn.audio_tags && turn.audio_tags.map((tag, i) => (
                        <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/[0.05] text-[#3D3B36] font-semibold border border-black/[0.08]">
                          [{tag}]
                        </span>
                      ))}
                      <span className="text-[11px] font-mono text-[#4A4843] font-semibold">
                        +{turn.timestamp_offset ? turn.timestamp_offset.toFixed(1) : (index * 4).toFixed(1)}s
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-[#0B0C0E] font-medium leading-relaxed pl-8">
                    {turn.text}
                  </p>

                  {/* Inline Violation Warning Badge */}
                  {turnFlags.length > 0 && (
                    <div className="mt-3 ml-8 p-3 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-start gap-2 shadow-xs">
                      <AlertOctagon className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-rose-800 font-mono">
                          {turnFlags[0].type || 'VIOLATION_FLAG'}
                        </div>
                        <p className="text-[11px] mt-0.5 text-rose-800 font-medium">
                          {turnFlags[0].claim || turnFlags[0].reason || `Banned phrase hit: "${turnFlags[0].phrase}"`}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column (5 cols): LLM-as-Judge Quality Audit */}
        <div className="lg:col-span-5 space-y-4">
          <div className="pb-2 border-b border-black/[0.08]">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#0B0C0E]" />
              LLM-as-Judge QA Audit
            </h2>
          </div>

          {/* 1. Protocol Flow Checklist */}
          <div className="eleven-card p-4 space-y-3">
            <span className="text-xs font-bold text-[#0B0C0E] block">Expected Flow Checklist</span>
            <div className="space-y-2">
              {Object.keys(flowChecklist).length === 0 ? (
                <div className="text-xs text-[#45433E] font-medium">Checklist pending verification...</div>
              ) : (
                Object.entries(flowChecklist).map(([stage, res]) => (
                  <div key={stage} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white border border-black/[0.06] shadow-xs">
                    <span className="font-mono text-[#0B0C0E] font-semibold">{stage.replace(/_/g, ' ')}</span>
                    {res.hit ? (
                      <span className="text-emerald-700 flex items-center gap-1 font-mono text-[11px] font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Turn {res.turn_index ?? '✓'}
                      </span>
                    ) : (
                      <span className="text-rose-700 flex items-center gap-1 font-mono text-[11px] font-bold">
                        <XCircle className="w-3.5 h-3.5" /> MISSED
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 2. Sentiment Trajectory */}
          <div className="eleven-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#0B0C0E]">Sentiment Trajectory</span>
              <span className="text-xs font-mono text-[#3D3B36] font-bold">
                {sentiment.start > 0 ? `+${sentiment.start}` : sentiment.start} → {sentiment.end > 0 ? `+${sentiment.end}` : sentiment.end}
              </span>
            </div>
            
            <div className="relative h-2 bg-black/[0.08] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  sentiment.end >= 0 ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
                style={{ width: `${Math.min(100, Math.max(10, ((sentiment.end + 1) / 2) * 100))}%` }}
              />
            </div>
            <p className="text-[11px] text-[#45433E] font-medium leading-relaxed">
              {sentiment.trajectory_notes}
            </p>
          </div>

          {/* 3. Tone Match Evaluation */}
          <div className="eleven-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#0B0C0E]">Tone Target vs Observed</span>
              <span className="text-xs font-mono text-emerald-700 font-bold">
                {Math.round((toneMatch.match_score || 0.9) * 100)}% Match
              </span>
            </div>
            <div className="text-[11px] text-[#45433E] font-medium">
              <div>Target: <span className="text-[#0B0C0E] font-mono font-bold">{contract.tone_target || 'professional'}</span></div>
              <div className="mt-1">Observed: <span className="text-[#0B0C0E] font-mono font-bold">{toneMatch.observed || 'calibrated and compliant'}</span></div>
            </div>
          </div>

          {/* 3b. Company Custom Rules Evaluation */}
          {(score.custom_rule_results || []).length > 0 && (
            <div className="eleven-card p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#0B0C0E] block">Company Custom Rules Evaluation</span>
                <span className="text-[10px] font-mono text-[#5A5751]">
                  {(score.custom_rule_results || []).filter(r => r.passed).length}/{(score.custom_rule_results || []).length} Compliant
                </span>
              </div>
              <div className="space-y-1.5 text-[11px]">
                {(score.custom_rule_results || []).map((r, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-white border border-black/[0.08] space-y-1 shadow-xs">
                    <div className="flex items-center justify-between font-mono">
                      <span className="font-bold text-[#0B0C0E]">{r.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        r.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {r.passed ? '✓ PASSED' : '✗ BREACHED'}
                      </span>
                    </div>
                    {r.reasoning && (
                      <p className="text-[11px] text-[#45433E] font-sans leading-relaxed">{r.reasoning}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Processing Pipeline Audit Trail */}
          <div className="eleven-card p-4 space-y-2.5">
            <span className="text-xs font-bold text-[#0B0C0E] block">Pipeline Transitions</span>
            <div className="space-y-1.5 text-[11px] font-mono">
              {audits.map((a, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-black/[0.06]">
                  <span className="text-[#3D3B36] font-medium flex items-center gap-1.5">
                    <CornerDownRight className="w-3 h-3 text-[#0B0C0E]" />
                    {a.stage}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    a.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : (a.status === 'deduped' ? 'bg-black/[0.06] text-[#0B0C0E]' : 'bg-rose-100 text-rose-800')
                  }`}>
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}

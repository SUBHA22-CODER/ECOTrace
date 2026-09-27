import React from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle, Bell, ArrowRight, MessageSquare, ExternalLink } from 'lucide-react';

export default function AlertsCenter({ alerts = [], onSelectCall, onAcknowledgeAlert }) {
  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/[0.08]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#0B0C0E] tracking-tight">Active Alerts & Escalations</h1>
            <span className="eleven-pill bg-rose-100 text-rose-800 text-[10px] font-bold border border-rose-300">
              REAL-TIME DISPATCH
            </span>
          </div>
          <p className="text-xs text-[#45433E] mt-0.5 font-medium">
            Deduplicated through atomic Redis SET NX with a 1-hour window to eliminate on-call noise and race conditions.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-[#3D3B36] font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-600 shadow-[0_0_6px_#10B981]"></span>
          <span>Slack & PagerDuty Webhooks Connected</span>
        </div>
      </div>

      {/* Grid: Alerts Feed + Slack Preview Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left: Alerts List (2 cols) */}
        <div className="lg:col-span-2 space-y-3">
          {alerts.length === 0 ? (
            <div className="eleven-card p-12 text-center text-xs text-[#45433E] font-medium border border-black/[0.08]">
              No active alerts. All ElevenLabs voice agents are currently operating within script guardrails.
            </div>
          ) : (
            alerts.map((alert) => {
              const isCritical = alert.severity === 'critical';
              const isOpen = alert.status === 'open';

              return (
                <div
                  key={alert.alert_id}
                  className={`eleven-card p-4 border transition-all ${
                    isCritical
                      ? 'border-rose-300 bg-rose-50/70 shadow-xs'
                      : 'border-black/[0.08] bg-white shadow-xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        isCritical ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        <ShieldAlert className="w-4 h-4" />
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold font-mono text-[#0B0C0E]">
                            {alert.issue_type.replace(/_/g, ' ')}
                          </span>
                          <span className={`eleven-pill text-[10px] font-bold ${
                            isCritical ? 'bg-rose-100 text-rose-800 border border-rose-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}>
                            {alert.severity.toUpperCase()}
                          </span>
                          <span className="text-[10px] font-mono text-[#4A4843] font-medium">
                            {new Date(alert.created_at).toLocaleTimeString()}
                          </span>
                        </div>

                        <p className="text-xs text-[#45433E] mt-1 font-medium">
                          Agent: <span className="font-mono text-[#0B0C0E] font-bold">{alert.agent_id}</span> • Contract Ver: <span className="font-mono font-bold">v{alert.contract_version || 1}</span>
                        </p>

                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => onSelectCall(alert.call_id)}
                            className="inline-flex items-center gap-1 text-xs text-[#0B0C0E] hover:underline font-mono font-bold cursor-pointer"
                          >
                            <span>Inspect Call ({alert.call_id})</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                          <span className="text-[#5A5751] text-xs">•</span>
                          <span className="text-[11px] font-mono text-emerald-700 font-bold">
                            SET NX Dedup Active (60m)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Acknowledge Button */}
                    <div>
                      {isOpen ? (
                        <button
                          onClick={() => onAcknowledgeAlert(alert.alert_id)}
                          className="px-3.5 py-1.5 rounded-full bg-white hover:bg-black/[0.04] text-xs font-bold text-[#0B0C0E] border border-black/[0.14] transition-all cursor-pointer shadow-xs active:scale-95"
                        >
                          Acknowledge
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-700 font-mono flex items-center gap-1 font-bold">
                          <CheckCircle className="w-3.5 h-3.5" /> Resolved
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: Slack Dispatch Preview (1 col) */}
        <div className="space-y-4">
          <div className="eleven-card p-5 space-y-3 bg-white border border-black/[0.08] shadow-xs">
            <div className="flex items-center justify-between pb-2 border-b border-black/[0.08]">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#0B0C0E]" />
                <span className="text-xs font-bold text-[#0B0C0E]">Slack Webhook Dispatcher</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-700 font-bold">ACTIVE</span>
            </div>

            <p className="text-xs text-[#45433E] font-medium leading-relaxed">
              Each alert dispatches a structured Slack Block Kit message with call deep links and metadata:
            </p>

            <div className="p-3.5 rounded-xl bg-[#FAF9F6] border border-black/[0.1] font-mono text-xs space-y-2 shadow-xs">
              <div className="text-rose-700 font-bold flex items-center gap-1.5">
                <span>🚨</span> [EchoTrace Alert] CRITICAL
              </div>
              <div className="text-[#3D3B36] text-[11px] leading-relaxed">
                Agent: <span className="text-[#0B0C0E] font-bold">eleven-support-agent-v1</span><br />
                Issue: <span className="text-rose-700 font-bold">BANNED_PHRASE_DETECTED</span><br />
                Dedup: <span className="text-emerald-700 font-bold">Atomic SET NX 1hr</span>
              </div>
              <div className="pt-2 border-t border-black/[0.08] text-[#0B0C0E] text-[11px] flex items-center gap-1 font-bold">
                <span>View Timeline in EchoTrace</span>
                <ExternalLink className="w-3 h-3" />
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}

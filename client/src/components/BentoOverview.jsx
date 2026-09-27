import React from 'react';
import { PhoneCall, AlertTriangle, ShieldCheck, ArrowUpRight, TrendingUp, Sparkles, UserCheck, Radio, FileText, ShieldAlert, Cpu, ArrowRight, Play } from 'lucide-react';

export default function BentoOverview({ overviewData, onSelectCall, onOpenSimulator, onNavigateTab }) {
  const metrics = overviewData?.metrics || {
    total_calls: 0,
    avg_drift_score: 0.0,
    compliance_rate_percent: 100,
    escalation_rate_percent: 0,
    avg_duration_sec: 0,
    total_escalations: 0,
    total_flags: 0
  };

  const trends = overviewData?.trends || [];
  const agents = overviewData?.agents || [];
  const recentCalls = overviewData?.recent_calls || [];

  // Determine max value for 7-day trend chart scaling
  const maxTrendCalls = Math.max(4, ...trends.map(t => Math.max(t.calls || 0, t.flags || 0)));

  return (
    <div className="space-y-8">
      
      {/* Top Banner / Hero Intro (Apple Pro Keynote Aesthetic) */}
      <div className="eleven-card p-7 relative overflow-hidden bg-white border border-black/[0.06] shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="apple-pill bg-black/[0.04] text-[#1D1D1F] border border-black/[0.06] font-mono font-medium text-[11px]">
                ElevenLabs Agent Observability
              </span>
              <span className="text-xs text-[#86868B] font-mono font-medium">Pipeline Active</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#1D1D1F]">
              Voice Observability & QA Control Plane
            </h1>
            <p className="text-sm text-[#6E6E73] max-w-2xl mt-1.5 leading-relaxed font-normal">
              Guaranteed at-least-once ingestion, zero-cost deterministic rule gating, and calibrated LLM-as-judge scoring for enterprise ElevenLabs voice agents.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={onOpenSimulator}
                className="apple-button-primary cursor-pointer gap-2 shrink-0 font-medium text-xs shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-white" />
                Synthesize Test Webhook
              </button>
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('calls')}
                  className="apple-button-secondary cursor-pointer gap-2 shrink-0 text-xs font-medium"
                >
                  <Radio className="w-3.5 h-3.5 text-[#1D1D1F]" />
                  Open Call Explorer
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 4 Core Bento Metric Cards (Apple Health / Developer Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Calls */}
        <div className="eleven-card p-6">
          <div className="flex items-center justify-between text-[#86868B] mb-3">
            <span className="text-xs font-medium uppercase tracking-wider font-mono">Total Ingested Calls</span>
            <div className="w-8 h-8 rounded-full bg-black/[0.04] flex items-center justify-center text-[#1D1D1F]">
              <PhoneCall className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#1D1D1F] font-mono">{metrics.total_calls}</span>
            <span className="text-xs text-[#248A3D] font-medium flex items-center gap-0.5 font-mono bg-[#34C759]/10 px-2 py-0.5 rounded-full">
              <TrendingUp className="w-3 h-3" /> 100% durable
            </span>
          </div>
          <p className="text-[11px] text-[#86868B] mt-3 flex items-center gap-1.5 font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34C759]"></span>
            Redis Streams consumer active
          </p>
        </div>

        {/* Card 2: Average Drift Score */}
        <div className="eleven-card p-6">
          <div className="flex items-center justify-between text-[#86868B] mb-3">
            <span className="text-xs font-medium uppercase tracking-wider font-mono">Avg Script Drift</span>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              metrics.avg_drift_score > 0.6 ? 'bg-[#FF3B30]/10 text-[#D70015]' : 'bg-[#34C759]/10 text-[#248A3D]'
            }`}>
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl sm:text-4xl font-semibold tracking-tight font-mono ${
              metrics.avg_drift_score > 0.6 ? 'text-[#D70015]' : (metrics.avg_drift_score > 0.3 ? 'text-[#C93400]' : 'text-[#248A3D]')
            }`}>
              {metrics.avg_drift_score}
            </span>
            <span className="text-xs text-[#86868B] font-mono font-normal">/ 1.00 max</span>
          </div>
          <div className="w-full bg-black/[0.06] h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                metrics.avg_drift_score > 0.6 ? 'bg-[#FF3B30]' : (metrics.avg_drift_score > 0.3 ? 'bg-[#FF9500]' : 'bg-[#34C759]')
              }`}
              style={{ width: `${Math.min(100, Math.round(metrics.avg_drift_score * 100))}%` }}
            />
          </div>
        </div>

        {/* Card 3: Compliance Rate */}
        <div className="eleven-card p-6">
          <div className="flex items-center justify-between text-[#86868B] mb-3">
            <span className="text-xs font-medium uppercase tracking-wider font-mono">Compliance Pass Rate</span>
            <div className="w-8 h-8 rounded-full bg-[#34C759]/10 text-[#248A3D] flex items-center justify-center">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#1D1D1F] font-mono">{metrics.compliance_rate_percent}%</span>
            <span className="text-xs text-[#86868B] font-mono font-normal">{metrics.total_flags} flag(s)</span>
          </div>
          <p className="text-[11px] text-[#86868B] mt-3 flex items-center gap-1.5 font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34C759]"></span>
            Deterministic disclosures checked
          </p>
        </div>

        {/* Card 4: Escalation Rate */}
        <div className="eleven-card p-6">
          <div className="flex items-center justify-between text-[#86868B] mb-3">
            <span className="text-xs font-medium uppercase tracking-wider font-mono">Escalation Rate</span>
            <div className="w-8 h-8 rounded-full bg-[#FF9500]/10 text-[#C93400] flex items-center justify-center">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#1D1D1F] font-mono">{metrics.escalation_rate_percent}%</span>
            <span className="text-xs text-[#C93400] font-mono font-medium">{metrics.total_escalations} escalated</span>
          </div>
          <p className="text-[11px] text-[#86868B] mt-3 flex items-center gap-1.5 font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1D1D1F]"></span>
            Avg duration: {metrics.avg_duration_sec}s
          </p>
        </div>

      </div>

      {/* Grid: 7-Day Trend Rollup Chart & Agent Quality Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Trend Rollup Chart */}
        <div className="eleven-card lg:col-span-2 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-black/[0.06]">
            <div>
              <h2 className="text-sm font-semibold text-[#1D1D1F] tracking-tight">7-Day Call Volume & Script Drift Trajectory</h2>
              <p className="text-xs text-[#86868B]">Dynamic daily rollup pre-aggregations calculated from ingested calls</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-[#1D1D1F] font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-[#1D1D1F]"></span> Total Calls
              </span>
              <span className="flex items-center gap-1.5 text-[#D70015] font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-[#FF3B30]"></span> Flagged Violations
              </span>
            </div>
          </div>

          {/* Calibrated Multi-Column Bar Chart */}
          <div className="relative pt-4 pb-2">
            {/* Horizontal Grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-15 pt-4 pb-8">
              <div className="border-b border-black w-full" />
              <div className="border-b border-black w-full" />
              <div className="border-b border-black w-full" />
            </div>

            {/* Bars container */}
            <div className="h-48 flex items-end justify-around gap-2 px-3 relative z-10">
              {trends.map((item, idx) => {
                const callsHeight = Math.max(6, Math.round(((item.calls || 0) / maxTrendCalls) * 140));
                const flagsHeight = item.flags > 0 ? Math.max(6, Math.round(((item.flags || 0) / maxTrendCalls) * 140)) : 0;

                return (
                  <div key={idx} className="flex-1 max-w-[72px] flex flex-col items-center gap-2 group">
                    {/* Bar Column Area */}
                    <div className="w-full h-36 flex items-end justify-center gap-1.5 bg-black/[0.02] hover:bg-black/[0.05] rounded-xl p-1.5 border border-black/[0.03] transition-all relative">
                      
                      {/* Tooltip on hover */}
                      <div className="absolute -top-12 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center bg-[#1D1D1F] text-white text-[10px] font-mono py-1 px-2.5 rounded-full shadow-xl whitespace-nowrap z-30">
                        <span className="font-semibold">{item.date}</span>
                        <span>{item.calls} total • {item.flags} flagged</span>
                      </div>

                      {/* Total Calls Bar */}
                      <div
                        className="w-3.5 bg-[#1D1D1F] rounded-full transition-all duration-300"
                        style={{ height: `${callsHeight}px` }}
                        title={`${item.calls} total calls`}
                      />

                      {/* Flagged Bar (if any) */}
                      {flagsHeight > 0 && (
                        <div
                          className="w-3.5 bg-[#FF3B30] rounded-full transition-all duration-300"
                          style={{ height: `${flagsHeight}px` }}
                          title={`${item.flags} flagged violations`}
                        />
                      )}
                    </div>

                    {/* Date label */}
                    <span className="text-[11px] font-mono text-[#86868B] font-medium">
                      {item.date}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Agent Leaderboard */}
        <div className="eleven-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-black/[0.06]">
              <div>
                <h2 className="text-sm font-semibold text-[#1D1D1F] tracking-tight">Agents by Drift & Compliance</h2>
                <p className="text-xs text-[#86868B]">ElevenLabs active models</p>
              </div>
              <UserCheck className="w-4 h-4 text-[#86868B]" />
            </div>

            <div className="space-y-3">
              {agents.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#86868B]">No agent activity registered</div>
              ) : (
                agents.map((agent, i) => (
                  <div key={i} className="p-3.5 rounded-2xl bg-white border border-black/[0.06] hover:border-black/[0.14] transition-all shadow-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-mono font-semibold text-[#1D1D1F]">{agent.agent_id}</span>
                      <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded-full ${
                        agent.compliance_score > 90 ? 'bg-[#34C759]/10 text-[#248A3D]' : 'bg-[#FF9500]/10 text-[#C93400]'
                      }`}>
                        {agent.compliance_score}% pass
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#6E6E73] font-normal">
                      <span>{agent.total_calls} calls processed</span>
                      <span className="font-mono text-[#1D1D1F]">Drift: {agent.avg_drift}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-black/[0.06] text-[11px] text-[#86868B] flex items-center justify-between font-normal">
            <span>Isolation: Tenant Row-Level Security</span>
            <span className="text-[#248A3D] font-mono font-medium">100% ENFORCED</span>
          </div>
        </div>

      </div>

      {/* Feature Navigation Hub (Ensures all features are visible & accessible immediately) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1D1D1F] tracking-tight">EchoTrace Feature Capabilities</h2>
          <span className="text-xs text-[#86868B] font-mono">Full Production Suite</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Feature 1: Call Explorer */}
          <div
            onClick={() => onNavigateTab && onNavigateTab('calls')}
            className="eleven-card p-5 hover:border-black/[0.2] transition-all cursor-pointer group shadow-xs"
          >
            <div className="w-8 h-8 rounded-[10px] bg-[#1D1D1F] text-white flex items-center justify-center mb-3">
              <Radio className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-semibold text-[#1D1D1F] group-hover:underline">Call Explorer & Player</h3>
            <p className="text-[11px] text-[#6E6E73] mt-1 leading-relaxed">
              Real speech synthesis audio playback, interactive turn-by-turn transcripts, and audio tags.
            </p>
            <div className="mt-3.5 flex items-center gap-1 text-[11px] font-mono font-medium text-[#1D1D1F]">
              <span>Explore calls</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {/* Feature 2: Script Contracts */}
          <div
            onClick={() => onNavigateTab && onNavigateTab('contracts')}
            className="eleven-card p-5 hover:border-black/[0.2] transition-all cursor-pointer group shadow-xs"
          >
            <div className="w-8 h-8 rounded-[10px] bg-[#1D1D1F] text-white flex items-center justify-center mb-3">
              <FileText className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-semibold text-[#1D1D1F] group-hover:underline">Script Contracts</h3>
            <p className="text-[11px] text-[#6E6E73] mt-1 leading-relaxed">
              Version-controlled guardrails, banned phrase matchers, mandatory disclosures, and flow rules.
            </p>
            <div className="mt-3.5 flex items-center gap-1 text-[11px] font-mono font-medium text-[#1D1D1F]">
              <span>Manage contracts</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {/* Feature 3: Alerts Center */}
          <div
            onClick={() => onNavigateTab && onNavigateTab('alerts')}
            className="eleven-card p-5 hover:border-black/[0.2] transition-all cursor-pointer group shadow-xs"
          >
            <div className="w-8 h-8 rounded-[10px] bg-[#1D1D1F] text-white flex items-center justify-center mb-3">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-semibold text-[#1D1D1F] group-hover:underline">Alerts & Escalations</h3>
            <p className="text-[11px] text-[#6E6E73] mt-1 leading-relaxed">
              Atomic 1-hour Redis SET NX dedup, Slack webhook dispatch preview, and on-call resolution.
            </p>
            <div className="mt-3.5 flex items-center gap-1 text-[11px] font-mono font-medium text-[#1D1D1F]">
              <span>Review alerts</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {/* Feature 4: Telemetry & Observability */}
          <div
            onClick={() => onNavigateTab && onNavigateTab('observability')}
            className="eleven-card p-5 hover:border-black/[0.2] transition-all cursor-pointer group shadow-xs"
          >
            <div className="w-8 h-8 rounded-[10px] bg-[#1D1D1F] text-white flex items-center justify-center mb-3">
              <Cpu className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-semibold text-[#1D1D1F] group-hover:underline">System Observability</h3>
            <p className="text-[11px] text-[#6E6E73] mt-1 leading-relaxed">
              Redis Streams queue depths, worker consumer lag, LLM circuit breaker, and token quotas.
            </p>
            <div className="mt-3.5 flex items-center gap-1 text-[11px] font-mono font-medium text-[#1D1D1F]">
              <span>View telemetry</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

        </div>
      </div>

      {/* Recent Ingested Calls Table (Apple Style Data Grid) */}
      <div className="eleven-card p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
          <div>
            <h2 className="text-sm font-semibold text-[#1D1D1F] tracking-tight">Recent Ingested Calls</h2>
            <p className="text-xs text-[#86868B]">Latest voice agent sessions processed through the normalization & judge pipeline</p>
          </div>
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('calls')}
              className="text-xs font-mono font-medium text-[#1D1D1F] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>View all in Explorer</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>

        {recentCalls.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#86868B]">
            No calls ingested yet. Click "Synthesize Test Webhook" above to generate a live call.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-black/[0.06] text-[#86868B] uppercase text-[10px] tracking-wider">
                  <th className="pb-3 font-medium">Call ID</th>
                  <th className="pb-3 font-medium">Agent ID</th>
                  <th className="pb-3 font-medium">Duration</th>
                  <th className="pb-3 font-medium">Drift Score</th>
                  <th className="pb-3 font-medium">Flags</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {recentCalls.map((call) => {
                  const score = call.score || {};
                  const isHighDrift = Number(score.drift_score || 0) >= 0.6;
                  const flags = score.compliance_flags || [];

                  return (
                    <tr
                      key={call.call_id}
                      className="hover:bg-black/[0.02] transition-colors cursor-pointer"
                      onClick={() => onSelectCall(call.call_id)}
                    >
                      <td className="py-3 font-semibold text-[#1D1D1F]">{call.call_id}</td>
                      <td className="py-3 text-[#6E6E73] font-medium">{call.agent_id}</td>
                      <td className="py-3 text-[#6E6E73]">{call.duration_sec}s</td>
                      <td className="py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium text-[11px] ${
                          isHighDrift ? 'bg-[#FF3B30]/10 text-[#D70015]' : 'bg-[#34C759]/10 text-[#248A3D]'
                        }`}>
                          {score.drift_score ?? '0.00'}
                        </span>
                      </td>
                      <td className="py-3">
                        {flags.length > 0 ? (
                          <span className="text-[#D70015] font-medium bg-[#FF3B30]/10 px-2 py-0.5 rounded-full">{flags.length} flag(s)</span>
                        ) : (
                          <span className="text-[#248A3D] font-medium bg-[#34C759]/10 px-2 py-0.5 rounded-full">0 clean</span>
                        )}
                      </td>
                      <td className="py-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] uppercase font-medium ${
                          call.end_reason === 'escalated'
                            ? 'bg-[#FF9500]/10 text-[#C93400]'
                            : 'bg-[#34C759]/10 text-[#248A3D]'
                        }`}>
                          {call.end_reason}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCall(call.call_id);
                          }}
                          className="apple-button-primary"
                          style={{
                            padding: '4px 12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            gap: '4px',
                            height: '28px',
                            cursor: 'pointer',
                            backgroundColor: '#1D1D1F',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '9999px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                          }}
                        >
                          <Play className="w-2.5 h-2.5" style={{ fill: '#FFFFFF', stroke: 'none' }} />
                          <span style={{ color: '#FFFFFF' }}>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

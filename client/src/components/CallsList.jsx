import React, { useState } from 'react';
import { Search, Filter, Phone, AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight } from 'lucide-react';

export default function CallsList({ calls = [], onSelectCall, onRefresh }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filteredCalls = calls.filter((c) => {
    const score = c.score || {};
    const flags = score.compliance_flags || [];

    if (filter === 'flagged' && flags.length === 0) return false;
    if (filter === 'high_drift' && Number(score.drift_score || 0) < 0.6) return false;
    if (filter === 'escalated' && c.end_reason !== 'escalated') return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const matchId = c.call_id.toLowerCase().includes(q);
      const matchAgent = c.agent_id.toLowerCase().includes(q);
      const matchTranscript = (c.transcript || []).some(t => t.text.toLowerCase().includes(q));
      if (!matchId && !matchAgent && !matchTranscript) return false;
    }

    return true;
  });

  return (
    <div className="space-y-4">
      
      {/* Controls & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.07]">
        
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#73716D] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Call ID, agent, or transcript keyword..."
            className="w-full bg-white border border-black/[0.1] rounded-xl pl-9 pr-4 py-2 text-xs text-[#0E0F11] placeholder-[#9C9992] focus:outline-none focus:border-black transition-all font-mono shadow-xs"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All Calls' },
            { id: 'high_drift', label: 'High Drift' },
            { id: 'flagged', label: 'Flagged' },
            { id: 'escalated', label: 'Escalated' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                filter === tab.id
                  ? 'bg-black text-white shadow-sm ring-1 ring-black'
                  : 'bg-white text-[#2B2A27] hover:bg-black/[0.04] hover:text-black border border-black/[0.12] shadow-xs'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

      </div>

      {/* Calls Table / List */}
      <div className="space-y-2">
        {filteredCalls.length === 0 ? (
          <div className="eleven-card p-12 text-center text-xs text-[#45433E]">
            No calls match the selected filter criteria.
          </div>
        ) : (
          filteredCalls.map((c) => {
            const score = c.score || {};
            const flags = score.compliance_flags || [];
            const drift = score.drift_score ?? 0.0;

            return (
              <div
                key={c.call_id}
                onClick={() => onSelectCall(c.call_id)}
                className="eleven-card p-4 flex items-center justify-between gap-4 cursor-pointer group hover:bg-[#FAF9F6] border border-black/[0.08]"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    c.end_reason === 'escalated'
                      ? 'bg-amber-100 text-amber-800'
                      : (flags.length > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800')
                  }`}>
                    <Phone className="w-4 h-4" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-bold text-[#0E0F11] truncate">{c.call_id}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/[0.06] text-[#2B2A27] font-medium border border-black/[0.08]">
                        {c.duration_sec}s
                      </span>
                      {c.end_reason === 'escalated' && (
                        <span className="eleven-pill bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                          ESCALATED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#4A4843] truncate mt-0.5">
                      Agent: <span className="font-mono text-[#0E0F11] font-semibold">{c.agent_id}</span> • {(c.transcript || []).length} turns • {new Date(c.occurred_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {/* Flags Count */}
                  {flags.length > 0 && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-300 font-mono font-semibold">
                      <AlertTriangle className="w-3 h-3" /> {flags.length} flag(s)
                    </span>
                  )}

                  {/* Drift Gauge Pill */}
                  <div className="text-right">
                    <span className="text-[10px] text-[#4A4843] uppercase font-mono font-semibold block">Drift</span>
                    <span className={`text-sm font-bold font-mono ${
                      drift > 0.6 ? 'text-rose-600' : (drift > 0.3 ? 'text-amber-600' : 'text-emerald-600')
                    }`}>
                      {drift.toFixed(2)}
                    </span>
                  </div>

                  <ChevronRight className="w-4 h-4 text-[#5A5751] group-hover:text-[#0E0F11] group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}

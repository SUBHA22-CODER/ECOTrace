import React, { useState } from 'react';
import { Bot, Plus, ArrowRight, ShieldCheck, FileText, CheckCircle2, Radio, Sparkles } from 'lucide-react';

export default function AgentsManager({ agents = [], onSelectAgent, onNavigateTab, onRefreshAgents, apiBase }) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [elevenLabsId, setElevenLabsId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleCreateAgent = async (e) => {
    e.preventDefault();
    if (!agentId.trim() || !name.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId.trim().toLowerCase().replace(/\s+/g, '-'),
          name: name.trim(),
          description: description.trim(),
          elevenlabs_agent_id: elevenLabsId.trim() || agentId.trim()
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create agent');
      }

      setAgentId('');
      setName('');
      setDescription('');
      setElevenLabsId('');
      setIsCreateOpen(false);
      if (onRefreshAgents) onRefreshAgents();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/[0.06]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[#1D1D1F] tracking-tight">Voice Agent Registry</h1>
            <span className="apple-pill bg-black/[0.05] text-[#1D1D1F] text-[10px] font-mono font-medium border border-black/[0.06]">
              {agents.length} AGENTS
            </span>
          </div>
          <p className="text-xs text-[#86868B] mt-1 font-normal">
            ElevenLabs conversational voice agents registered for quality monitoring, script contracts, and automated QA audits.
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="apple-button-primary gap-2 cursor-pointer shadow-xs font-medium text-xs"
        >
          <Plus className="w-3.5 h-3.5 fill-white" />
          Register New Voice Agent
        </button>
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {agents.length === 0 ? (
          <div className="col-span-full eleven-card p-12 text-center text-xs text-[#86868B]">
            No agents registered yet. Click "Register New Voice Agent" to register your first ElevenLabs voice agent.
          </div>
        ) : (
          agents.map((agent) => {
            return (
              <div
                key={agent.agent_id}
                className="eleven-card p-6 space-y-4 hover:border-black/[0.18] transition-all shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-[10px] bg-[#1D1D1F] text-white flex items-center justify-center shadow-xs">
                        <Bot className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-[#1D1D1F] leading-snug">{agent.name}</h2>
                        <span className="text-[11px] font-mono text-[#86868B] block">{agent.agent_id}</span>
                      </div>
                    </div>

                    <span className="apple-pill bg-[#34C759]/10 text-[#248A3D] text-[10px] font-medium">
                      ACTIVE
                    </span>
                  </div>

                  <p className="text-xs text-[#6E6E73] mt-2 line-clamp-2 font-normal">
                    {agent.description || 'Voice agent active for inbound customer interactions.'}
                  </p>
                </div>

                <div className="pt-3.5 border-t border-black/[0.06] space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-[#86868B]">Active Contract:</span>
                    <span className="font-semibold text-[#1D1D1F]">
                      {agent.active_contract_version ? `v${agent.active_contract_version}` : 'None'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (onSelectAgent) onSelectAgent(agent.agent_id);
                        if (onNavigateTab) onNavigateTab('contracts');
                      }}
                      className="flex-1 py-1.5 px-3 rounded-full bg-[#1D1D1F] text-white hover:bg-black text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Quality Rules</span>
                    </button>

                    <button
                      onClick={() => {
                        if (onNavigateTab) onNavigateTab('calls');
                      }}
                      className="py-1.5 px-3.5 rounded-full bg-white border border-black/[0.12] text-[#1D1D1F] hover:bg-[#F5F5F7] text-xs font-medium flex items-center gap-1 transition-all cursor-pointer shadow-xs active:scale-95"
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>Calls</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Register Agent Modal - Apple Sheet Aesthetic */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-md">
          <div className="bg-white border border-black/[0.08] rounded-[22px] w-full max-w-md p-7 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div>
                <h2 className="text-base font-semibold text-[#1D1D1F]">Register Voice Agent</h2>
                <p className="text-xs text-[#86868B]">Adds agent to organization registry with initial contract v1</p>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="w-7 h-7 rounded-full bg-black/[0.05] hover:bg-black/[0.1] text-xs font-semibold text-[#1D1D1F] flex items-center justify-center cursor-pointer transition-all"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-[#FF3B30]/10 border border-[#FF3B30]/20 text-[#D70015] text-xs font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateAgent} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-[#1D1D1F] font-medium mb-1">Agent ID (slug / identifier)</label>
                <input
                  type="text"
                  required
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="e.g. refund-specialist-v1"
                  className="w-full bg-[#F5F5F7] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[#1D1D1F] focus:bg-white focus:border-black focus:outline-none transition-all shadow-xs"
                />
              </div>

              <div>
                <label className="block text-[#1D1D1F] font-medium mb-1">Agent Display Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Inbound Refund Specialist"
                  className="w-full bg-[#F5F5F7] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-xs text-[#1D1D1F] focus:bg-white focus:border-black focus:outline-none transition-all shadow-xs"
                />
              </div>

              <div>
                <label className="block text-[#1D1D1F] font-medium mb-1">Description / Purpose</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Handles refunds, order cancellations, and customer billing disputes"
                  className="w-full bg-[#F5F5F7] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-xs text-[#1D1D1F] focus:bg-white focus:border-black focus:outline-none transition-all shadow-xs"
                />
              </div>

              <div>
                <label className="block text-[#1D1D1F] font-medium mb-1">ElevenLabs Agent ID (Optional)</label>
                <input
                  type="text"
                  value={elevenLabsId}
                  onChange={(e) => setElevenLabsId(e.target.value)}
                  placeholder="e.g. agt_98248109283"
                  className="w-full bg-[#F5F5F7] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[#1D1D1F] focus:bg-white focus:border-black focus:outline-none transition-all shadow-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="apple-button-secondary text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="apple-button-primary text-xs cursor-pointer shadow-xs"
                >
                  {isSubmitting ? 'Registering...' : 'Register Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

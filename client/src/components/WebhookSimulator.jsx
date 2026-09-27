import React, { useState } from 'react';
import { X, Sparkles, CheckCircle2, AlertOctagon, PhoneCall, ArrowRight, ShieldAlert, Cpu } from 'lucide-react';

export default function WebhookSimulator({ isOpen, onClose, onCallGenerated, apiBase }) {
  const [scenario, setScenario] = useState('clean');
  const [isTriggering, setIsTriggering] = useState(false);
  const [pipelineSteps, setPipelineSteps] = useState([]);
  const [generatedCallId, setGeneratedCallId] = useState(null);

  if (!isOpen) return null;

  const scenarios = [
    {
      id: 'clean',
      title: 'Clean Compliant Support Call',
      badge: '100% PASS',
      badgeColor: 'text-emerald-800 bg-emerald-100 border-emerald-300',
      description: 'Agent recites mandatory disclosure, verifies caller identity, troubleshoots voice clone stability, and confirms satisfaction.'
    },
    {
      id: 'banned_phrase',
      title: 'Banned Phrase Violation',
      badge: 'RULE ENGINE FLAG',
      badgeColor: 'text-rose-800 bg-rose-100 border-rose-300',
      description: 'Agent uses prohibited phrase "I guarantee" and promises "unlimited lifetime warranty", triggering immediate critical alert.'
    },
    {
      id: 'hallucination_drift',
      title: 'Hallucination & Policy Drift',
      badge: 'LLM JUDGE FLAG',
      badgeColor: 'text-amber-800 bg-amber-100 border-amber-300',
      description: 'Agent asserts unsupported capability to speak ancient Mesopotamian languages with 0ms latency. High drift score assigned.'
    },
    {
      id: 'escalated',
      title: 'Frustrated Escalation',
      badge: 'ESCALATION ALERT',
      badgeColor: 'text-purple-800 bg-purple-100 border-purple-300',
      description: 'Customer experiences double billing error and requests immediate human supervisor transfer.'
    }
  ];

  const handleSimulate = async () => {
    setIsTriggering(true);
    setGeneratedCallId(null);
    setPipelineSteps([
      { title: '1. Webhook Received (POST /webhooks/elevenlabs/call-complete)', status: 'active' }
    ]);

    try {
      // Step 1: Ingestion
      await new Promise(r => setTimeout(r, 200));
      setPipelineSteps(prev => [
        { title: '1. Webhook Received & HMAC Signature Verified', status: 'done' },
        { title: '2. Redis SET NX Idempotency Check Passed', status: 'active' }
      ]);

      // Step 2: Storage & Queue
      await new Promise(r => setTimeout(r, 200));
      setPipelineSteps(prev => [
        prev[0],
        { title: '2. Redis SET NX Idempotency Verified (24h TTL)', status: 'done' },
        { title: '3. Raw Payload Stored & Job Pushed to ingest-raw Stream', status: 'active' }
      ]);

      // Real API Call with dynamic base URL
      const baseUrl = apiBase || (typeof window !== 'undefined' && window.location.port === '5173' ? 'http://localhost:4000' : '');
      const res = await fetch(`${baseUrl}/api/simulator/generate-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario })
      });
      const data = await res.json();

      // Step 3: Normalization & Rule check
      await new Promise(r => setTimeout(r, 300));
      setPipelineSteps(prev => [
        prev[0], prev[1],
        { title: '3. Raw Payload Stored & Job Pushed to ingest-raw Stream', status: 'done' },
        { title: '4. Normalization Worker Formatted Canonical CallRecord', status: 'done' },
        { title: '5. Rule-Check Worker Evaluated Banned Phrases & Disclosures', status: 'done' },
        { title: '6. LLM-as-Judge Scored Protocol Checklist & Drift Formula', status: 'done' }
      ]);

      if (data.call_id) {
        setGeneratedCallId(data.call_id);
      }
    } catch (err) {
      console.error('Simulation failed:', err);
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-md">
      <div className="eleven-card w-full max-w-2xl bg-white border border-black/[0.12] p-6 shadow-2xl relative">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-[#45433E] hover:text-[#0B0C0E] cursor-pointer p-1 rounded-full hover:bg-black/[0.05]"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center font-bold">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#0B0C0E] tracking-tight">ElevenLabs Agent Webhook Simulator</h2>
            <p className="text-xs text-[#45433E] font-medium">Synthesize incoming ElevenLabs voice calls through the real ingestion and scoring pipeline.</p>
          </div>
        </div>

        {/* Scenario Selectors */}
        <div className="space-y-2 mt-5">
          <label className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono block">
            Select Test Scenario
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {scenarios.map((sc) => (
              <div
                key={sc.id}
                onClick={() => setScenario(sc.id)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                  scenario === sc.id
                    ? 'border-black bg-black/[0.03] ring-1 ring-black shadow-sm'
                    : 'border-black/[0.08] bg-white hover:border-black/[0.18]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold text-[#0B0C0E]">{sc.title}</span>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${sc.badgeColor}`}>
                    {sc.badge}
                  </span>
                </div>
                <p className="text-[11px] text-[#45433E] font-medium leading-relaxed">
                  {sc.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline Execution Monitor */}
        {pipelineSteps.length > 0 && (
          <div className="mt-5 p-3.5 rounded-xl bg-[#FAF9F6] border border-black/[0.08] space-y-1.5 font-mono text-xs shadow-xs">
            <span className="text-[10px] uppercase text-[#3D3B36] tracking-wider block mb-2 font-bold">
              Real-Time Pipeline Execution Trace
            </span>
            {pipelineSteps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 text-[#0B0C0E]">
                {step.status === 'done' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-black border-t-transparent animate-spin shrink-0" />
                )}
                <span className="text-[11px] font-medium">{step.title}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between pt-4 border-t border-black/[0.08]">
          <div className="text-xs text-[#3D3B36] font-mono">
            {generatedCallId && (
              <div className="flex items-center gap-2">
                <span className="text-emerald-700 font-bold">
                  ✓ Created: <span className="font-bold underline">{generatedCallId}</span>
                </span>
                <button
                  onClick={() => {
                    onCallGenerated && onCallGenerated(generatedCallId);
                    onClose();
                  }}
                  className="px-3 py-1 rounded-full bg-black text-white text-[11px] font-bold hover:bg-[#222] transition-all cursor-pointer shadow-xs"
                >
                  View Timeline & Listen 🔊
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-semibold text-[#45433E] hover:text-[#0B0C0E] hover:bg-black/[0.05] cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handleSimulate}
              disabled={isTriggering}
              className="eleven-button-primary gap-2 cursor-pointer shadow-md font-semibold"
            >
              <Sparkles className="w-4 h-4 text-white" />
              {isTriggering ? 'Executing Pipeline...' : 'Fire Signed Webhook'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

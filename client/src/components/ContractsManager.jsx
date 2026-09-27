import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle2, Zap, ArrowUp, ArrowDown, Shield, Sparkles, AlertTriangle, Eye, Check, X } from 'lucide-react';

export default function ContractsManager({ contracts = [], agents = [], onSaveContract, onActivateContract, apiBase }) {
  // Currently selected agent
  const agentList = agents.length > 0
    ? agents.map(a => a.agent_id)
    : Array.from(new Set(contracts.map(c => c.agent_id).filter(Boolean)));
  
  if (!agentList.includes('eleven-support-agent-v1')) agentList.unshift('eleven-support-agent-v1');

  const [selectedAgent, setSelectedAgent] = useState(agentList[0] || 'eleven-support-agent-v1');

  // Filter contracts for this agent
  const agentContracts = contracts.filter(c => c.agent_id === selectedAgent);
  const activeContract = agentContracts.find(c => c.status === 'active' || c.is_active) || agentContracts[0] || {
    contract_id: 'default',
    agent_id: selectedAgent,
    version: 1,
    name: 'Default Agent Script Contract',
    status: 'active',
    is_active: true,
    required_disclosures: ['This call may be recorded for quality assurance and training purposes.'],
    banned_phrases: ['I guarantee', '100% free forever', 'unlimited lifetime warranty'],
    expected_flow: ['greeting_and_disclosure', 'problem_identification', 'resolution_offer', 'closing'],
    tone_target: 'professional, empathetic',
    custom_rules: [
      {
        id: 'rule_1',
        name: 'Refund Verification Policy',
        description: 'Agent must never promise a refund before verifying customer account',
        severity: 'high',
        evaluation: 'llm',
        enabled: true
      }
    ]
  };

  const [selectedVersion, setSelectedVersion] = useState(activeContract.version || 1);
  const currentContract = agentContracts.find(c => c.version === Number(selectedVersion)) || activeContract;

  // Form State
  const [name, setName] = useState(currentContract.name || '');
  const [toneTarget, setToneTarget] = useState(currentContract.tone_target || '');
  
  // Disclosures state
  const [disclosures, setDisclosures] = useState([]);
  const [newDisclosureText, setNewDisclosureText] = useState('');

  // Banned phrases state
  const [bannedPhrases, setBannedPhrases] = useState([]);
  const [newPhraseText, setNewPhraseText] = useState('');
  const [newPhraseType, setNewPhraseType] = useState('exact');

  // Expected flow state
  const [flowStages, setFlowStages] = useState([]);
  const [newStageName, setNewStageName] = useState('');

  // Custom rules state
  const [customRules, setCustomRules] = useState([]);
  const [ruleName, setRuleName] = useState('');
  const [ruleDesc, setRuleDesc] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState('high');
  const [ruleEval, setRuleEval] = useState('llm');

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Testing Sandbox State
  const [testTranscript, setTestTranscript] = useState(`Agent: Thank you for calling Priority Support. This call may be recorded for quality assurance. How can I help?
Customer: Hi, I'd like a refund on my last charge.
Agent: I can definitely help with that. Let me first verify your account email address.
Customer: It's user@example.com.
Agent: Thank you. Your account is verified and the refund has been processed. Have a great day!`);
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  // Sync form when currentContract changes
  useEffect(() => {
    if (currentContract) {
      setName(currentContract.name || '');
      setToneTarget(currentContract.tone_target || '');
      
      // Normalize disclosures
      const rawD = currentContract.required_disclosures || [];
      setDisclosures(rawD.map(d => typeof d === 'string' ? { id: Math.random().toString(), text: d, enabled: true } : d));

      // Normalize banned phrases
      const rawB = currentContract.banned_phrases || [];
      setBannedPhrases(rawB.map(p => typeof p === 'string' ? { id: Math.random().toString(), phrase: p, match_type: 'exact', enabled: true } : p));

      // Normalize flow
      const rawF = currentContract.expected_flow || [];
      setFlowStages(rawF.map(s => typeof s === 'string' ? s : (s.name || s.id)));

      // Custom rules
      setCustomRules(currentContract.custom_rules || []);
    }
  }, [currentContract?.contract_id, currentContract?.version, selectedAgent]);

  // Handlers for Disclosures
  const handleAddDisclosure = () => {
    if (!newDisclosureText.trim()) return;
    setDisclosures([...disclosures, { id: Date.now().toString(), text: newDisclosureText.trim(), enabled: true }]);
    setNewDisclosureText('');
  };

  const handleToggleDisclosure = (idx) => {
    const next = [...disclosures];
    next[idx].enabled = !next[idx].enabled;
    setDisclosures(next);
  };

  const handleRemoveDisclosure = (idx) => {
    setDisclosures(disclosures.filter((_, i) => i !== idx));
  };

  // Handlers for Banned Phrases
  const handleAddPhrase = () => {
    if (!newPhraseText.trim()) return;
    setBannedPhrases([...bannedPhrases, {
      id: Date.now().toString(),
      phrase: newPhraseText.trim(),
      match_type: newPhraseType,
      enabled: true
    }]);
    setNewPhraseText('');
  };

  const handleRemovePhrase = (idx) => {
    setBannedPhrases(bannedPhrases.filter((_, i) => i !== idx));
  };

  // Handlers for Flow
  const handleAddStage = () => {
    if (!newStageName.trim()) return;
    const stageId = newStageName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!flowStages.includes(stageId)) {
      setFlowStages([...flowStages, stageId]);
    }
    setNewStageName('');
  };

  const handleMoveStage = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= flowStages.length) return;
    const next = [...flowStages];
    const temp = next[idx];
    next[idx] = next[targetIdx];
    next[targetIdx] = temp;
    setFlowStages(next);
  };

  const handleRemoveStage = (idx) => {
    setFlowStages(flowStages.filter((_, i) => i !== idx));
  };

  // Handlers for Custom Rules
  const handleAddCustomRule = () => {
    if (!ruleName.trim() || !ruleDesc.trim()) return;
    setCustomRules([...customRules, {
      id: `rule_${Date.now()}`,
      name: ruleName.trim(),
      description: ruleDesc.trim(),
      severity: ruleSeverity,
      evaluation: ruleEval,
      enabled: true
    }]);
    setRuleName('');
    setRuleDesc('');
  };

  const handleRemoveCustomRule = (ruleId) => {
    setCustomRules(customRules.filter(r => r.id !== ruleId));
  };

  // Deploy New Version (Immutable Versioning!)
  const handleDeployNewVersion = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const payload = {
        agent_id: selectedAgent,
        name: name.trim() || `Script Contract v${(currentContract.version || 1) + 1}`,
        required_disclosures: disclosures.map(d => d.text),
        banned_phrases: bannedPhrases.map(p => ({ phrase: p.phrase, match_type: p.match_type, enabled: p.enabled })),
        expected_flow: flowStages,
        tone_target: toneTarget.trim() || 'professional, empathetic',
        custom_rules: customRules,
        status: 'active',
        activate: true
      };

      if (onSaveContract) {
        await onSaveContract(payload);
      } else {
        await fetch(`${apiBase}/api/agents/${selectedAgent}/contracts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      console.error('Failed to deploy version:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Test Rules Simulation Sandbox
  const handleRunTest = async () => {
    setIsTesting(true);
    try {
      // Parse transcript text into turns
      const lines = testTranscript.split('\n').filter(l => l.trim().length > 0);
      const turns = lines.map((line, idx) => {
        const isAgent = line.toLowerCase().startsWith('agent:');
        const text = line.replace(/^(agent|customer|user):\s*/i, '').trim();
        return {
          speaker: isAgent ? 'agent' : 'user',
          text,
          timestamp_offset: idx * 4.0
        };
      });

      const contractId = currentContract.contract_id || `${selectedAgent}:${currentContract.version}`;
      const res = await fetch(`${apiBase}/api/contracts/${contractId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: turns })
      });

      if (res.ok) {
        const data = await res.json();
        setTestResult(data);
      }
    } catch (err) {
      console.error('Test simulation failed:', err);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/[0.08]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#0B0C0E] tracking-tight">Script Contracts & Quality Guardrails</h1>
            <span className="eleven-pill bg-black text-white text-[10px] font-bold border border-black">
              IMMUTABLE VERSIONING
            </span>
          </div>
          <p className="text-xs text-[#45433E] mt-0.5 font-medium">
            Define company-specific call-quality rules, mandatory disclosures, banned claims, and expected conversational flows without writing code.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleDeployNewVersion}
            disabled={isSaving}
            className="eleven-button-primary gap-2 cursor-pointer shadow-xs font-semibold text-xs"
          >
            <Zap className="w-3.5 h-3.5 fill-white" />
            {isSaving ? 'Deploying...' : 'Deploy & Activate Version'}
          </button>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs flex items-center gap-2 font-medium shadow-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>New script contract version successfully created and activated! Worker pipelines immediately evaluate incoming calls against these rules.</span>
        </div>
      )}

      {/* Target Agent & Version Controls Bar */}
      <div className="eleven-card p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <label className="block text-[11px] font-bold text-[#3D3B36] uppercase font-mono mb-1">Target Agent</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="bg-white border border-black/[0.14] rounded-lg px-3 py-1.5 text-xs text-[#0B0C0E] font-mono font-bold focus:outline-none focus:border-black shadow-xs"
            >
              {agentList.map(ag => (
                <option key={ag} value={ag}>{ag}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[#3D3B36] uppercase font-mono mb-1">Version History</label>
            <div className="flex items-center gap-2">
              <select
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(Number(e.target.value))}
                className="bg-white border border-black/[0.14] rounded-lg px-3 py-1.5 text-xs text-[#0B0C0E] font-mono font-bold focus:outline-none focus:border-black shadow-xs"
              >
                {agentContracts.map(c => (
                  <option key={c.version} value={c.version}>
                    v{c.version} ({c.status?.toUpperCase() || (c.is_active ? 'ACTIVE' : 'ARCHIVED')})
                  </option>
                ))}
              </select>

              <span className={`eleven-pill text-[10px] font-bold ${
                currentContract.status === 'active' || currentContract.is_active
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                  : 'bg-black/[0.06] text-[#45433E]'
              }`}>
                {currentContract.status?.toUpperCase() || 'ACTIVE'}
              </span>
            </div>
          </div>
        </div>

        <div>
          <span className="text-[11px] font-mono text-[#5A5751]">
            Next deploy will create: <strong className="text-[#0B0C0E]">v{(currentContract.version || 1) + 1}</strong>
          </span>
        </div>
      </div>

      {/* Main Grid: Form Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (7 cols): Disclosures, Banned Phrases, Custom Rules */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Contract Overview & Tone Target */}
          <div className="eleven-card p-5 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono">
              Contract Metadata & Tone Guidelines
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#0B0C0E] mb-1">Contract Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-black/[0.12] rounded-xl px-3 py-2 text-xs text-[#0B0C0E] font-medium focus:border-black focus:outline-none shadow-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0B0C0E] mb-1">Target Tone Specification</label>
                <input
                  type="text"
                  value={toneTarget}
                  onChange={(e) => setToneTarget(e.target.value)}
                  placeholder="e.g. professional, empathetic, concise, and helpful"
                  className="w-full bg-white border border-black/[0.12] rounded-xl px-3 py-2 text-xs text-[#0B0C0E] font-medium focus:border-black focus:outline-none shadow-xs"
                />
                
                {/* Tone Presets */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    'professional, empathetic',
                    'direct, concise, technical',
                    'consultative, friendly sales',
                    'patient, gentle support'
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setToneTarget(preset)}
                      className="px-2 py-0.5 rounded-md bg-black/[0.04] hover:bg-black/[0.08] text-[10px] font-mono text-[#3D3B36] transition-colors cursor-pointer"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section 1: Required Disclosures */}
          <div className="eleven-card p-5 space-y-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono">
                Mandatory Disclosures & Legal Statements
              </h2>
              <p className="text-xs text-[#45433E] mt-0.5">
                Statements the agent MUST speak during the call (e.g. recording consent, AI transparency).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newDisclosureText}
                onChange={(e) => setNewDisclosureText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddDisclosure()}
                placeholder="Add disclosure (e.g. 'This call may be recorded')..."
                className="flex-1 bg-white border border-black/[0.12] rounded-xl px-3 py-2 text-xs text-[#0B0C0E] font-medium focus:border-black focus:outline-none shadow-xs"
              />
              <button
                type="button"
                onClick={handleAddDisclosure}
                className="eleven-button-secondary cursor-pointer gap-1 text-xs"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            <div className="space-y-2">
              {disclosures.length === 0 ? (
                <div className="text-xs text-[#5A5751] font-mono py-2">No mandatory disclosures added.</div>
              ) : (
                disclosures.map((disc, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-white border border-black/[0.08] flex items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="checkbox"
                        checked={disc.enabled !== false}
                        onChange={() => handleToggleDisclosure(idx)}
                        className="rounded cursor-pointer"
                      />
                      <span className={`text-xs font-medium ${disc.enabled !== false ? 'text-[#0B0C0E]' : 'line-through text-[#888]'}`}>
                        {disc.text}
                      </span>
                    </div>

                    <button
                      onClick={() => handleRemoveDisclosure(idx)}
                      className="text-[#5A5751] hover:text-rose-700 cursor-pointer p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 2: Banned Phrases */}
          <div className="eleven-card p-5 space-y-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono">
                Banned Phrases & Unauthorized Promises
              </h2>
              <p className="text-xs text-[#45433E] mt-0.5">
                Exact string or semantic phrases that trigger instant critical violations.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newPhraseText}
                onChange={(e) => setNewPhraseText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddPhrase()}
                placeholder="Add banned phrase (e.g. '100% free forever', 'I guarantee')..."
                className="flex-1 bg-white border border-black/[0.12] rounded-xl px-3 py-2 text-xs text-[#0B0C0E] font-medium focus:border-black focus:outline-none shadow-xs"
              />
              <select
                value={newPhraseType}
                onChange={(e) => setNewPhraseType(e.target.value)}
                className="bg-white border border-black/[0.12] rounded-xl px-2.5 py-2 text-xs text-[#0B0C0E] font-mono focus:border-black focus:outline-none shadow-xs"
              >
                <option value="exact">Exact Match</option>
                <option value="semantic">Semantic Match</option>
              </select>
              <button
                type="button"
                onClick={handleAddPhrase}
                className="eleven-button-secondary cursor-pointer gap-1 text-xs"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {bannedPhrases.length === 0 ? (
                <span className="text-xs text-[#5A5751] font-mono">No banned phrases configured.</span>
              ) : (
                bannedPhrases.map((phrase, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-300 text-rose-800 text-xs font-mono font-bold shadow-xs"
                  >
                    <span>"{phrase.phrase}"</span>
                    <span className="text-[9px] uppercase px-1 rounded bg-rose-200/50">{phrase.match_type || 'exact'}</span>
                    <button
                      onClick={() => handleRemovePhrase(idx)}
                      className="hover:text-rose-950 cursor-pointer ml-1 font-bold text-sm"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Section 3: Custom Company Compliance Rules */}
          <div className="eleven-card p-5 space-y-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono">
                Company-Specific Custom Quality Rules
              </h2>
              <p className="text-xs text-[#45433E] mt-0.5">
                Arbitrary semantic business policies evaluated by the calibrated LLM judge.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-white border border-black/[0.08] space-y-3 shadow-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#0B0C0E] mb-1">Rule Name</label>
                  <input
                    type="text"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder="e.g. Refund Policy Compliance"
                    className="w-full bg-[#FAF9F6] border border-black/[0.12] rounded-lg px-2.5 py-1.5 text-xs text-[#0B0C0E] focus:outline-none focus:border-black"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-[#0B0C0E] mb-1">Severity</label>
                    <select
                      value={ruleSeverity}
                      onChange={(e) => setRuleSeverity(e.target.value)}
                      className="w-full bg-[#FAF9F6] border border-black/[0.12] rounded-lg px-2 py-1.5 text-xs text-[#0B0C0E] focus:outline-none focus:border-black"
                    >
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="normal">Normal</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#0B0C0E] mb-1">Engine</label>
                    <select
                      value={ruleEval}
                      onChange={(e) => setRuleEval(e.target.value)}
                      className="w-full bg-[#FAF9F6] border border-black/[0.12] rounded-lg px-2 py-1.5 text-xs text-[#0B0C0E] focus:outline-none focus:border-black"
                    >
                      <option value="llm">LLM Judge</option>
                      <option value="deterministic">Rule Check</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#0B0C0E] mb-1">Rule Instruction / Constraint</label>
                <input
                  type="text"
                  value={ruleDesc}
                  onChange={(e) => setRuleDesc(e.target.value)}
                  placeholder="e.g. Agent must never promise a refund before eligibility is verified"
                  className="w-full bg-[#FAF9F6] border border-black/[0.12] rounded-lg px-2.5 py-1.5 text-xs text-[#0B0C0E] focus:outline-none focus:border-black"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddCustomRule}
                  className="eleven-button-primary px-3 py-1.5 text-xs cursor-pointer gap-1"
                >
                  <Plus className="w-3 h-3 fill-white" /> Add Custom Rule
                </button>
              </div>
            </div>

            {/* List of Custom Rules */}
            <div className="space-y-2">
              {customRules.length === 0 ? (
                <div className="text-xs text-[#5A5751] font-mono py-2">No custom company rules created yet.</div>
              ) : (
                customRules.map((rule, idx) => (
                  <div key={rule.id || idx} className="p-3 rounded-xl bg-white border border-black/[0.08] flex items-start justify-between gap-3 shadow-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#0B0C0E]">{rule.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
                          rule.severity === 'critical' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {rule.severity}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-black/[0.06] text-[#45433E]">
                          {rule.evaluation?.toUpperCase() || 'LLM'}
                        </span>
                      </div>
                      <p className="text-xs text-[#45433E] mt-1 font-medium leading-relaxed">
                        {rule.description}
                      </p>
                    </div>

                    <button
                      onClick={() => handleRemoveCustomRule(rule.id)}
                      className="text-[#5A5751] hover:text-rose-700 cursor-pointer p-1 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Right Column (5 cols): Expected Flow & Rule Testing Sandbox */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Section 4: Expected Protocol Flow */}
          <div className="eleven-card p-5 space-y-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono">
                Expected Conversation Protocol Flow
              </h2>
              <p className="text-xs text-[#45433E] mt-0.5">
                Ordered stages the agent must navigate during the call.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddStage()}
                placeholder="Add stage (e.g. 'identity_verification')..."
                className="flex-1 bg-white border border-black/[0.12] rounded-xl px-3 py-1.5 text-xs text-[#0B0C0E] font-medium focus:border-black focus:outline-none shadow-xs"
              />
              <button
                type="button"
                onClick={handleAddStage}
                className="eleven-button-secondary px-2.5 py-1.5 text-xs cursor-pointer"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-2 font-mono text-xs">
              {flowStages.map((stage, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-black/[0.08] shadow-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-black text-white flex items-center justify-center text-[10px] font-bold">
                      {idx + 1}
                    </span>
                    <span className="text-[#0B0C0E] font-bold">{stage}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      disabled={idx === 0}
                      onClick={() => handleMoveStage(idx, -1)}
                      className="p-1 text-[#5A5751] hover:text-black disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      disabled={idx === flowStages.length - 1}
                      onClick={() => handleMoveStage(idx, 1)}
                      className="p-1 text-[#5A5751] hover:text-black disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleRemoveStage(idx)}
                      className="p-1 text-[#5A5751] hover:text-rose-700 cursor-pointer ml-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 5: Rule Testing Sandbox */}
          <div className="eleven-card p-5 space-y-4 border border-black/[0.14] bg-white">
            <div className="flex items-center justify-between pb-2 border-b border-black/[0.08]">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#0B0C0E] font-mono flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Test Rules Sandbox
                </h2>
                <p className="text-[11px] text-[#5A5751]">Simulate your active contract rules against a test transcript</p>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[#3D3B36] mb-1 font-mono">Sample Transcript</label>
              <textarea
                rows={5}
                value={testTranscript}
                onChange={(e) => setTestTranscript(e.target.value)}
                className="w-full bg-[#FAF9F6] border border-black/[0.12] rounded-xl p-2.5 font-mono text-[11px] text-[#0B0C0E] focus:outline-none focus:border-black leading-relaxed"
              />
            </div>

            <button
              type="button"
              onClick={handleRunTest}
              disabled={isTesting}
              className="w-full py-2 rounded-xl bg-black text-white hover:bg-neutral-800 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              <Zap className="w-3.5 h-3.5 fill-white" />
              {isTesting ? 'Running Simulation...' : 'Run Rules Simulation'}
            </button>

            {testResult && (
              <div className="p-3.5 rounded-xl bg-[#FAF9F6] border border-black/[0.1] space-y-3 font-mono text-xs shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#0B0C0E]">Simulated Drift Score:</span>
                  <span className={`text-sm font-bold ${testResult.drift_score > 0.6 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {testResult.drift_score}
                  </span>
                </div>

                {/* Flow Checklist */}
                <div>
                  <span className="text-[10px] text-[#5A5751] uppercase font-bold block mb-1">Flow Stages:</span>
                  <div className="space-y-1">
                    {Object.entries(testResult.flow_checklist || {}).map(([stage, res]) => (
                      <div key={stage} className="flex items-center justify-between text-[11px]">
                        <span>{stage}</span>
                        {res.hit ? (
                          <span className="text-emerald-700 font-bold flex items-center gap-0.5">✓ Passed</span>
                        ) : (
                          <span className="text-rose-700 font-bold flex items-center gap-0.5">✗ Missed</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Custom Rules Result */}
                {(testResult.custom_rule_results || []).length > 0 && (
                  <div className="pt-2 border-t border-black/[0.08]">
                    <span className="text-[10px] text-[#5A5751] uppercase font-bold block mb-1">Custom Rules:</span>
                    <div className="space-y-1 text-[11px]">
                      {testResult.custom_rule_results.map((r, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span>{r.name}</span>
                          <span className={`font-bold ${r.passed ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {r.passed ? '✓ Compliant' : '✗ Breached'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}

import React, { useState } from 'react';
import { Building2, Key, Shield, Copy, Check, Plus, ExternalLink, RefreshCw } from 'lucide-react';

export default function OrgSettings({ tenant, organizations = [], onSwitchOrg, onRefresh, apiBase }) {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const webhookUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000'}/webhooks/elevenlabs/call-complete`;

  const copyToClipboard = (text, setCopied) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreateOrg = async (e) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newOrgName.trim(),
          slug: newOrgSlug.trim() || undefined
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create organization');
      }

      const created = await res.json();
      setNewOrgName('');
      setNewOrgSlug('');
      setIsCreateOpen(false);
      
      if (onSwitchOrg) onSwitchOrg(created.organization.org_id);
      if (onRefresh) onRefresh();
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
            <h1 className="text-xl font-semibold text-[#1D1D1F] tracking-tight">Organization & Security Settings</h1>
            <span className="apple-pill bg-[#34C759]/10 text-[#248A3D] text-[10px] font-medium">
              MULTI-TENANT ENFORCED
            </span>
          </div>
          <p className="text-xs text-[#86868B] mt-1 font-normal">
            Manage your company workspace, tenant API keys, and ElevenLabs webhook integration secrets.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateOpen(true)}
            className="apple-button-primary gap-2 cursor-pointer shadow-xs font-medium text-xs"
          >
            <Plus className="w-3.5 h-3.5 fill-white" />
            Create New Organization
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column (2 cols): Current Tenant Settings & Credentials */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Organization Profile Card */}
          <div className="eleven-card p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-[10px] bg-[#1D1D1F] text-white flex items-center justify-center shadow-xs">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[#1D1D1F]">{tenant?.name || 'Company Workspace'}</h2>
                  <span className="text-[11px] font-mono text-[#86868B]">{tenant?.slug || 'workspace-slug'}</span>
                </div>
              </div>

              <span className="apple-pill bg-black/[0.05] text-[#1D1D1F] text-[10px] font-mono font-medium uppercase">
                {tenant?.plan_tier || 'ENTERPRISE'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
              <div className="p-3.5 rounded-2xl bg-[#F5F5F7] border border-black/[0.04]">
                <span className="text-[#86868B] block text-[10px] uppercase font-medium">Daily Token Budget</span>
                <span className="text-base font-semibold text-[#1D1D1F]">
                  {(tenant?.token_used_today || 0).toLocaleString()} / {(tenant?.token_budget_daily || 1000000).toLocaleString()}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#F5F5F7] border border-black/[0.04]">
                <span className="text-[#86868B] block text-[10px] uppercase font-medium">Tenant Isolation</span>
                <span className="text-base font-semibold text-[#248A3D]">
                  PostgreSQL RLS Active
                </span>
              </div>
            </div>
          </div>

          {/* Webhook & API Credentials */}
          <div className="eleven-card p-5 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono">
              API & Webhook Ingestion Credentials
            </h2>

            <div className="space-y-3">
              {/* Ingest URL */}
              <div>
                <label className="block text-xs font-bold text-[#0B0C0E] mb-1">ElevenLabs Webhook Ingest URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhookUrl}
                    className="flex-1 bg-[#FAF9F6] border border-black/[0.12] rounded-xl px-3 py-2 text-xs font-mono text-[#0B0C0E] focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(webhookUrl, setCopiedUrl)}
                    className="eleven-button-secondary cursor-pointer gap-1 text-xs shrink-0"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedUrl ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-bold text-[#0B0C0E] mb-1">Organization API Key</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={tenant?.api_key || 'ek_live_eleven_ops_982348a7b9'}
                    className="flex-1 bg-[#FAF9F6] border border-black/[0.12] rounded-xl px-3 py-2 text-xs font-mono text-[#0B0C0E] focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(tenant?.api_key || 'ek_live_eleven_ops_982348a7b9', setCopiedKey)}
                    className="eleven-button-secondary cursor-pointer gap-1 text-xs shrink-0"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* Webhook Secret */}
              <div>
                <label className="block text-xs font-bold text-[#0B0C0E] mb-1">HMAC Webhook Signing Secret</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={tenant?.webhook_secret || 'whsec_elevenlabs_production_super_secret_key_2026'}
                    className="flex-1 bg-[#FAF9F6] border border-black/[0.12] rounded-xl px-3 py-2 text-xs font-mono text-[#0B0C0E] focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(tenant?.webhook_secret || 'whsec_elevenlabs_production_super_secret_key_2026', setCopiedSecret)}
                    className="eleven-button-secondary cursor-pointer gap-1 text-xs shrink-0"
                  >
                    {copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedSecret ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column (1 col): Multi-Tenant Switcher */}
        <div className="space-y-4">
          <div className="eleven-card p-5 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#3D3B36] font-mono">
              Switch Organization
            </h2>
            <p className="text-xs text-[#45433E]">
              Test strict tenant isolation. Each organization has its own isolated agents, contracts, calls, and alerts.
            </p>

            <div className="space-y-2 pt-2">
              {organizations.map((org) => {
                const isCurrent = org.org_id === tenant?.org_id;
                return (
                  <div
                    key={org.org_id}
                    onClick={() => onSwitchOrg && onSwitchOrg(org.org_id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                      isCurrent
                        ? 'border-black bg-black/[0.04] ring-1 ring-black shadow-xs'
                        : 'border-black/[0.08] bg-white hover:border-black/[0.18]'
                    }`}
                  >
                    <div>
                      <span className="text-xs font-bold text-[#0B0C0E] block">{org.name}</span>
                      <span className="text-[10px] font-mono text-[#5A5751]">{org.slug}</span>
                    </div>

                    {isCurrent && (
                      <span className="w-2 h-2 rounded-full bg-emerald-600 shadow-[0_0_6px_#10B981]"></span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>

      {/* Create Organization Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-[#FAF9F6] border border-black/[0.12] rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.08]">
              <div>
                <h2 className="text-base font-bold text-[#0B0C0E]">Create Organization</h2>
                <p className="text-xs text-[#5A5751]">Creates a dedicated multi-tenant workspace with isolated API keys</p>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="w-7 h-7 rounded-full bg-black/[0.06] hover:bg-black/[0.1] text-xs font-bold text-[#0B0C0E] flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateOrg} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-[#0B0C0E] font-semibold mb-1">Company / Organization Name</label>
                <input
                  type="text"
                  required
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="e.g. Acme Corp Voice"
                  className="w-full bg-white border border-black/[0.12] rounded-xl px-3 py-2 text-xs text-[#0B0C0E] focus:border-black focus:outline-none shadow-xs"
                />
              </div>

              <div>
                <label className="block text-[#0B0C0E] font-semibold mb-1">Slug (Optional)</label>
                <input
                  type="text"
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value)}
                  placeholder="e.g. acme-corp"
                  className="w-full bg-white border border-black/[0.12] rounded-xl px-3 py-2 text-xs font-mono text-[#0B0C0E] focus:border-black focus:outline-none shadow-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-xl bg-white border border-black/[0.12] text-xs font-semibold text-[#0B0C0E] hover:bg-black/[0.04] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="eleven-button-primary px-4 py-2 text-xs font-semibold cursor-pointer shadow-xs"
                >
                  {isSubmitting ? 'Creating...' : 'Create Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

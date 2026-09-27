import React from 'react';
import { Activity, ShieldAlert, FileText, Cpu, Radio, Sparkles, Bot, Settings, Building2 } from 'lucide-react';

export default function Navbar({
  activeTab,
  setActiveTab,
  tenant,
  organizations = [],
  onSwitchOrg,
  isConnected,
  onOpenSimulator
}) {
  const navItems = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'agents', label: 'Agents', icon: Bot },
    { id: 'contracts', label: 'Quality Rules', icon: FileText },
    { id: 'calls', label: 'Call Explorer', icon: Radio },
    { id: 'alerts', label: 'Alerts', icon: ShieldAlert },
    { id: 'observability', label: 'Observability', icon: Cpu },
    { id: 'settings', label: 'Org Settings', icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-white/80 backdrop-blur-2xl transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand / Logo - Apple Minimalist Aesthetic */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-[#1D1D1F] text-white flex items-center justify-center shadow-xs">
            {/* Apple-style Voice Waveform */}
            <div className="flex items-center gap-0.5 h-4">
              <span className="w-0.5 h-2.5 bg-white rounded-full"></span>
              <span className="w-0.5 h-4 bg-white rounded-full"></span>
              <span className="w-0.5 h-2 bg-white rounded-full"></span>
              <span className="w-0.5 h-3.5 bg-white rounded-full"></span>
              <span className="w-0.5 h-1.5 bg-white rounded-full"></span>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold tracking-tight text-[#1D1D1F]">EchoTrace</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-black/[0.05] text-[#1D1D1F] border border-black/[0.06] font-semibold">
                Pro
              </span>
            </div>
            <p className="text-[11px] text-[#86868B] font-medium tracking-tight">Voice QA & Observability</p>
          </div>
        </div>

        {/* Center Navigation Tabs (Apple Segmented Control) */}
        <nav className="hidden xl:flex items-center bg-[#E8E8ED] p-1 rounded-full border border-black/[0.04]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-white text-[#1D1D1F] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0.5px_1px_rgba(0,0,0,0.04)] font-semibold'
                    : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right Actions & Status (Apple Capsule Controls) */}
        <div className="flex items-center gap-2.5">
          {/* Org Selector Dropdown */}
          {organizations.length > 1 && (
            <div className="hidden sm:flex items-center gap-1.5 bg-white/90 border border-black/[0.08] rounded-full px-3 py-1 text-xs shadow-xs">
              <Building2 className="w-3.5 h-3.5 text-[#86868B]" />
              <select
                value={tenant?.org_id}
                onChange={(e) => onSwitchOrg && onSwitchOrg(e.target.value)}
                className="bg-transparent text-xs font-medium text-[#1D1D1F] focus:outline-none cursor-pointer"
              >
                {organizations.map(org => (
                  <option key={org.org_id} value={org.org_id}>{org.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Simulator Trigger - Apple Capsule */}
          <button
            onClick={onOpenSimulator}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium bg-[#1D1D1F] hover:bg-black text-white transition-all cursor-pointer shadow-xs active:scale-[0.98]"
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
            <span className="hidden sm:inline">Simulate Call</span>
          </button>

          {/* Connection Status */}
          <div className="flex items-center gap-2 pl-2 border-l border-black/[0.08]">
            <div className="flex items-center gap-1.5 text-xs text-[#86868B]">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#34C759] shadow-[0_0_8px_rgba(52,199,89,0.5)]' : 'bg-[#FF9500]'}`}></span>
              <span className="hidden lg:inline font-mono text-[11px] font-medium text-[#6E6E73]">
                {isConnected ? 'LIVE' : 'POLLING'}
              </span>
            </div>
            <div className="px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase bg-black/[0.04] border border-black/[0.06] text-[#1D1D1F] font-medium">
              {tenant?.plan_tier || 'ENTERPRISE'}
            </div>
          </div>

        </div>

      </div>

      {/* Sub-Navigation Strip (Mobile/Tablets Apple Scroll) */}
      <div className="xl:hidden border-t border-black/[0.04] bg-white/90 backdrop-blur-xl px-3 py-2 overflow-x-auto flex items-center gap-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-[#1D1D1F] text-white shadow-xs'
                  : 'bg-black/[0.03] text-[#6E6E73] hover:text-[#1D1D1F]'
              }`}
            >
              <Icon className="w-3 h-3" />
              {item.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}

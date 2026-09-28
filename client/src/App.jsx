import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import BentoOverview from './components/BentoOverview';
import AgentsManager from './components/AgentsManager';
import CallsList from './components/CallsList';
import CallTimeline from './components/CallTimeline';
import ContractsManager from './components/ContractsManager';
import AlertsCenter from './components/AlertsCenter';
import ObservabilityHealth from './components/ObservabilityHealth';
import OrgSettings from './components/OrgSettings';
import WebhookSimulator from './components/WebhookSimulator';
import MeshDriftBackground from './components/MeshDriftBackground';
import FloatingDock from './components/FloatingDock';

const API_BASE = typeof window !== 'undefined' && window.location.port === '5173'
  ? 'http://localhost:4000'
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [currentOrgId, setCurrentOrgId] = useState('00000000-0000-0000-0000-000000000001');
  const [organizations, setOrganizations] = useState([]);
  const [overviewData, setOverviewData] = useState(null);
  const [agents, setAgents] = useState([]);
  const [calls, setCalls] = useState([]);
  const [selectedCallId, setSelectedCallId] = useState(null);
  const [selectedCallData, setSelectedCallData] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [healthData, setHealthData] = useState(null);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Common fetch options with multi-tenant header
  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'x-org-id': currentOrgId
  });

  // Data Fetch for current organization
  const refreshData = async () => {
    try {
      const headers = getHeaders();

      const [overviewRes, agentsRes, callsRes, contractsRes, alertsRes, healthRes, orgsRes] = await Promise.all([
        fetch(`${API_BASE}/api/overview`, { headers }),
        fetch(`${API_BASE}/api/agents`, { headers }),
        fetch(`${API_BASE}/api/calls`, { headers }),
        fetch(`${API_BASE}/api/contracts`, { headers }),
        fetch(`${API_BASE}/api/alerts`, { headers }),
        fetch(`${API_BASE}/api/observability`, { headers }),
        fetch(`${API_BASE}/api/organizations`)
      ]);

      if (overviewRes.ok) setOverviewData(await overviewRes.json());
      if (agentsRes.ok) {
        const a = await agentsRes.json();
        setAgents(a.agents || []);
      }
      if (callsRes.ok) {
        const c = await callsRes.json();
        setCalls(c.calls || []);
      }
      if (contractsRes.ok) {
        const co = await contractsRes.json();
        setContracts(co.contracts || []);
      }
      if (alertsRes.ok) {
        const al = await alertsRes.json();
        setAlerts(al.alerts || []);
      }
      if (healthRes.ok) setHealthData(await healthRes.json());
      if (orgsRes.ok) {
        const o = await orgsRes.json();
        setOrganizations(o.organizations || []);
      }
    } catch (err) {
      console.warn('Backend sync error:', err.message);
    }
  };

  useEffect(() => {
    refreshData();

    // Setup real-time Server-Sent Events (SSE)
    let eventSource;
    try {
      eventSource = new EventSource(`${API_BASE}/api/events`);
      eventSource.onopen = () => setIsConnected(true);
      eventSource.onerror = () => setIsConnected(false);

      eventSource.addEventListener('data_updated', () => {
        refreshData();
      });

      eventSource.addEventListener('contract_updated', () => {
        refreshData();
      });

      eventSource.addEventListener('stream_entry', () => {
        refreshData();
      });
    } catch {
      setIsConnected(false);
    }

    const pollInterval = setInterval(refreshData, 10000);
    return () => {
      clearInterval(pollInterval);
      if (eventSource) eventSource.close();
    };
  }, [currentOrgId]);

  // Fetch Per-Call details when selected
  useEffect(() => {
    if (selectedCallId) {
      fetch(`${API_BASE}/api/calls/${selectedCallId}`, { headers: getHeaders() })
        .then(res => res.json())
        .then(data => setSelectedCallData(data))
        .catch(err => console.error(err));
    } else {
      setSelectedCallData(null);
    }
  }, [selectedCallId, currentOrgId]);

  const handleSelectCall = (callId) => {
    setSelectedCallId(callId);
    const existing = calls.find(c => c.call_id === callId);
    if (existing) {
      setSelectedCallData({ call: existing, score: existing.score });
    }
    setActiveTab('calls');
  };

  const handleSwitchOrg = (orgId) => {
    setCurrentOrgId(orgId);
    setSelectedCallId(null);
    setSelectedCallData(null);
  };

  const handleSaveContract = async (contractPayload) => {
    const res = await fetch(`${API_BASE}/api/contracts`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(contractPayload)
    });
    if (res.ok) {
      refreshData();
    }
  };

  const handleAcknowledgeAlert = async (alertId) => {
    const res = await fetch(`${API_BASE}/api/alerts/${alertId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ status: 'resolved', acknowledged_by: 'Ops Team Lead' })
    });
    if (res.ok) {
      refreshData();
    }
  };

  return (
    <div className="min-h-screen text-[#0E0F11] flex flex-col font-sans relative">
      {/* WebGL Mesh Drift Shader Background */}
      <MeshDriftBackground />

      {/* Tactile Texture Noise Overlay */}
      <div className="noise-texture-overlay" />
      
      {/* Top ElevenLabs Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'calls') setSelectedCallId(null);
        }}
        tenant={overviewData?.tenant}
        organizations={organizations}
        onSwitchOrg={handleSwitchOrg}
        isConnected={isConnected}
        onOpenSimulator={() => setIsSimulatorOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 dock-spacing">
        
        {/* Tab 1: Overview */}
        {activeTab === 'overview' && (
          <BentoOverview
            overviewData={overviewData}
            onSelectCall={handleSelectCall}
            onOpenSimulator={() => setIsSimulatorOpen(true)}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}

        {/* Tab 2: Voice Agents Registry */}
        {activeTab === 'agents' && (
          <AgentsManager
            agents={agents}
            onSelectAgent={(agId) => {
              setActiveTab('contracts');
            }}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onRefreshAgents={refreshData}
            apiBase={API_BASE}
          />
        )}

        {/* Tab 3: Script Contracts & Quality Rules */}
        {activeTab === 'contracts' && (
          <ContractsManager
            contracts={contracts}
            agents={agents}
            onSaveContract={handleSaveContract}
            apiBase={API_BASE}
          />
        )}

        {/* Tab 4: Call Explorer & Audio Timeline */}
        {activeTab === 'calls' && (
          selectedCallId ? (
            <CallTimeline
              callData={selectedCallData || (calls.find(c => c.call_id === selectedCallId) ? { call: calls.find(c => c.call_id === selectedCallId), score: calls.find(c => c.call_id === selectedCallId)?.score } : null)}
              onBack={() => {
                setSelectedCallId(null);
                setSelectedCallData(null);
              }}
            />
          ) : (
            <CallsList
              calls={calls}
              onSelectCall={handleSelectCall}
              onRefresh={refreshData}
            />
          )
        )}

        {/* Tab 5: Alerts Center */}
        {activeTab === 'alerts' && (
          <AlertsCenter
            alerts={alerts}
            onSelectCall={handleSelectCall}
            onAcknowledgeAlert={handleAcknowledgeAlert}
          />
        )}

        {/* Tab 6: System Observability */}
        {activeTab === 'observability' && (
          <ObservabilityHealth
            healthData={healthData}
          />
        )}

        {/* Tab 7: Organization & Security Settings */}
        {activeTab === 'settings' && (
          <OrgSettings
            tenant={overviewData?.tenant}
            organizations={organizations}
            onSwitchOrg={handleSwitchOrg}
            onRefresh={refreshData}
            apiBase={API_BASE}
          />
        )}

      </main>

      {/* Interactive Webhook Simulator Modal */}
      <WebhookSimulator
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
        apiBase={API_BASE}
        onCallGenerated={(newCallId) => {
          refreshData();
          setSelectedCallId(newCallId);
          setActiveTab('calls');
        }}
      />

      {/* Footer */}
      <footer className="border-t border-black/[0.07] py-6 text-center text-xs text-[#73716D] font-mono bg-white/50 backdrop-blur-xs" style={{ marginBottom: '80px' }}>
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="text-[#0E0F11] font-medium">EchoTrace v1 GA • Observability & QA for ElevenLabs Voice Agents</span>
          <span className="text-[#73716D]">Durable Ingestion • Redis Streams • RLS Enforced</span>
        </div>
      </footer>

      {/* Floating Dock Navigation */}
      <FloatingDock
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'calls') setSelectedCallId(null);
        }}
      />

    </div>
  );
}

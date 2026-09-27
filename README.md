# EchoTrace 🎙️⚡
### Enterprise Observability & Automated QA Control Plane for ElevenLabs Voice Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev/)
[![Redis Streams](https://img.shields.io/badge/Redis-Streams-red.svg)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-RLS%20Enforced-336791.svg)](https://www.postgresql.org/)

**EchoTrace** is an enterprise-grade observability, real-time telemetry, and automated quality assurance control plane engineered for organizations deploying autonomous voice agents with **ElevenLabs Conversational AI**.

When voice agents interact with customers in real-time, compliance violations, unauthorized financial commitments, and conversational script drift represent massive regulatory and reputation risks. EchoTrace provides a durable, multi-tenant streaming pipeline that ingests call telemetry at sub-10ms latency, executes zero-cost deterministic rule checks, orchestrates calibrated LLM-as-a-judge evaluations, and delivers real-time visibility through a high-end observability interface.

---

## 📸 System Walkthrough & Screenshots

### 1. Executive Observability Dashboard
Unified control plane tracking total ingested calls, script drift score, compliance pass rate, and escalation percentages with dynamic 7-day volume trends and real-time active stream health.

![Overview Dashboard](docs/images/01-overview-dashboard.png)

---

### 2. Feature Suite & Recent Ingested Calls
Live session audit log showcasing turn durations, drift metrics, compliance flags, escalation triggers, and one-click inspection buttons.

![Recent Ingested Calls](docs/images/02-recent-calls-inspections.png)

---

### 3. Voice Agent Registry
Centralized catalog of registered ElevenLabs conversational agents with active contract bindings, deployment status, and per-agent analytics.

![Voice Agent Registry](docs/images/03-agent-registry.png)

---

### 4. Script Contracts & Quality Guardrails
Immutable, version-controlled contract editor defining company-specific mandatory disclosures, banned claims, tone guidelines, and expected multi-stage conversational flows without writing code.

![Script Contracts & Quality Guardrails](docs/images/04-quality-contracts.png)

---

### 5. Call Explorer & Audio Telemetry
Deep forensic call inspection featuring multi-turn conversation logs, drift trajectory, audio player integration, and automated escalation indicators.

![Call Explorer & Audio Telemetry](docs/images/05-call-explorer.png)

---

## 📐 Architecture Overview

EchoTrace uses an asynchronous, decoupled worker architecture built on top of **Redis Streams** to guarantee durability and eliminate bottlenecks during peak call volumes:

```
              ElevenLabs Webhook Telemetry
                           │
                           ▼
               ┌────────────────────────┐
               │  POST /api/webhooks    │  < 10ms p99 response
               │  - HMAC-SHA256 Auth    │
               │  - Redis SET NX Dedup  │
               └───────────┬────────────┘
                           │ (Stream: ingest-raw)
                           ▼
               ┌────────────────────────┐
               │ Normalization Workers  │  Raw payload ➔ Canonical CallRecord
               └───────────┬────────────┘
                           │ (PostgreSQL RLS Storage)
                           ▼
               ┌────────────────────────┐
               │   Rule-Check Engine    │  Zero-token deterministic regex checks:
               │   (Fast Gate)          │  - Banned claims & guarantees
               └───────────┬────────────┘  - Mandatory legal disclosures
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
      [Clean / Resolved]       [Complex Drift / Needs Audit]
             │                           │ (Stream: llm-judge-queue)
             │                           ▼
             │                 ┌───────────────────────┐
             │                 │   LLM-as-a-Judge      │  Calibrated scoring:
             │                 │   - Zod Schema Valid. │  - Script drift & adherence
             │                 │   - SHA-256 Cache     │  - Sentiment shift
             │                 │   - Budget Guardrails │  - Commitment detection
             │                 └───────────┬───────────┘
             │                             │
             └─────────────┬───────────────┘
                           ▼
               ┌────────────────────────┐
               │  Alerts & SSE Engine   │  - Atomic 1h deduplication window
               │  - Slack Dispatch      │  - Server-Sent Events (SSE)
               │  - Webhook Dispatch    │  - Observability Dashboard
               └────────────────────────┘
```

---

## ✨ Key Technical Highlights

### ⚡ Durable, Low-Latency Ingestion
- **Strict HMAC-SHA256 Verification**: Validates raw webhook signatures against per-tenant webhook secrets.
- **Idempotency Protection**: Redis `SET NX` with 24-hour TTL prevents duplicate processing from network retries.
- **Sub-10ms Ingestion Latency**: Immediately acknowledges ElevenLabs webhooks while delegating normalization to background workers.

### 🛡️ Two-Tier Evaluation Pipeline
1. **Zero-Cost Deterministic Gate**: Instant regex scanning for required disclosures, prohibited phrases, and outlier call durations before spending tokens.
2. **Cost-Governed LLM-as-a-Judge**: Evaluates nuanced conversation flow, empathy, and subtle commitments with:
   - **Strict Zod Schema Enforcement**: Ensures consistent JSON evaluation structure.
   - **SHA-256 Transcript Caching**: Eliminates redundant LLM calls on repeated caller inquiries.
   - **Per-Tenant Token Budgets**: Prevents unexpected billing surges with automated circuit-breaking.

### 🏢 Enterprise Multi-Tenancy (Row-Level Security)
- Every table (`calls`, `script_contracts`, `call_scores`, `alerts`, `processing_audit`) enforces PostgreSQL Row-Level Security (RLS).
- Context is strictly isolated using `SET LOCAL app.current_tenant_id` per database transaction.

### 🎨 Apple & 21st.dev-Inspired UI
- **Animated WebGL Mesh Drift Shader**: High-performance fragment shader background (`#03120E`, `#0E7C5A`, `#7CE577`, `#F4FFC7`) with zero external dependencies and tab-visibility pause.
- **macOS Floating Dock Navigation**: Glassmorphic bottom navigation pill with spring physics micro-interactions and active state indicators.
- **Real-Time Data Streaming**: Server-Sent Events (SSE) power live dashboard metrics, call feed updates, and health monitors.

---

## 🛠️ Tech Stack

| Domain | Technologies |
|---|---|
| **Backend & Ingestion** | Node.js (v18+), Express, Redis Streams (`ioredis`), PostgreSQL |
| **Data & Security** | PostgreSQL Row-Level Security (RLS), HMAC SHA-256, Zod, UUIDv4 |
| **QA & LLM Pipeline** | OpenAI / Anthropic APIs, SHA-256 Cache, Circuit Breaker Pattern |
| **Frontend UI** | React 19, Vite, Framer Motion, Vanilla CSS Design System |
| **Visual Craft** | WebGL1 Fragment Shader, Lucide React, Glassmorphism |
| **DevOps & Testing** | Docker, Docker Compose, Vitest, Jest |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Docker & Docker Compose (for PostgreSQL and Redis)

### 1. Clone the Repository
```bash
git clone https://github.com/SUBHA22-CODER/ECOTrace.git
cd ECOTrace
```

### 2. Environment Setup
Create a `.env` file in the root directory:
```env
PORT=4000
DATABASE_URL=postgres://echotrace:echotrace_secret@localhost:5432/echotrace_db
REDIS_URL=redis://localhost:6379
WEBHOOK_SECRET=your_hmac_secret_here
LLM_API_KEY=your_openai_or_anthropic_key_here
```

### 3. Spin up Infrastructure
```bash
docker-compose up -d
```

### 4. Install Dependencies & Build Frontend
```bash
# Install backend dependencies
npm install

# Build client application
cd client
npm install
npm run build
cd ..
```

### 5. Start Server
```bash
node server.js
```
The application will be live at `http://localhost:4000`.

---

## 🧪 Running Automated Tests

Run the comprehensive test suite verifying ingestion idempotency, contract versioning, RLS isolation, and judge pipelines:

```bash
npm test
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

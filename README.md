# 🏛️ BOK Housing Policy Scenario Platform

> *Enterprise GenAI platform for the Bank of Korea Financial Stability Department (한국은행 금융안정국) — enabling analysts to simulate housing-finance policy scenarios, generate LLM-powered policy briefs, and explore tradeoffs through an AI advisor agent.*

📺 **[Demo Video](YOUR_YOUTUBE_LINK_HERE)** | 🔗 **Live App** (requires Foundry auth)

---

## Architecture

```
Korean Housing & Macro Data (8 CSV datasets)
    │
    ▼
Polars ETL Transforms (~6× faster than PySpark)
    │
    ▼
Ontology Layer (7 object types, 4 link types, 10 action types)
    │
    ├──▶ ML Ensemble (3 deployed models)
    │       • Price Growth Predictor (ExtraTrees, RMSE 0.53%)
    │       • Transaction Volume Predictor (RandomForest, MAE 13.4)
    │       • Housing Stress Classifier (XGBoost, 84.1% accuracy)
    │
    ├──▶ Simulation Engine
    │       • 40-quarter stock-flow model
    │       • 25 Seoul districts × 10-year horizon
    │       • ML-calibrated coefficients
    │
    ├──▶ Policy Parameter Solver
    │       • 2-phase random search (500 global + 500 local refinement)
    │       • Constraint-based optimization (PIR, debt/GDP, growth targets)
    │
    ├──▶ LLM Orchestration (OpenAI GPT-4o)
    │       • Policy brief generation with structured output
    │       • AI policy advisor with ontology-grounded context
    │       • Token-aware context construction (400K → 2K tokens)
    │
    └──▶ Applications
            • React OSDK App (scenario builder, projections, AI advisor)
            • Workshop Dashboard (market overview, policy briefs)
            • AIP Agent (streaming chat with tool calling)
```

---

## Key Features

### 1. Policy Scenario Simulation

- Create scenarios with **18 policy levers** across 4 categories: tax (양도세, 종부세, 취득세), supply, credit (LTV/DTI caps), and monetary policy
- Run **40-quarter projections** across all 25 Seoul districts with per-district metrics: price index, growth rate, transaction count, PIR, and housing stress classification
- 3 ML models calibrate simulation coefficients from real Korean housing market data (1,075 district-quarter observations)

### 2. LLM-Powered Policy Briefs (OpenAI GPT-4o)

- Generates **structured policy briefs** from projection data: Executive Summary → Scenario Parameters → Projection Highlights → Financial Stability Assessment → Policy Recommendations → Methodology Note
- **Multi-scenario comparison**: compare up to N projection runs side-by-side in a single brief with cross-scenario analysis
- **Token-aware context construction**: sends city-wide aggregates (~2K tokens) rather than raw district data (~400K tokens) while preserving analytical signal
- Full error handling with graceful degradation — LLM failures produce error-labeled brief objects rather than breaking the pipeline

### 3. AI Policy Advisor Agent

- Natural language interface for BOK analysts to ask about policy tradeoffs, scenario outcomes, and recommendations
- Automatically retrieves **ontology context**: recent scenarios (up to 10), projection results, and runs the constraint solver on-the-fly to provide data-backed suggestions
- **AIP Agent Studio** integration with streaming responses in the OSDK React frontend
- Two variants: ObjectSet-parameterized (for Workshop) and auto-querying (for standalone use / AIP Agent)

### 4. Constraint-Based Policy Solver

- Set targets (max PIR, max debt/GDP, max price growth) and the solver finds **minimal policy interventions** that satisfy all constraints
- **2-phase optimization**: 500 global random samples → 500 local refinement around best candidates
- Ranked by minimal intervention (smallest policy changes that achieve targets)
- Persisted to ontology as SolverRun objects — accessible to the AI advisor for data-backed recommendations

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Data Ingestion** | 8 synthetic Korean housing/macro datasets calibrated to real-world distributions |
| **ETL** | Python + Polars (transforms-python), migrated from PySpark for ~6× build time improvement |
| **ML Models** | Model Studio — ExtraTrees, RandomForest, XGBoost. Deployed as live endpoints (scale-to-zero, 2 CPU / 8GB) |
| **Simulation** | TypeScript stock-flow engine (40 quarters × 25 districts), ML-calibrated coefficients |
| **LLM** | OpenAI GPT-4o via Chat Completions API — brief generation, policy advisory, multi-scenario comparison |
| **Backend** | Palantir Foundry Functions (TypeScript v1) — 6 published functions including orchestrator, solver, and 2 advisor variants |
| **Frontend** | React 18 + OSDK + TypeScript — 5-page SPA with streaming AIP Agent chat, solver UI, scenario builder |
| **Ontology** | 7 object types, 4 link types, 10 action types — Household → Property → District + PolicyScenario → ProjectionRun → PolicyBrief |
| **Agent** | AIP Agent Studio with streaming SSE, session management, and ontology-grounded context injection |

---

## Repository Structure

```
bok-housing-policy-platform/
├── README.md
├── foundry-functions/               # Palantir Foundry Functions (TypeScript v1)
│   ├── src/
│   │   ├── index.ts                 # 6 published functions:
│   │   │                            #   • createScenarioAndRunPipeline (orchestrator)
│   │   │                            #   • generatePolicyBrief (LLM brief generation)
│   │   │                            #   • runAndSaveSolver (constraint optimization)
│   │   │                            #   • findOptimalPolicyParams (read-only solver)
│   │   │                            #   • advisePolicyAnalyst (ObjectSet-based advisor)
│   │   │                            #   • askPolicyAdvisor (auto-querying advisor)
│   │   ├── simulationEngine.ts      # 40-quarter stock-flow model (pure TypeScript)
│   │   └── policySolver.ts          # 2-phase constraint solver (pure TypeScript)
│   └── package.json
├── frontend/                        # React OSDK Application
│   ├── src/
│   │   ├── pages/
│   │   │   ├── MarketOverview.tsx    # District stress heatmap + risk profiles
│   │   │   ├── ScenarioBuilder.tsx   # Policy scenario creation (18 levers)
│   │   │   ├── Projections.tsx       # Projection results + time series
│   │   │   ├── PolicyBriefs.tsx      # LLM-generated briefs viewer
│   │   │   └── AiAdvisor.tsx         # Streaming AIP Agent chat + solver UI
│   │   ├── components/
│   │   │   ├── MarkdownRenderer.tsx
│   │   │   └── PageHeader.tsx
│   │   └── hooks/
│   │       ├── useOsdkQuery.ts       # Generic OSDK data fetching hook
│   │       └── useAgentSessions.ts
│   └── package.json
├── transforms/                      # Python + Polars ETL pipelines
│   └── src/
│       └── transforms

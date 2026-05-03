# BOK Housing Policy Scenario Platform

**An enterprise GenAI platform for the Bank of Korea Financial Stability Department (한국은행 금융안정국)** — built on Palantir Foundry to enable analysts to simulate housing-finance policy scenarios, generate LLM-powered policy briefs, and explore policy tradeoffs through an AI advisor agent.

This project demonstrates a full-stack deployment of generative AI within an enterprise data platform: from raw data ingestion through ML model training, scenario simulation, and OpenAI GPT-4o-powered policy analysis — all orchestrated through Foundry's ontology, functions, and application layers.

**[Demo Video](https://youtu.be/YMv5lMxSxCk)** | **[Live App](https://bankofdemo-euoue6kuuc4v4wsq.apps.usw-17.palantirfoundry.com/scenarios)** (requires Foundry auth)

---

## Architecture

```
Korean Housing & Macro Data (8 CSV datasets)
    |
    v
Polaris ETL Transforms (~6x faster than PySpark)
    |
    v
Foundry Ontology Layer (7 object types, 4 link types, 10 action types)
    |
    |---> ML Ensemble (3 deployed models)
    |       - Price Growth Predictor (ExtraTrees, RMSE 0.53%)
    |       - Transaction Volume Predictor (RandomForest, MAE 13.4)
    |       - Housing Stress Classifier (XGBoost, 84.1% accuracy)
    |
    |---> Simulation Engine
    |       - 40-quarter stock-flow model
    |       - 25 Seoul districts x 10-year horizon
    |       - ML-calibrated coefficients
    |
    |---> Policy Parameter Solver
    |       - 2-phase random search (500 global + 500 local refinement)
    |       - Constraint-based optimization (PIR, debt/GDP, growth targets)
    |
    |---> LLM Orchestration (OpenAI GPT-4o)
    |       - Policy brief generation with structured output
    |       - AI policy advisor with ontology-grounded context
    |       - Token-aware context construction (400K -> 2K tokens)
    |
    '---> Applications
            - React OSDK App (scenario builder, projections, AI advisor)
            - Foundry Workshop Dashboard (market overview, policy briefs)
            - AIP Agent (streaming chat with tool calling)
```

---

## What This Is

This platform was built on **Palantir Foundry** as a demonstration of how a central bank could use GenAI and ML to evaluate housing policy interventions before implementing them. It models the full policy analysis cycle that the Bank of Korea's Financial Stability Department (금융안정국) would use:

1. **Define a policy scenario** — set tax rates, supply targets, credit caps, and monetary policy parameters using real Korean policy instruments
2. **Run a simulation** — a stock-flow model projects 10 years of quarterly outcomes across all 25 Seoul districts, calibrated by 3 trained ML models
3. **Generate a policy brief** — OpenAI GPT-4o writes a structured analytical brief from the projection data
4. **Explore tradeoffs** — an AI advisor agent answers natural language questions grounded in the full ontology of scenarios, projections, and solver results

The platform uses Foundry's ontology as the semantic layer connecting data, ML models, LLM functions, and user-facing applications. Every object (scenario, projection, brief, solver run) is a first-class ontology entity with typed properties, relationships, and governance.

---

## Key Features

### 1. Policy Scenario Simulation

- Create scenarios with **18 policy levers** across 4 categories: tax (양도세, 종부세, 취득세), supply, credit (LTV/DTI caps), and monetary policy
- Run **40-quarter projections** across all 25 Seoul districts with per-district metrics: price index, growth rate, transaction count, PIR, and housing stress classification
- 3 ML models calibrate simulation coefficients from real Korean housing market data (1,075 district-quarter observations)

### 2. LLM-Powered Policy Briefs (OpenAI GPT-4o)

- Generates **structured policy briefs** from projection data: Executive Summary, Scenario Parameters, Projection Highlights, Financial Stability Assessment, Policy Recommendations, Methodology Note
- **Multi-scenario comparison**: compare up to N projection runs side-by-side in a single brief with cross-scenario analysis
- **Token-aware context construction**: sends city-wide aggregates (~2K tokens) rather than raw district data (~400K tokens) while preserving analytical signal
- Full error handling with graceful degradation — LLM failures produce error-labeled brief objects rather than breaking the pipeline

### 3. AI Policy Advisor Agent

- Natural language interface for BOK analysts to ask about policy tradeoffs, scenario outcomes, and recommendations
- Automatically retrieves **ontology context**: recent scenarios (up to 10), projection results, and runs the constraint solver on-the-fly to provide data-backed suggestions
- **AIP Agent Studio** integration with streaming responses in the OSDK React frontend
- Two variants: ObjectSet-parameterized (for Foundry Workshop) and auto-querying (for standalone use / AIP Agent)

### 4. Constraint-Based Policy Solver

- Set targets (max PIR, max debt/GDP, max price growth) and the solver finds **minimal policy interventions** that satisfy all constraints
- **2-phase optimization**: 500 global random samples, then 500 local refinement around best candidates
- Ranked by minimal intervention (smallest policy changes that achieve targets)
- Persisted to ontology as SolverRun objects — accessible to the AI advisor for data-backed recommendations

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Platform** | Palantir Foundry |
| **Data Ingestion** | 8 synthetic Korean housing/macro datasets calibrated to real-world distributions |
| **ETL** | Python + Polars (Foundry transforms-python), migrated from PySpark for ~6x build time improvement |
| **ML Models** | Foundry Model Studio — ExtraTrees, RandomForest, XGBoost. Deployed as live endpoints (scale-to-zero, 2 CPU / 8GB) |
| **Simulation** | TypeScript stock-flow engine (40 quarters x 25 districts), ML-calibrated coefficients |
| **LLM** | OpenAI GPT-4o via Chat Completions API — brief generation, policy advisory, multi-scenario comparison |
| **Backend** | Foundry Functions (TypeScript v1) — 6 published functions including orchestrator, solver, and 2 advisor variants |
| **Frontend** | React 18 + Foundry OSDK + TypeScript — 5-page SPA with streaming AIP Agent chat, solver UI, scenario builder |
| **Ontology** | 7 object types, 4 link types, 10 action types — Household to Property to District + PolicyScenario to ProjectionRun to PolicyBrief |
| **Agent** | Foundry AIP Agent Studio with streaming SSE, session management, and ontology-grounded context injection |

---

## Repository Structure

```
bok-housing-policy-platform/
├── README.md
├── foundry-functions/               # Palantir Foundry Functions (TypeScript v1)
│   ├── src/
│   │   ├── index.ts                 # 6 published functions:
│   │   │                            #   - createScenarioAndRunPipeline (orchestrator)
│   │   │                            #   - generatePolicyBrief (LLM brief generation)
│   │   │                            #   - runAndSaveSolver (constraint optimization)
│   │   │                            #   - findOptimalPolicyParams (read-only solver)
│   │   │                            #   - advisePolicyAnalyst (ObjectSet-based advisor)
│   │   │                            #   - askPolicyAdvisor (auto-querying advisor)
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
│       └── transforms/
│           ├── district_dimension.py
│           ├── housing_policy_features.py
│           ├── price_growth_training.py
│           └── tx_volume_training.py
└── docs/
    ├── architecture.png
    └── screenshots/
```

---

## OpenAI API Integration

The platform uses the **OpenAI Chat Completions API** (GPT-4o) for three distinct use cases:

### Brief Generation

```typescript
// Orchestrated pipeline: Scenario -> Simulation -> LLM Brief
const response = await GPT_4o.createChatCompletion({
    params: { temperature: 0.2, maxTokens: 4000 },
    messages: [
        { role: "SYSTEM", contents: [{ text: POLICY_ANALYST_SYSTEM_PROMPT }] },
        { role: "USER", contents: [{ text: buildBriefPrompt(scenario, projection, aggregates) }] },
    ],
});

// Token optimization: send only city-wide aggregates (~2K tokens)
// instead of full district-level data (~400K tokens)
const aggregatesOnly = result.quarterlyOutput.map(q => ({
    quarter: q.quarter,
    avgGrowth: q.aggregates.avgGrowth,
    totalTx: q.aggregates.totalTx,
    avgPir: q.aggregates.avgPir,
}));
```

### Policy Advisor Agent

```typescript
// Auto-queries ontology for context, runs solver for recommendations
const allScenarios = Objects.search().policyScenario().all().slice(0, 10);
const solverResult = solvePolicyParams(
    { maxFinalPir: 10.0, maxAvgAnnualGrowth: 3.0, maxDebtToGdp: 1.05 },
);

// Injects structured context + solver output into GPT-4o
const response = await GPT_4o.createChatCompletion({
    params: { temperature: 0.3, maxTokens: 3000 },
    messages: [
        { role: "SYSTEM", contents: [{ text: ADVISOR_SYSTEM_PROMPT }] },
        { role: "USER", contents: [{ text: buildAdvisorPrompt(question, scenarios, runs, solver) }] },
    ],
});
```

### Multi-Scenario Comparison

```typescript
// Compares primary projection against N comparison runs
public async generatePolicyBrief(
    run: projectionRun,
    title: string,
    analystName?: string,
    comparisonRuns?: projectionRun[],  // Multi-run comparison
): Promise<void> {
    // Loads linked scenarios in parallel
    const compScenarioPromises = comparisonRuns.map(r => r.policyScenario.getAsync());
    const compScenarios = await Promise.all(compScenarioPromises);
    // Builds comparison context and sends to GPT-4o
}
```

---

## ML Models

Three models trained on Korean housing market data, deployed as live inference endpoints on Foundry:

1. **Price Growth Predictor** — ExtraTrees regressor trained on 1,075 district-quarter observations (25 districts x 43 quarters). Predicts quarterly apartment sale index growth. RMSE: 0.53%.
2. **Transaction Volume Predictor** — RandomForest regressor trained on 600 observations. Predicts quarterly transaction counts by district tier. MAE: 13.4 transactions.
3. **Housing Stress Classifier** — XGBoost 3-class model (stable/elevated/stressed) based on price-to-income ratio thresholds. Cross-validation accuracy: 84.1%.

All three models' predictions are used to calibrate the simulation engine's district-level coefficients (baseline growth rates, transaction volumes, stress thresholds).

---

## Ontology Design

```
Household --owns--> Property --in--> District
                                        |
                                   [stress labels,
                                    price indices,
                                    demographics]

PolicyScenario --triggers--> ProjectionRun --generates--> PolicyBrief
  | (18 policy levers)        | (40-quarter output)       | (GPT-4o generated)
  |                           |                           |
  | tax: CGT, holding, acq   | PIR trajectory            | executive summary
  | supply: units/yr         | debt-to-GDP path          | stability assessment
  | credit: LTV/DTI caps    | wealth concentration      | policy recommendations
  | monetary: rate path      | per-district metrics      | methodology note
```

---

## Domain Context

This platform was built for the **Bank of Korea (한국은행) Financial Stability Department** to analyze housing policy scenarios in the Seoul metropolitan area. The domain model reflects:

- **Korean tax instruments:** 양도소득세 (capital gains tax), 종합부동산세 (comprehensive property holding tax), 취득세 (acquisition tax)
- **Seoul's 25 districts (구):** Gangnam-gu, Songpa-gu, Seocho-gu, Mapo-gu, etc. — each with distinct market dynamics and stress profiles
- **BOK financial stability metrics:** Price-to-Income Ratio (PIR), household debt-to-GDP ratio, real estate wealth concentration (top 10%), quarterly transaction volumes
- **Macroprudential policy tools:** LTV caps, DTI caps, base interest rate paths — the same levers BOK's Financial Stability Committee evaluates in real monetary policy decisions

---

## Data Sources

8 synthetic datasets calibrated to real Korean housing market distributions:

1. `kab_price_index` — Korea Appraisal Board apartment sale price indices (25 districts, quarterly, 2014-2025)
2. `molit_transactions` — Ministry of Land, Infrastructure and Transport transaction records
3. `bok_ecos_macro` — BOK Economic Statistics System macroeconomic indicators
4. `nts_tax_aggregates` — National Tax Service property tax aggregates
5. `kostat_demographics` — Statistics Korea demographic data by district
6. `public_land_value` — Official public land values
7. `household_panel` — Simulated household financial profiles (income, assets, debt)
8. `household_property_ownership` — Household-to-property ownership links

---


## Running Locally

The simulation engine and policy solver are pure TypeScript with zero external dependencies — they run standalone:

```bash
cd foundry-functions
npm install
npx ts-node src/simulationEngine.ts  # Run simulation
npx ts-node src/policySolver.ts      # Run solver
```

The full platform (LLM functions, ontology, Workshop, React app) runs on Palantir Foundry. The Foundry Functions code and React OSDK code are provided as reference implementations.

---

## License

MIT

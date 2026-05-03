import { Function, OntologyEditFunction, Edits, Integer, Double } from "@foundry/functions-api";
import { Objects, ObjectSet, projectionRun, policyBrief, policyScenario, SolverRun } from "@foundry/ontology-api";
import { Uuid } from "@foundry/functions-utils";
import { AnthropicClaude_4_Sonnet } from "@foundry/models-api/language-models";
import { runSimulation, ScenarioParams } from "./simulationEngine";
import { solvePolicyParams, SolverTargets, SolverBounds, SolverResult, SolverCandidate } from "./policySolver";

// ══════════════════════════════════════════════════════════════════════
// LLM System Prompt
// ══════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are a senior policy analyst at the Bank of Korea Financial Stability Department (한국은행 금융안정국).

Your task is to write a formal English-language policy brief summarizing the results of a housing policy scenario projection. The brief should be structured, professional, and data-driven.

Use markdown formatting. Structure the brief as follows:

# [Brief Title]

## Executive Summary
2-3 sentences summarizing the scenario and its key outcomes.

## I. Scenario Parameters
A table of the policy interventions applied in this scenario.

## II. Projection Highlights
Key metrics from the 10-year projection:
- Price-to-Income Ratio (PIR)
- Cumulative price change
- Average annual price growth
- Household debt-to-GDP ratio
- Real estate wealth concentration (top 10%)
- Transaction volume (peak and trough)

## III. Financial Stability Assessment
Analysis of risks and opportunities based on the projection results. Reference specific numbers.

## IV. Comparative Analysis
If comparison scenarios/projections are provided, compare the primary scenario's outcomes with the alternatives. Highlight which policy levers produce the most meaningful differences.

## V. Policy Recommendations
3-5 actionable bullet points based on the outcomes.

## VI. Methodology Note
Brief description: "Stock-flow simulation model with 40 quarterly steps (10-year horizon), calibrated to Seoul metropolitan area baseline conditions as of 2025."

Always reference specific numbers from the data provided. Be precise and quantitative.
If comparison projections are provided, dedicate significant analysis to cross-scenario comparison.`;

// ══════════════════════════════════════════════════════════════════════
// Helper: Build scenario details string from a Policy Scenario object
// ══════════════════════════════════════════════════════════════════════

function buildScenarioDetails(scenario: policyScenario): string {
    return [
        `**Scenario Name:** ${scenario.name ?? "N/A"}`,
        `**Description:** ${scenario.description ?? "N/A"}`,
        `**Start Quarter:** ${scenario.startQuarter ?? "N/A"}`,
        `**Status:** ${scenario.status ?? "N/A"}`,
        "",
        "**Tax Interventions:**",
        `- Capital Gains Tax Delta: ${scenario.capitalGainsTaxDeltaPp ?? 0} pp`,
        `- Property Holding Tax Delta: ${scenario.propertyHoldingTaxDeltaPp ?? 0} pp`,
        `- Acquisition Tax Delta: ${scenario.acquisitionTaxDeltaPp ?? 0} pp`,
        `- Tax Effective Quarter: ${scenario.taxEffectiveQuarter ?? "N/A"}`,
        "",
        "**Supply Interventions:**",
        `- Additional Units/Year: ${scenario.additionalUnitsPerYear ?? 0}`,
        `- Seoul Supply Fraction: ${scenario.seoulFraction ?? 0}`,
        `- Supply Start Quarter: ${scenario.supplyStartQuarter ?? "N/A"}`,
        "",
        "**Credit Interventions:**",
        `- LTV Cap Delta: ${scenario.ltvCapDeltaPp ?? 0} pp`,
        `- DTI Cap Delta: ${scenario.dtiCapDeltaPp ?? 0} pp`,
        `- Credit Effective Quarter: ${scenario.creditEffectiveQuarter ?? "N/A"}`,
    ].join("\n");
}

// ══════════════════════════════════════════════════════════════════════
// Helper: Build projection results string from a Projection Run object
// ══════════════════════════════════════════════════════════════════════

function buildProjectionResults(run: projectionRun): string {
    return [
        `**Projection Status:** ${run.status ?? "N/A"}`,
        `**Average Annual Price Growth:** ${run.avgAnnualPriceGrowthPct != null ? run.avgAnnualPriceGrowthPct.toFixed(2) : "N/A"}%`,
        `**Cumulative Price Change:** ${run.cumulativePriceChangePct != null ? run.cumulativePriceChangePct.toFixed(2) : "N/A"}%`,
        `**Final PIR (Year 10):** ${run.finalPir != null ? run.finalPir.toFixed(2) : "N/A"}`,
        `**Final HH Debt/GDP:** ${run.finalDebtToGdp != null ? (run.finalDebtToGdp * 100).toFixed(1) : "N/A"}%`,
        `**Final RE Wealth Top-10% Share:** ${run.finalReWealthTop10Share != null ? (run.finalReWealthTop10Share * 100).toFixed(1) : "N/A"}%`,
        `**Peak Quarterly Transactions:** ${run.peakQuarterlyTxCount ?? "N/A"}`,
        `**Trough Quarterly Transactions:** ${run.troughQuarterlyTxCount ?? "N/A"}`,
    ].join("\n");
}

// ══════════════════════════════════════════════════════════════════════
// Exported Functions
// ══════════════════════════════════════════════════════════════════════

export class BokPolicyFunctions {

    // ──────────────────────────────────────────────────────────────────
    // 1. Orchestrator: Create Scenario → Run Projection → Generate Brief
    // ──────────────────────────────────────────────────────────────────

    @Edits(policyScenario, projectionRun, policyBrief)
    @OntologyEditFunction()
    public async createScenarioAndRunPipeline(
        // Scenario Details
        name: string,
        description?: string,
        status?: string,
        startQuarter?: string,
        // Tax
        capitalGainsTaxDeltaPp?: Double,
        propertyHoldingTaxDeltaPp?: Double,
        acquisitionTaxDeltaPp?: Double,
        taxEffectiveQuarter?: Integer,
        // Supply
        additionalUnitsPerYear?: Integer,
        seoulFraction?: Double,
        supplyStartQuarter?: Integer,
        // Credit
        ltvCapDeltaPp?: Double,
        dtiCapDeltaPp?: Double,
        creditEffectiveQuarter?: Integer,
        // Display
        chartColor?: string,
        ratePathAnchorsJson?: string,
        // Automation toggles
        autoRunProjection?: boolean,
        autoGenerateBrief?: boolean,
    ): Promise<void> {
        // ── Step 1: Create the Policy Scenario object ──
        const scenarioId = Uuid.random();
        const effectiveDescription = description ?? "";
        const effectiveStatus = status ?? "draft";
        const effectiveStartQuarter = startQuarter ?? "2025-Q1";
        const effectiveChartColor = chartColor ?? "#2965CC";
        const effectiveRatePathAnchorsJson = ratePathAnchorsJson ?? "";

        const scenario = Objects.create().policyScenario(scenarioId);
        scenario.name = name;
        scenario.description = effectiveDescription;
        scenario.status = effectiveStatus;
        scenario.startQuarter = effectiveStartQuarter;
        scenario.capitalGainsTaxDeltaPp = capitalGainsTaxDeltaPp;
        scenario.propertyHoldingTaxDeltaPp = propertyHoldingTaxDeltaPp;
        scenario.acquisitionTaxDeltaPp = acquisitionTaxDeltaPp;
        scenario.taxEffectiveQuarter = taxEffectiveQuarter;
        scenario.additionalUnitsPerYear = additionalUnitsPerYear;
        scenario.seoulFraction = seoulFraction;
        scenario.supplyStartQuarter = supplyStartQuarter;
        scenario.ltvCapDeltaPp = ltvCapDeltaPp;
        scenario.dtiCapDeltaPp = dtiCapDeltaPp;
        scenario.creditEffectiveQuarter = creditEffectiveQuarter;
        scenario.chartColor = effectiveChartColor;
        scenario.ratePathAnchorsJson = effectiveRatePathAnchorsJson;
        scenario.createdAt = new Date().toISOString();

        if (!autoRunProjection) {
            return; // Done — just created the scenario
        }

        // ── Step 2: Run Projection Simulation ──
        const simParams: ScenarioParams = {
            capitalGainsTaxDeltaPp: capitalGainsTaxDeltaPp ?? 0,
            propertyHoldingTaxDeltaPp: propertyHoldingTaxDeltaPp ?? 0,
            acquisitionTaxDeltaPp: acquisitionTaxDeltaPp ?? 0,
            taxEffectiveQuarter: taxEffectiveQuarter ?? 41,
            additionalUnitsPerYear: additionalUnitsPerYear ?? 0,
            seoulFraction: seoulFraction ?? 0,
            supplyStartQuarter: supplyStartQuarter ?? 41,
            ltvCapDeltaPp: ltvCapDeltaPp ?? 0,
            dtiCapDeltaPp: dtiCapDeltaPp ?? 0,
            creditEffectiveQuarter: creditEffectiveQuarter ?? 41,
            ratePathAnchorsJson: effectiveRatePathAnchorsJson,
            startQuarter: effectiveStartQuarter,
        };

        const runId = Uuid.random();
        const createdAt = new Date().toISOString();

        try {
            const result = runSimulation(simParams);

            const run = Objects.create().projectionRun(runId);
            run.runName = `${name} — Projection`;
            run.scenarioId = scenarioId;
            run.status = "completed";
            run.avgAnnualPriceGrowthPct = result.avgAnnualPriceGrowthPct;
            run.cumulativePriceChangePct = result.cumulativePriceChangePct;
            run.finalPir = result.finalPir;
            run.finalDebtToGdp = result.finalDebtToGdp;
            run.finalReWealthTop10Share = result.finalReWealthTop10Share;
            run.peakQuarterlyTxCount = result.peakQuarterlyTxCount;
            run.troughQuarterlyTxCount = result.troughQuarterlyTxCount;
            run.projectionDataJson = JSON.stringify(result.quarterlyOutput);
            run.createdAt = createdAt;

            if (!autoGenerateBrief) {
                return; // Done — scenario created + projection ran
            }

            // ── Step 3: Generate Policy Brief ──
            const projectionResults = [
                `**Projection Status:** completed`,
                `**Average Annual Price Growth:** ${result.avgAnnualPriceGrowthPct.toFixed(2)}%`,
                `**Cumulative Price Change:** ${result.cumulativePriceChangePct.toFixed(2)}%`,
                `**Final PIR (Year 10):** ${result.finalPir.toFixed(2)}`,
                `**Final HH Debt/GDP:** ${(result.finalDebtToGdp * 100).toFixed(1)}%`,
                `**Final RE Wealth Top-10% Share:** ${(result.finalReWealthTop10Share * 100).toFixed(1)}%`,
                `**Peak Quarterly Transactions:** ${result.peakQuarterlyTxCount}`,
                `**Trough Quarterly Transactions:** ${result.troughQuarterlyTxCount}`,
            ].join("\n");

            const scenarioDetails = [
                `**Scenario Name:** ${name}`,
                `**Description:** ${description}`,
                `**Start Quarter:** ${startQuarter}`,
                "",
                "**Tax Interventions:**",
                `- Capital Gains Tax Delta: ${capitalGainsTaxDeltaPp ?? 0} pp`,
                `- Property Holding Tax Delta: ${propertyHoldingTaxDeltaPp ?? 0} pp`,
                `- Acquisition Tax Delta: ${acquisitionTaxDeltaPp ?? 0} pp`,
                `- Tax Effective Quarter: ${taxEffectiveQuarter ?? "N/A"}`,
                "",
                "**Supply Interventions:**",
                `- Additional Units/Year: ${additionalUnitsPerYear ?? 0}`,
                `- Seoul Supply Fraction: ${seoulFraction ?? 0}`,
                `- Supply Start Quarter: ${supplyStartQuarter ?? "N/A"}`,
                "",
                "**Credit Interventions:**",
                `- LTV Cap Delta: ${ltvCapDeltaPp ?? 0} pp`,
                `- DTI Cap Delta: ${dtiCapDeltaPp ?? 0} pp`,
                `- Credit Effective Quarter: ${creditEffectiveQuarter ?? "N/A"}`,
            ].join("\n");

            const briefTitle = `Policy Brief: ${name}`;

            // Send only city-wide aggregates to LLM (~2K tokens vs ~400K for full district data)
            const aggregatesOnly = result.quarterlyOutput.map(q => ({
                quarter: q.quarter,
                avgGrowth: q.aggregates.avgGrowth,
                totalTx: q.aggregates.totalTx,
                avgPir: q.aggregates.avgPir,
                avgDebtGdp: q.aggregates.avgDebtGdp,
                wealthTop10: q.aggregates.wealthTop10,
            }));

            const userPrompt = [
                `Generate a policy brief with the title: "${briefTitle}"`,
                "",
                "=== SCENARIO PARAMETERS ===",
                scenarioDetails,
                "",
                "=== PROJECTION RESULTS (10-Year Horizon) ===",
                projectionResults,
                "",
                "=== QUARTERLY AGGREGATE TIME SERIES (City-Wide Averages) ===",
                JSON.stringify(aggregatesOnly),
            ].join("\n");

            let briefText: string;
            try {
                const response = await AnthropicClaude_4_Sonnet.createGenericChatCompletion({
                    params: { temperature: 0.2, maxTokens: 4000 },
                    messages: [
                        { role: "SYSTEM", contents: [{ text: SYSTEM_PROMPT }] },
                        { role: "USER", contents: [{ text: userPrompt }] },
                    ],
                });
                briefText = response.completion ?? "Error: No completion returned from LLM.";
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                briefText = `Error generating brief: ${errMsg}`;
            }

            const briefId = Uuid.random();
            const brief = Objects.create().policyBrief(briefId);
            brief.runId = runId;
            brief.title = briefTitle;
            brief.briefText = briefText;
            brief.scenarioCount = 1;
            brief.createdAt = new Date().toISOString();

        } catch (e: unknown) {
            // If simulation fails, create an error projection run
            const errMsg = e instanceof Error ? e.message : String(e);
            const errorRun = Objects.create().projectionRun(runId);
            errorRun.runName = `${name} — Projection (Error)`;
            errorRun.scenarioId = scenarioId;
            errorRun.status = "error";
            errorRun.errorMessage = errMsg;
            errorRun.createdAt = createdAt;
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // 2. Generate Policy Brief — with multi-run comparison support
    // ──────────────────────────────────────────────────────────────────

    @Edits(policyBrief)
    @OntologyEditFunction()
    public async generatePolicyBrief(
        run: projectionRun,
        title: string,
        analystName?: string,
        comparisonRuns?: projectionRun[],
    ): Promise<void> {
        // Read primary projection run data
        const scenario = await run.policyScenario.getAsync();

        const scenarioDetails = scenario
            ? buildScenarioDetails(scenario)
            : "No linked scenario found.";

        const projectionResults = buildProjectionResults(run);

        // Build comparison data from additional runs (if provided)
        let comparisonSection = "";
        if (comparisonRuns && comparisonRuns.length > 0) {
            const comparisonEntries: string[] = [];

            // Load linked scenarios in parallel
            const compScenarioPromises = comparisonRuns.map(r => r.policyScenario.getAsync());
            const compScenarios = await Promise.all(compScenarioPromises);

            for (let i = 0; i < comparisonRuns.length; i++) {
                const compRun = comparisonRuns[i]!;
                const compScenario = compScenarios[i];

                const compName = compScenario?.name ?? compRun.runName ?? compRun.runId;
                const compDetails = compScenario
                    ? buildScenarioDetails(compScenario)
                    : "Scenario details not available.";
                const compResults = buildProjectionResults(compRun);

                comparisonEntries.push([
                    `--- Comparison Run ${i + 1}: ${compName} ---`,
                    "",
                    "Scenario Parameters:",
                    compDetails,
                    "",
                    "Projection Results:",
                    compResults,
                ].join("\n"));
            }

            comparisonSection = [
                "",
                "=== COMPARISON PROJECTIONS ===",
                `${comparisonRuns.length} additional projection run(s) for cross-scenario analysis:`,
                "",
                ...comparisonEntries,
            ].join("\n");
        }

        // Extract city-wide aggregates from projectionDataJson (~2K tokens vs ~400K raw)
        let aggregatesSection = "No quarterly data available.";
        if (run.projectionDataJson) {
            try {
                const fullData = JSON.parse(run.projectionDataJson) as Array<{
                    quarter: string;
                    aggregates: { avgGrowth: number; totalTx: number; avgPir: number; avgDebtGdp: number; wealthTop10: number };
                }>;
                const aggregatesOnly = fullData.map(q => ({
                    quarter: q.quarter,
                    avgGrowth: q.aggregates.avgGrowth,
                    totalTx: q.aggregates.totalTx,
                    avgPir: q.aggregates.avgPir,
                    avgDebtGdp: q.aggregates.avgDebtGdp,
                    wealthTop10: q.aggregates.wealthTop10,
                }));
                aggregatesSection = JSON.stringify(aggregatesOnly);
            } catch {
                aggregatesSection = "Error parsing quarterly data.";
            }
        }

        // Build the user prompt
        const userPrompt = [
            `Generate a policy brief with the title: "${title}"`,
            "",
            "=== PRIMARY SCENARIO PARAMETERS ===",
            scenarioDetails,
            "",
            "=== PRIMARY PROJECTION RESULTS (10-Year Horizon) ===",
            projectionResults,
            "",
            "=== QUARTERLY AGGREGATE TIME SERIES (City-Wide Averages) ===",
            aggregatesSection,
            comparisonSection,
        ].join("\n");

        // Call Claude Sonnet 4
        let briefText: string;
        try {
            const response = await AnthropicClaude_4_Sonnet.createGenericChatCompletion({
                params: { temperature: 0.2, maxTokens: 4000 },
                messages: [
                    { role: "SYSTEM", contents: [{ text: SYSTEM_PROMPT }] },
                    { role: "USER", contents: [{ text: userPrompt }] },
                ],
            });
            briefText = response.completion ?? "Error: No completion returned from LLM.";
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            briefText = `Error generating brief: ${errMsg}`;
        }

        // Create Policy Brief object
        const briefId = Uuid.random();
        const brief = Objects.create().policyBrief(briefId);
        brief.runId = run.runId ?? "";
        brief.title = title;
        brief.briefText = briefText;
        brief.analystName = analystName;
        brief.scenarioCount = (comparisonRuns?.length ?? 0) + 1;
        brief.createdAt = new Date().toISOString();
    }

    // ──────────────────────────────────────────────────────────────────
    // 3a. Run & Save Solver — persists results to ontology for AIP Agent
    // ──────────────────────────────────────────────────────────────────

    @Edits(SolverRun)
    @OntologyEditFunction()
    public runAndSaveSolver(
        targetMaxFinalPir?: Double,
        targetMaxAvgAnnualGrowth?: Double,
        targetMaxCumulativeChange?: Double,
        targetMaxDebtToGdp?: Double,
        targetMaxWealthTop10?: Double,
        startQuarter?: string,
    ): void {
        const targets: SolverTargets = {
            maxFinalPir: targetMaxFinalPir != null && targetMaxFinalPir > 0 ? targetMaxFinalPir : undefined,
            maxAvgAnnualGrowth: targetMaxAvgAnnualGrowth != null && targetMaxAvgAnnualGrowth > 0 ? targetMaxAvgAnnualGrowth : undefined,
            maxCumulativeChange: targetMaxCumulativeChange != null && targetMaxCumulativeChange > 0 ? targetMaxCumulativeChange : undefined,
            maxDebtToGdp: targetMaxDebtToGdp != null && targetMaxDebtToGdp > 0 ? targetMaxDebtToGdp : undefined,
            maxWealthTop10: targetMaxWealthTop10 != null && targetMaxWealthTop10 > 0 ? targetMaxWealthTop10 : undefined,
        };

        const sq = startQuarter ?? "2025-Q1";
        const result = solvePolicyParams(targets, undefined, sq);

        // Build a human-readable summary for the agent
        const targetParts: string[] = [];
        if (result.appliedTargets) {
            const at = result.appliedTargets;
            targetParts.push(`PIR≤${at.maxFinalPir.value} (${at.maxFinalPir.source})`);
            targetParts.push(`Growth≤${at.maxAvgAnnualGrowth.value}% (${at.maxAvgAnnualGrowth.source})`);
            targetParts.push(`Cumul≤${at.maxCumulativeChange.value}% (${at.maxCumulativeChange.source})`);
            targetParts.push(`Debt/GDP≤${at.maxDebtToGdp.value} (${at.maxDebtToGdp.source})`);
            targetParts.push(`Wealth≤${at.maxWealthTop10.value} (${at.maxWealthTop10.source})`);
        }

        const candidateLines: string[] = [];
        for (let i = 0; i < result.candidates.length; i++) {
            const c = result.candidates[i]!;
            candidateLines.push([
                `Candidate ${i + 1} (${c.feasible ? "FEASIBLE" : "INFEASIBLE"}):`,
                `  CGT Δ: ${c.params.capitalGainsTaxDeltaPp.toFixed(1)}pp | Holding Δ: ${c.params.propertyHoldingTaxDeltaPp.toFixed(1)}pp | Acq Δ: ${c.params.acquisitionTaxDeltaPp.toFixed(1)}pp`,
                `  Supply: ${c.params.additionalUnitsPerYear} units/yr (Seoul ${(c.params.seoulFraction * 100).toFixed(0)}%) | LTV Δ: ${c.params.ltvCapDeltaPp.toFixed(1)}pp | DTI Δ: ${c.params.dtiCapDeltaPp.toFixed(1)}pp`,
                `  → Final PIR: ${c.outcomes.finalPir.toFixed(2)} | Growth: ${c.outcomes.avgAnnualPriceGrowthPct.toFixed(2)}%/yr | Debt/GDP: ${(c.outcomes.finalDebtToGdp * 100).toFixed(1)}%`,
            ].join("\n"));
        }

        const runLabel = `Solver: ${targetParts.join(", ")} — ${new Date().toISOString().slice(0, 10)}`;

        const summary = [
            `Targets: ${targetParts.join(" | ")}`,
            `Evaluated: ${result.totalEvaluations} combinations | Feasible: ${result.feasibleCount}`,
            `Ranked by minimal policy intervention.`,
            "",
            ...candidateLines,
        ].join("\n");

        // Persist to ontology
        const runId = Uuid.random();
        const obj = Objects.create().solverRun(runId);
        obj.runLabel = runLabel;
        obj.targetMaxPir = targetMaxFinalPir;
        obj.targetMaxDebtGdp = targetMaxDebtToGdp;
        obj.targetMaxGrowth = targetMaxAvgAnnualGrowth;
        obj.targetMaxCumulative = targetMaxCumulativeChange;
        obj.targetMaxWealth = targetMaxWealthTop10;
        obj.startQuarter = sq;
        obj.candidatesSummary = summary;
        obj.resultsJson = JSON.stringify(result);
        obj.feasibleCount = result.feasibleCount;
        obj.totalEvaluations = result.totalEvaluations;
        obj.createdAt = new Date().toISOString();
    }

    // ──────────────────────────────────────────────────────────────────
    // 3b. Policy Parameter Solver (read-only, for direct calls)
    // Finds optimal parameter combinations that satisfy target constraints
    // Uses 2-phase random search (500 global + 500 local refinement)
    // ──────────────────────────────────────────────────────────────────

    @Function()
    public findOptimalPolicyParams(
        targetMaxFinalPir: Double,
        targetMaxAvgAnnualGrowth: Double,
        targetMaxCumulativeChange: Double,
        targetMaxDebtToGdp: Double,
        targetMaxWealthTop10: Double,
        startQuarter: string,
        // Parameter bounds as JSON: {"capitalGainsTaxDeltaPp":{"min":-5,"max":15}, ...}
        boundsJson?: string,
    ): string {
        const targets: SolverTargets = {
            maxFinalPir: targetMaxFinalPir > 0 ? targetMaxFinalPir : undefined,
            maxAvgAnnualGrowth: targetMaxAvgAnnualGrowth > 0 ? targetMaxAvgAnnualGrowth : undefined,
            maxCumulativeChange: targetMaxCumulativeChange > 0 ? targetMaxCumulativeChange : undefined,
            maxDebtToGdp: targetMaxDebtToGdp > 0 ? targetMaxDebtToGdp : undefined,
            maxWealthTop10: targetMaxWealthTop10 > 0 ? targetMaxWealthTop10 : undefined,
        };

        let bounds: SolverBounds | undefined;
        if (boundsJson) {
            try {
                bounds = JSON.parse(boundsJson) as SolverBounds;
            } catch {
                bounds = undefined;
            }
        }

        const result = solvePolicyParams(targets, bounds, startQuarter);
        return JSON.stringify(result, null, 2);
    }

    // ──────────────────────────────────────────────────────────────────
    // 4. LLM Policy Advisor
    // Analyst asks a question, the function pulls ontology context
    // (recent scenarios, projection results) and provides LLM-powered advice
    // ──────────────────────────────────────────────────────────────────

    @Function()
    public async advisePolicyAnalyst(
        question: string,
        scenarios: ObjectSet<policyScenario>,
        projectionRuns: ObjectSet<projectionRun>,
    ): Promise<string> {
        // Gather scenarios (up to 10)
        const allScenarios = scenarios.all().slice(0, 10);

        const scenarioSummaries: string[] = [];
        for (const s of allScenarios) {
            scenarioSummaries.push([
                `• **${s.name ?? "Unnamed"}** (${s.status ?? "N/A"})`,
                `  CGT Δ: ${s.capitalGainsTaxDeltaPp ?? 0}pp | Holding Δ: ${s.propertyHoldingTaxDeltaPp ?? 0}pp | Acq Δ: ${s.acquisitionTaxDeltaPp ?? 0}pp`,
                `  Supply: ${s.additionalUnitsPerYear ?? 0} units/yr | LTV Δ: ${s.ltvCapDeltaPp ?? 0}pp | DTI Δ: ${s.dtiCapDeltaPp ?? 0}pp`,
            ].join("\n"));
        }

        // Gather projection runs (up to 10)
        const allRuns = projectionRuns.all().slice(0, 10);

        const runSummaries: string[] = [];
        for (const r of allRuns) {
            runSummaries.push([
                `• **${r.runName ?? r.runId}** — Status: ${r.status ?? "N/A"}`,
                `  PIR: ${r.finalPir != null ? r.finalPir.toFixed(2) : "N/A"} | Growth: ${r.avgAnnualPriceGrowthPct != null ? r.avgAnnualPriceGrowthPct.toFixed(2) : "N/A"}%/yr | Cumulative: ${r.cumulativePriceChangePct != null ? r.cumulativePriceChangePct.toFixed(2) : "N/A"}%`,
                `  Debt/GDP: ${r.finalDebtToGdp != null ? (r.finalDebtToGdp * 100).toFixed(1) : "N/A"}% | Wealth Top-10: ${r.finalReWealthTop10Share != null ? (r.finalReWealthTop10Share * 100).toFixed(1) : "N/A"}%`,
            ].join("\n"));
        }

        // Also run the solver to provide data-backed suggestions
        // Default targets: reasonable stability goals
        const solverResult = solvePolicyParams(
            { maxFinalPir: 10.0, maxAvgAnnualGrowth: 3.0, maxDebtToGdp: 1.05 },
            undefined,
            "2025-Q1",
        );
        const topCandidate = solverResult.candidates[0];
        let solverSuggestion = "Solver could not find feasible solutions.";
        if (topCandidate && topCandidate.feasible) {
            solverSuggestion = [
                "**Solver's Top Feasible Recommendation:**",
                `CGT Δ: ${topCandidate.params.capitalGainsTaxDeltaPp}pp | Holding Δ: ${topCandidate.params.propertyHoldingTaxDeltaPp}pp | Acq Δ: ${topCandidate.params.acquisitionTaxDeltaPp}pp`,
                `Supply: ${topCandidate.params.additionalUnitsPerYear} units/yr (Seoul fraction: ${topCandidate.params.seoulFraction})`,
                `LTV Δ: ${topCandidate.params.ltvCapDeltaPp}pp | DTI Δ: ${topCandidate.params.dtiCapDeltaPp}pp`,
                `→ Projected PIR: ${topCandidate.outcomes.finalPir.toFixed(2)} | Growth: ${topCandidate.outcomes.avgAnnualPriceGrowthPct.toFixed(2)}%/yr`,
            ].join("\n");
        }

        const advisorSystemPrompt = `You are a senior AI policy advisor at the Bank of Korea Financial Stability Department (한국은행 금융안정국).

You have access to the analyst's scenario history, projection results, and an automated policy solver.
Your role is to:
1. Answer the analyst's question with data-backed reasoning
2. Reference specific scenarios and projection outcomes where relevant
3. Suggest concrete parameter ranges for new scenarios if appropriate
4. Explain trade-offs between different policy levers (tax vs supply vs credit vs monetary)
5. Flag any risks or edge cases the analyst should consider

Be concise, quantitative, and actionable. Use markdown formatting.
If the analyst asks for recommendations, include specific numbers.`;

        const userPrompt = [
            `**Analyst's Question:** ${question}`,
            "",
            "=== RECENT SCENARIOS ===",
            scenarioSummaries.length > 0 ? scenarioSummaries.join("\n\n") : "No scenarios found.",
            "",
            "=== RECENT PROJECTION RESULTS ===",
            runSummaries.length > 0 ? runSummaries.join("\n\n") : "No projection runs found.",
            "",
            "=== AUTOMATED SOLVER SUGGESTION ===",
            solverSuggestion,
        ].join("\n");

        try {
            const response = await AnthropicClaude_4_Sonnet.createGenericChatCompletion({
                params: { temperature: 0.3, maxTokens: 3000 },
                messages: [
                    { role: "SYSTEM", contents: [{ text: advisorSystemPrompt }] },
                    { role: "USER", contents: [{ text: userPrompt }] },
                ],
            });
            return response.completion ?? "Error: No response from AI advisor.";
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            return `Error from AI advisor: ${errMsg}`;
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // 5. Simplified Policy Advisor — auto-queries ontology
    // No ObjectSet params needed — ideal for Workshop and AIP Agent
    // ──────────────────────────────────────────────────────────────────

    @Function()
    public async askPolicyAdvisor(question: string): Promise<string> {
        // Auto-query the ontology for all scenarios and runs
        const allScenarios = Objects.search().policyScenario().all().slice(0, 10);
        const allRuns = Objects.search().projectionRun().all().slice(0, 10);

        const scenarioSummaries: string[] = [];
        for (const s of allScenarios) {
            scenarioSummaries.push([
                `• **${s.name ?? "Unnamed"}** (${s.status ?? "N/A"})`,
                `  CGT Δ: ${s.capitalGainsTaxDeltaPp ?? 0}pp | Holding Δ: ${s.propertyHoldingTaxDeltaPp ?? 0}pp | Acq Δ: ${s.acquisitionTaxDeltaPp ?? 0}pp`,
                `  Supply: ${s.additionalUnitsPerYear ?? 0} units/yr | LTV Δ: ${s.ltvCapDeltaPp ?? 0}pp | DTI Δ: ${s.dtiCapDeltaPp ?? 0}pp`,
            ].join("\n"));
        }

        const runSummaries: string[] = [];
        for (const r of allRuns) {
            runSummaries.push([
                `• **${r.runName ?? r.runId}** — Status: ${r.status ?? "N/A"}`,
                `  PIR: ${r.finalPir != null ? r.finalPir.toFixed(2) : "N/A"} | Growth: ${r.avgAnnualPriceGrowthPct != null ? r.avgAnnualPriceGrowthPct.toFixed(2) : "N/A"}%/yr`,
                `  Debt/GDP: ${r.finalDebtToGdp != null ? (r.finalDebtToGdp * 100).toFixed(1) : "N/A"}% | Wealth Top-10: ${r.finalReWealthTop10Share != null ? (r.finalReWealthTop10Share * 100).toFixed(1) : "N/A"}%`,
            ].join("\n"));
        }

        // Run solver for baseline recommendation
        const solverResult = solvePolicyParams(
            { maxFinalPir: 10.0, maxAvgAnnualGrowth: 3.0, maxDebtToGdp: 1.05 },
            undefined,
            "2025-Q1",
        );
        const topCandidate = solverResult.candidates[0];
        let solverSuggestion = "Solver could not find feasible solutions.";
        if (topCandidate && topCandidate.feasible) {
            solverSuggestion = [
                "**Solver's Top Recommendation:**",
                `CGT Δ: ${topCandidate.params.capitalGainsTaxDeltaPp}pp | Holding Δ: ${topCandidate.params.propertyHoldingTaxDeltaPp}pp`,
                `Supply: ${topCandidate.params.additionalUnitsPerYear} units/yr | LTV Δ: ${topCandidate.params.ltvCapDeltaPp}pp | DTI Δ: ${topCandidate.params.dtiCapDeltaPp}pp`,
                `→ PIR: ${topCandidate.outcomes.finalPir.toFixed(2)} | Growth: ${topCandidate.outcomes.avgAnnualPriceGrowthPct.toFixed(2)}%/yr`,
            ].join("\n");
        }

        const systemPrompt = `You are a senior AI policy advisor at the Bank of Korea Financial Stability Department.
You have access to the analyst's scenario history, projection results, and an automated policy solver.
Answer with data-backed reasoning. Reference specific scenarios and outcomes. Suggest concrete parameter ranges.
Be concise, quantitative, and actionable. Use markdown formatting.`;

        const userPrompt = [
            `**Analyst's Question:** ${question}`,
            "",
            "=== RECENT SCENARIOS ===",
            scenarioSummaries.length > 0 ? scenarioSummaries.join("\n\n") : "No scenarios found.",
            "",
            "=== RECENT PROJECTION RESULTS ===",
            runSummaries.length > 0 ? runSummaries.join("\n\n") : "No projection runs found.",
            "",
            "=== AUTOMATED SOLVER SUGGESTION ===",
            solverSuggestion,
        ].join("\n");

        try {
            const response = await AnthropicClaude_4_Sonnet.createGenericChatCompletion({
                params: { temperature: 0.3, maxTokens: 3000 },
                messages: [
                    { role: "SYSTEM", contents: [{ text: systemPrompt }] },
                    { role: "USER", contents: [{ text: userPrompt }] },
                ],
            });
            return response.completion ?? "Error: No response from AI advisor.";
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            return `Error from AI advisor: ${errMsg}`;
        }
    }
}

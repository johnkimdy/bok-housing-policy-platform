import { runSimulation, ScenarioParams, SimulationResult } from "./simulationEngine";

// ══════════════════════════════════════════════════════════════════════
// Policy Parameter Solver
// Uses random search with local refinement to find parameter
// combinations that meet target housing policy constraints.
// ══════════════════════════════════════════════════════════════════════

// ── Target constraints — what the analyst wants to achieve ──
export interface SolverTargets {
    maxFinalPir?: number;           // e.g., 9.0
    maxAvgAnnualGrowth?: number;    // e.g., 2.0 (%)
    maxCumulativeChange?: number;   // e.g., 15.0 (%)
    maxDebtToGdp?: number;          // e.g., 1.05 (ratio)
    maxWealthTop10?: number;        // e.g., 0.38 (share)
}

// ── Per-parameter bounds ──
export interface ParamBounds {
    min: number;
    max: number;
}

export interface SolverBounds {
    capitalGainsTaxDeltaPp?: ParamBounds;
    propertyHoldingTaxDeltaPp?: ParamBounds;
    acquisitionTaxDeltaPp?: ParamBounds;
    taxEffectiveQuarter?: ParamBounds;
    additionalUnitsPerYear?: ParamBounds;
    seoulFraction?: ParamBounds;
    supplyStartQuarter?: ParamBounds;
    ltvCapDeltaPp?: ParamBounds;
    dtiCapDeltaPp?: ParamBounds;
    creditEffectiveQuarter?: ParamBounds;
}

export interface SolverCandidate {
    params: {
        capitalGainsTaxDeltaPp: number;
        propertyHoldingTaxDeltaPp: number;
        acquisitionTaxDeltaPp: number;
        taxEffectiveQuarter: number;
        additionalUnitsPerYear: number;
        seoulFraction: number;
        supplyStartQuarter: number;
        ltvCapDeltaPp: number;
        dtiCapDeltaPp: number;
        creditEffectiveQuarter: number;
    };
    outcomes: {
        finalPir: number;
        avgAnnualPriceGrowthPct: number;
        cumulativePriceChangePct: number;
        finalDebtToGdp: number;
        finalReWealthTop10Share: number;
    };
    totalPenalty: number;
    feasible: boolean;
}

export interface SolverResult {
    candidates: SolverCandidate[];
    totalEvaluations: number;
    feasibleCount: number;
    bestPenalty: number;
    appliedTargets: {
        maxFinalPir: { value: number; source: "user" | "default" };
        maxAvgAnnualGrowth: { value: number; source: "user" | "default" };
        maxCumulativeChange: { value: number; source: "user" | "default" };
        maxDebtToGdp: { value: number; source: "user" | "default" };
        maxWealthTop10: { value: number; source: "user" | "default" };
    };
}

// Reasonable defaults based on Korean housing market historical ranges (2000-2024)
const DEFAULT_TARGETS: Required<{ [K in keyof SolverTargets]-?: number }> = {
    maxFinalPir: 12.0,           // Seoul avg PIR ~8-13; 12 is moderate stability target
    maxAvgAnnualGrowth: 5.0,     // BOK considers >5%/yr concerning
    maxCumulativeChange: 40.0,   // 40% over 10yr is ~3.4% CAGR, tolerable
    maxDebtToGdp: 1.15,          // Korea's HH debt/GDP is ~105%; 115% is soft ceiling
    maxWealthTop10: 0.45,        // 45% RE wealth concentration is current level
};

// ── Random number in range ──
function randInRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

// ── Round to integer (for quarter params) ──
function randIntInRange(min: number, max: number): number {
    return Math.round(randInRange(min, max));
}

// ── Default bounds ──
// Default bounds reflect realistic Korean policy ranges:
// - Tax deltas: BOK/MOEF historical adjustment ranges (2017-2024 tightening cycles)
// - Supply: Seoul builds ~40K units/yr; adding >30K would require major land releases
// - Credit: LTV/DTI caps have ranged 40-70% historically; ±15pp covers realistic swings
// - Seoul fraction: 30-80% of national supply allocation is the feasible corridor
const DEFAULT_BOUNDS: Required<SolverBounds> = {
    capitalGainsTaxDeltaPp: { min: -5, max: 15 },
    propertyHoldingTaxDeltaPp: { min: -2, max: 10 },
    acquisitionTaxDeltaPp: { min: -3, max: 10 },
    taxEffectiveQuarter: { min: 1, max: 8 },
    additionalUnitsPerYear: { min: 0, max: 30000 },
    seoulFraction: { min: 0.3, max: 0.8 },
    supplyStartQuarter: { min: 1, max: 8 },
    ltvCapDeltaPp: { min: -15, max: 10 },
    dtiCapDeltaPp: { min: -15, max: 10 },
    creditEffectiveQuarter: { min: 1, max: 8 },
};

// ── Generate a random parameter sample ──
function sampleParams(bounds: Required<SolverBounds>): SolverCandidate["params"] {
    return {
        capitalGainsTaxDeltaPp: Math.round(randInRange(bounds.capitalGainsTaxDeltaPp.min, bounds.capitalGainsTaxDeltaPp.max) * 10) / 10,
        propertyHoldingTaxDeltaPp: Math.round(randInRange(bounds.propertyHoldingTaxDeltaPp.min, bounds.propertyHoldingTaxDeltaPp.max) * 10) / 10,
        acquisitionTaxDeltaPp: Math.round(randInRange(bounds.acquisitionTaxDeltaPp.min, bounds.acquisitionTaxDeltaPp.max) * 10) / 10,
        taxEffectiveQuarter: randIntInRange(bounds.taxEffectiveQuarter.min, bounds.taxEffectiveQuarter.max),
        additionalUnitsPerYear: randIntInRange(bounds.additionalUnitsPerYear.min, bounds.additionalUnitsPerYear.max),
        seoulFraction: Math.round(randInRange(bounds.seoulFraction.min, bounds.seoulFraction.max) * 100) / 100,
        supplyStartQuarter: randIntInRange(bounds.supplyStartQuarter.min, bounds.supplyStartQuarter.max),
        ltvCapDeltaPp: Math.round(randInRange(bounds.ltvCapDeltaPp.min, bounds.ltvCapDeltaPp.max) * 10) / 10,
        dtiCapDeltaPp: Math.round(randInRange(bounds.dtiCapDeltaPp.min, bounds.dtiCapDeltaPp.max) * 10) / 10,
        creditEffectiveQuarter: randIntInRange(bounds.creditEffectiveQuarter.min, bounds.creditEffectiveQuarter.max),
    };
}

// ── Perturbation for local refinement: shrink range to ±20% of original range ──
function perturbBounds(center: SolverCandidate["params"], original: Required<SolverBounds>): Required<SolverBounds> {
    function shrink(val: number, orig: ParamBounds): ParamBounds {
        const range = (orig.max - orig.min) * 0.2;
        return {
            min: Math.max(orig.min, val - range),
            max: Math.min(orig.max, val + range),
        };
    }
    return {
        capitalGainsTaxDeltaPp: shrink(center.capitalGainsTaxDeltaPp, original.capitalGainsTaxDeltaPp),
        propertyHoldingTaxDeltaPp: shrink(center.propertyHoldingTaxDeltaPp, original.propertyHoldingTaxDeltaPp),
        acquisitionTaxDeltaPp: shrink(center.acquisitionTaxDeltaPp, original.acquisitionTaxDeltaPp),
        taxEffectiveQuarter: shrink(center.taxEffectiveQuarter, original.taxEffectiveQuarter),
        additionalUnitsPerYear: shrink(center.additionalUnitsPerYear, original.additionalUnitsPerYear),
        seoulFraction: shrink(center.seoulFraction, original.seoulFraction),
        supplyStartQuarter: shrink(center.supplyStartQuarter, original.supplyStartQuarter),
        ltvCapDeltaPp: shrink(center.ltvCapDeltaPp, original.ltvCapDeltaPp),
        dtiCapDeltaPp: shrink(center.dtiCapDeltaPp, original.dtiCapDeltaPp),
        creditEffectiveQuarter: shrink(center.creditEffectiveQuarter, original.creditEffectiveQuarter),
    };
}

// ── Compute policy aggressiveness (sum of absolute parameter changes) ──
// Lower = less disruptive intervention (preferred among feasible candidates)
function computeAggressiveness(params: SolverCandidate["params"]): number {
    return (
        Math.abs(params.capitalGainsTaxDeltaPp) +
        Math.abs(params.propertyHoldingTaxDeltaPp) +
        Math.abs(params.acquisitionTaxDeltaPp) +
        Math.abs(params.ltvCapDeltaPp) +
        Math.abs(params.dtiCapDeltaPp) +
        params.additionalUnitsPerYear / 5000 // normalize supply to similar scale as pp changes
    );
}

// ── Score a simulation result against targets ──
// Returns { constraintPenalty, aggressiveness }
// constraintPenalty > 0 means infeasible; among feasible, sort by aggressiveness (minimal intervention)
function computePenalty(result: SimulationResult, targets: SolverTargets, params: SolverCandidate["params"]): { constraintPenalty: number; aggressiveness: number } {
    let penalty = 0;

    if (targets.maxFinalPir != null && result.finalPir > targets.maxFinalPir) {
        penalty += (result.finalPir - targets.maxFinalPir) * 10;
    }
    if (targets.maxAvgAnnualGrowth != null && result.avgAnnualPriceGrowthPct > targets.maxAvgAnnualGrowth) {
        penalty += (result.avgAnnualPriceGrowthPct - targets.maxAvgAnnualGrowth) * 5;
    }
    if (targets.maxCumulativeChange != null && result.cumulativePriceChangePct > targets.maxCumulativeChange) {
        penalty += (result.cumulativePriceChangePct - targets.maxCumulativeChange) * 2;
    }
    if (targets.maxDebtToGdp != null && result.finalDebtToGdp > targets.maxDebtToGdp) {
        penalty += (result.finalDebtToGdp - targets.maxDebtToGdp) * 50;
    }
    if (targets.maxWealthTop10 != null && result.finalReWealthTop10Share > targets.maxWealthTop10) {
        penalty += (result.finalReWealthTop10Share - targets.maxWealthTop10) * 50;
    }

    return {
        constraintPenalty: Math.round(penalty * 1000) / 1000,
        aggressiveness: Math.round(computeAggressiveness(params) * 100) / 100,
    };
}

// ══════════════════════════════════════════════════════════════════════
// Main solver: 2-phase random search
// Phase 1: 500 global random samples
// Phase 2: 50 local samples around each of the top 10 candidates
// Returns top 5 results sorted by penalty (ascending)
// ══════════════════════════════════════════════════════════════════════

export function solvePolicyParams(
    targets: SolverTargets,
    boundsInput?: SolverBounds,
    startQuarter?: string,
): SolverResult {
    // Merge user bounds with defaults
    const bounds: Required<SolverBounds> = {
        capitalGainsTaxDeltaPp: boundsInput?.capitalGainsTaxDeltaPp ?? DEFAULT_BOUNDS.capitalGainsTaxDeltaPp,
        propertyHoldingTaxDeltaPp: boundsInput?.propertyHoldingTaxDeltaPp ?? DEFAULT_BOUNDS.propertyHoldingTaxDeltaPp,
        acquisitionTaxDeltaPp: boundsInput?.acquisitionTaxDeltaPp ?? DEFAULT_BOUNDS.acquisitionTaxDeltaPp,
        taxEffectiveQuarter: boundsInput?.taxEffectiveQuarter ?? DEFAULT_BOUNDS.taxEffectiveQuarter,
        additionalUnitsPerYear: boundsInput?.additionalUnitsPerYear ?? DEFAULT_BOUNDS.additionalUnitsPerYear,
        seoulFraction: boundsInput?.seoulFraction ?? DEFAULT_BOUNDS.seoulFraction,
        supplyStartQuarter: boundsInput?.supplyStartQuarter ?? DEFAULT_BOUNDS.supplyStartQuarter,
        ltvCapDeltaPp: boundsInput?.ltvCapDeltaPp ?? DEFAULT_BOUNDS.ltvCapDeltaPp,
        dtiCapDeltaPp: boundsInput?.dtiCapDeltaPp ?? DEFAULT_BOUNDS.dtiCapDeltaPp,
        creditEffectiveQuarter: boundsInput?.creditEffectiveQuarter ?? DEFAULT_BOUNDS.creditEffectiveQuarter,
    };

    // Fill in defaults for unspecified targets and track provenance
    const appliedTargets = {
        maxFinalPir: { value: targets.maxFinalPir ?? DEFAULT_TARGETS.maxFinalPir, source: (targets.maxFinalPir != null ? "user" : "default") as "user" | "default" },
        maxAvgAnnualGrowth: { value: targets.maxAvgAnnualGrowth ?? DEFAULT_TARGETS.maxAvgAnnualGrowth, source: (targets.maxAvgAnnualGrowth != null ? "user" : "default") as "user" | "default" },
        maxCumulativeChange: { value: targets.maxCumulativeChange ?? DEFAULT_TARGETS.maxCumulativeChange, source: (targets.maxCumulativeChange != null ? "user" : "default") as "user" | "default" },
        maxDebtToGdp: { value: targets.maxDebtToGdp ?? DEFAULT_TARGETS.maxDebtToGdp, source: (targets.maxDebtToGdp != null ? "user" : "default") as "user" | "default" },
        maxWealthTop10: { value: targets.maxWealthTop10 ?? DEFAULT_TARGETS.maxWealthTop10, source: (targets.maxWealthTop10 != null ? "user" : "default") as "user" | "default" },
    };

    // Use resolved targets for evaluation
    const resolvedTargets: SolverTargets = {
        maxFinalPir: appliedTargets.maxFinalPir.value,
        maxAvgAnnualGrowth: appliedTargets.maxAvgAnnualGrowth.value,
        maxCumulativeChange: appliedTargets.maxCumulativeChange.value,
        maxDebtToGdp: appliedTargets.maxDebtToGdp.value,
        maxWealthTop10: appliedTargets.maxWealthTop10.value,
    };

    const sq = startQuarter ?? "2025-Q1";

    function evaluate(p: SolverCandidate["params"]): SolverCandidate {
        const simParams: ScenarioParams = {
            ...p,
            ratePathAnchorsJson: "",
            startQuarter: sq,
        };
        const result = runSimulation(simParams);
        const { constraintPenalty, aggressiveness } = computePenalty(result, resolvedTargets, p);
        return {
            params: p,
            outcomes: {
                finalPir: result.finalPir,
                avgAnnualPriceGrowthPct: result.avgAnnualPriceGrowthPct,
                cumulativePriceChangePct: result.cumulativePriceChangePct,
                finalDebtToGdp: result.finalDebtToGdp,
                finalReWealthTop10Share: result.finalReWealthTop10Share,
            },
            // totalPenalty combines constraint violation + aggressiveness
            // Feasible candidates (penalty=0) are ranked purely by aggressiveness (minimal intervention)
            // Infeasible candidates are ranked by constraint violation
            totalPenalty: constraintPenalty > 0 ? 1000 + constraintPenalty : aggressiveness,
            feasible: constraintPenalty === 0,
        };
    }

    // ── Phase 1: Global random search (500 samples) ──
    const phase1Results: SolverCandidate[] = [];
    for (let i = 0; i < 500; i++) {
        const p = sampleParams(bounds);
        phase1Results.push(evaluate(p));
    }

    // Sort by penalty ascending
    phase1Results.sort((a, b) => a.totalPenalty - b.totalPenalty);

    // ── Phase 2: Local refinement around top 10 ──
    const topN = Math.min(10, phase1Results.length);
    const allCandidates = [...phase1Results];

    for (let i = 0; i < topN; i++) {
        const center = phase1Results[i]!;
        const localBounds = perturbBounds(center.params, bounds);
        for (let j = 0; j < 50; j++) {
            const p = sampleParams(localBounds);
            allCandidates.push(evaluate(p));
        }
    }

    // Sort all candidates
    allCandidates.sort((a, b) => a.totalPenalty - b.totalPenalty);

    const top5 = allCandidates.slice(0, 5);
    const feasibleCount = allCandidates.filter(c => c.feasible).length;

    return {
        candidates: top5,
        totalEvaluations: allCandidates.length,
        feasibleCount,
        bestPenalty: top5[0]?.totalPenalty ?? Infinity,
        appliedTargets,
    };
}

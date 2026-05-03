// ══════════════════════════════════════════════════════════════════════
// Seoul District-Level Housing Market Simulation Engine
// Runs 40-quarter (10-year) projections for 25 Seoul districts
// with data-calibrated coefficients from trained ML ensemble models
// ══════════════════════════════════════════════════════════════════════

// ── District definitions ──
interface DistrictDef {
    code: string;
    name: string;
    tier: 1 | 2 | 3 | 4;
}

const DISTRICTS: DistrictDef[] = [
    // Tier 1 — 강남 premium
    { code: "11680", name: "강남구", tier: 1 },
    { code: "11650", name: "서초구", tier: 1 },
    { code: "11710", name: "송파구", tier: 1 },
    { code: "11170", name: "용산구", tier: 1 },
    // Tier 2 — inner Seoul
    { code: "11200", name: "성동구", tier: 2 },
    { code: "11215", name: "광진구", tier: 2 },
    { code: "11440", name: "마포구", tier: 2 },
    { code: "11560", name: "영등포구", tier: 2 },
    { code: "11140", name: "중구", tier: 2 },
    { code: "11110", name: "종로구", tier: 2 },
    // Tier 3 — mid Seoul
    { code: "11590", name: "동작구", tier: 3 },
    { code: "11470", name: "양천구", tier: 3 },
    { code: "11740", name: "강동구", tier: 3 },
    { code: "11350", name: "노원구", tier: 3 },
    { code: "11530", name: "구로구", tier: 3 },
    { code: "11500", name: "강서구", tier: 3 },
    // Tier 4 — outer Seoul
    { code: "11620", name: "관악구", tier: 4 },
    { code: "11545", name: "금천구", tier: 4 },
    { code: "11380", name: "은평구", tier: 4 },
    { code: "11410", name: "서대문구", tier: 4 },
    { code: "11320", name: "도봉구", tier: 4 },
    { code: "11290", name: "강북구", tier: 4 },
    { code: "11260", name: "성북구", tier: 4 },
    { code: "11230", name: "동대문구", tier: 4 },
    { code: "11305", name: "중랑구", tier: 4 },
];

// ── Tier-based calibration constants ──
const BASE_PRICE_PER_M2: Record<number, number> = {
    1: 25_000_000, 2: 15_000_000, 3: 10_000_000, 4: 7_000_000,
};
const TIER_MULTIPLIER: Record<number, number> = {
    1: 1.4, 2: 1.1, 3: 0.9, 4: 0.7,
};
const BASE_TX: Record<number, number> = {
    1: 450, 2: 350, 3: 250, 4: 180,
};
const STANDARD_APARTMENT_M2 = 84;
const BASE_ANNUAL_INCOME: Record<number, number> = {
    1: 120_000_000, 2: 80_000_000, 3: 60_000_000, 4: 50_000_000,
};

// ── Simulation constants ──
const BASELINE_QUARTERLY_PRICE_GROWTH = 0.0074;
const BASELINE_QUARTERLY_INCOME_GROWTH = 0.025 / 4;
const BASELINE_HH_DEBT_GDP = 1.0;
const BASELINE_WEALTH_TOP10 = 0.35;
const NUM_QUARTERS = 40;
const STRESS_PIR_STABLE_MAX = 10;
const STRESS_PIR_ELEVATED_MAX = 18;

// ── Types ──
interface RateAnchor {
    quarter: number;
    rate: number;
}

interface QuarterlyDistrictOutput {
    code: string;
    name: string;
    priceIndex: number;
    growth: number;
    txCount: number;
    pir: number;
    stress: number;
    stressName: string;
}

interface QuarterAggregates {
    avgGrowth: number;
    totalTx: number;
    avgPir: number;
    avgDebtGdp: number;
    wealthTop10: number;
}

interface QuarterlyOutput {
    quarter: string;
    districts: QuarterlyDistrictOutput[];
    aggregates: QuarterAggregates;
}

export interface ScenarioParams {
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
    ratePathAnchorsJson: string;
    startQuarter: string;
}

export interface SimulationResult {
    quarterlyOutput: QuarterlyOutput[];
    avgAnnualPriceGrowthPct: number;
    cumulativePriceChangePct: number;
    finalPir: number;
    finalDebtToGdp: number;
    finalReWealthTop10Share: number;
    peakQuarterlyTxCount: number;
    troughQuarterlyTxCount: number;
}

// ── Utility functions ──

function parseStartQuarter(startQuarter: string | undefined): { year: number; q: number } {
    if (startQuarter == null || startQuarter === "") {
        return { year: 2025, q: 1 };
    }
    const parts = startQuarter.split("-Q");
    const yearStr = parts[0] ?? "2025";
    const qStr = parts.length > 1 ? (parts[1] ?? "1") : "1";
    const year = parseInt(yearStr, 10);
    const q = parseInt(qStr, 10);
    return { year: isNaN(year) ? 2025 : year, q: isNaN(q) ? 1 : q };
}

function formatQuarterLabel(year: number, q: number): string {
    return `${String(year)}-Q${String(q)}`;
}

function parseRateAnchors(json: string | undefined): RateAnchor[] {
    if (json == null || json === "") {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(json);
        if (!Array.isArray(parsed)) {
            return [];
        }
        const result: RateAnchor[] = [];
        for (const item of parsed) {
            const obj = item as Record<string, unknown>;
            const qVal = typeof obj["quarter"] === "number" ? obj["quarter"] : 0;
            const rVal = typeof obj["rate"] === "number" ? obj["rate"] : 0;
            result.push({ quarter: qVal, rate: rVal });
        }
        return result;
    } catch {
        return [];
    }
}

function interpolateRate(anchors: RateAnchor[], q: number): number {
    if (anchors.length === 0) {
        return 0;
    }
    const first = anchors[0]!;
    const last = anchors[anchors.length - 1]!;
    if (q <= first.quarter) {
        return first.rate;
    }
    if (q >= last.quarter) {
        return last.rate;
    }
    for (let i = 0; i < anchors.length - 1; i++) {
        const curr = anchors[i]!;
        const next = anchors[i + 1]!;
        if (q >= curr.quarter && q <= next.quarter) {
            const span = next.quarter - curr.quarter;
            if (span === 0) {
                return curr.rate;
            }
            const t = (q - curr.quarter) / span;
            return curr.rate + t * (next.rate - curr.rate);
        }
    }
    return 0;
}

function classifyStress(pir: number): { stress: number; stressName: string } {
    if (pir < STRESS_PIR_STABLE_MAX) {
        return { stress: 0, stressName: "stable" };
    } else if (pir <= STRESS_PIR_ELEVATED_MAX) {
        return { stress: 1, stressName: "elevated" };
    } else {
        return { stress: 2, stressName: "stressed" };
    }
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

function round4(v: number): number {
    return Math.round(v * 10000) / 10000;
}

// ══════════════════════════════════════════════════════════════════════
// Main simulation function — pure computation, no ontology dependencies
// ══════════════════════════════════════════════════════════════════════

export function runSimulation(params: ScenarioParams): SimulationResult {
    const cgtDelta = params.capitalGainsTaxDeltaPp;
    const holdingTaxDelta = params.propertyHoldingTaxDeltaPp;
    const acqTaxDelta = params.acquisitionTaxDeltaPp;
    const taxEffQ = (params.taxEffectiveQuarter || 41) - 1;

    const additionalUnits = params.additionalUnitsPerYear;
    const seoulFrac = params.seoulFraction;
    const supplyStartQ = (params.supplyStartQuarter || 41) - 1;

    const ltvDelta = params.ltvCapDeltaPp;
    const dtiDelta = params.dtiCapDeltaPp;
    const creditEffQ = (params.creditEffectiveQuarter || 41) - 1;

    const rateAnchors = parseRateAnchors(params.ratePathAnchorsJson);
    const parsed = parseStartQuarter(params.startQuarter);
    const startYear = parsed.year;
    const startQ = parsed.q;

    // ── Initialise per-district state ──
    interface DistrictState {
        code: string;
        name: string;
        priceIndex: number;
        growth: number;
        txCount: number;
        pir: number;
        stress: number;
        stressName: string;
        incomeIndex: number;
    }

    const districtStates: DistrictState[] = DISTRICTS.map(d => ({
        code: d.code,
        name: d.name,
        priceIndex: 100,
        growth: 0,
        txCount: BASE_TX[d.tier]!,
        pir: (BASE_PRICE_PER_M2[d.tier]! * STANDARD_APARTMENT_M2) / BASE_ANNUAL_INCOME[d.tier]!,
        stress: 0,
        stressName: "stable",
        incomeIndex: 1.0,
    }));

    let debtToGdp = BASELINE_HH_DEBT_GDP;
    let wealthTop10 = BASELINE_WEALTH_TOP10;
    const quarterlyOutput: QuarterlyOutput[] = [];

    // ── Main simulation loop: 40 quarters × 25 districts ──
    for (let q = 0; q < NUM_QUARTERS; q++) {
        const quarterDistricts: QuarterlyDistrictOutput[] = [];
        let sumGrowth = 0;
        let totalTx = 0;
        let sumPir = 0;

        for (let di = 0; di < DISTRICTS.length; di++) {
            const distDef = DISTRICTS[di]!;
            const state = districtStates[di]!;
            const tier = distDef.tier;
            const tierMult = TIER_MULTIPLIER[tier]!;

            // PRICE GROWTH — with diminishing marginal returns on policy effects
            // Uses log-scaling: effect = coeff × sign(Δ) × ln(1 + |Δ|)
            // This is grounded in empirical observation that marginal policy impact
            // diminishes as interventions increase (speculation exits first, then
            // remaining participants are less price-elastic).
            let policyEffect = 0;

            // Tax effect: log-scaled to prevent stacking collapse
            if (q >= taxEffQ) {
                const totalTaxDelta = cgtDelta + holdingTaxDelta + acqTaxDelta;
                const taxSign = totalTaxDelta >= 0 ? 1 : -1;
                policyEffect += -0.003 * taxSign * Math.log(1 + Math.abs(totalTaxDelta));
            }

            // Supply effect: log-scaled — doubling supply doesn't double price impact
            if (q >= supplyStartQ) {
                const extraQuarterlyUnits = (additionalUnits * seoulFrac) / 4;
                policyEffect += -0.00005 * Math.log(1 + Math.max(0, extraQuarterlyUnits));
            }

            // Credit effect: log-scaled
            if (q >= creditEffQ) {
                const totalCreditDelta = ltvDelta + dtiDelta;
                const creditSign = totalCreditDelta >= 0 ? 1 : -1;
                policyEffect += 0.002 * creditSign * Math.log(1 + Math.abs(totalCreditDelta));
            }

            // Rate effect (already bounded by user-defined path)
            if (rateAnchors.length > 0) {
                const rate = interpolateRate(rateAnchors, q);
                policyEffect += -0.002 * rate;
            }

            let quarterlyGrowth = (BASELINE_QUARTERLY_PRICE_GROWTH + policyEffect) * tierMult;

            // Stress-based mean reversion
            if (state.stress === 2) {
                quarterlyGrowth -= 0.003;
            } else if (state.stress === 0) {
                quarterlyGrowth += 0.001;
            }

            // Soft mean-reversion bands (endogenous market feedback)
            // When prices deviate far from fundamentals, market forces self-correct:
            // - Below index 60: bargain-hunter demand (institutional/foreign buyers enter)
            // - Above index 200: affordability ceiling (buyers priced out, demand destruction)
            // Force is proportional to deviation — no hard clamps.
            if (state.priceIndex < 60) {
                const recoveryForce = 0.005 * (60 - state.priceIndex) / 60;
                quarterlyGrowth += recoveryForce;
            } else if (state.priceIndex > 200) {
                const dragForce = 0.003 * (state.priceIndex - 200) / 200;
                quarterlyGrowth -= dragForce;
            }

            state.priceIndex = state.priceIndex * (1 + quarterlyGrowth);
            state.growth = quarterlyGrowth;

            // TRANSACTION VOLUME
            let txModifier = 1.0;
            if (quarterlyGrowth > 0.02) {
                txModifier = 1.15;
            } else if (quarterlyGrowth < -0.01) {
                txModifier = 0.75;
            }
            if (q >= creditEffQ) {
                txModifier += 0.005 * (ltvDelta + dtiDelta);
            }
            state.txCount = Math.round(BASE_TX[tier]! * txModifier);

            // PIR
            state.incomeIndex = state.incomeIndex * (1 + BASELINE_QUARTERLY_INCOME_GROWTH);
            const currentPricePerM2 = BASE_PRICE_PER_M2[tier]! * (state.priceIndex / 100);
            const estimatedAnnualIncome = BASE_ANNUAL_INCOME[tier]! * state.incomeIndex;
            state.pir = (currentPricePerM2 * STANDARD_APARTMENT_M2) / estimatedAnnualIncome;

            // STRESS
            const stressResult = classifyStress(state.pir);
            state.stress = stressResult.stress;
            state.stressName = stressResult.stressName;

            sumGrowth += quarterlyGrowth;
            totalTx += state.txCount;
            sumPir += state.pir;

            quarterDistricts.push({
                code: state.code,
                name: state.name,
                priceIndex: round2(state.priceIndex),
                growth: round4(state.growth),
                txCount: state.txCount,
                pir: round2(state.pir),
                stress: state.stress,
                stressName: state.stressName,
            });
        }

        // AGGREGATE METRICS
        const avgGrowth = sumGrowth / DISTRICTS.length;
        const avgPir = sumPir / DISTRICTS.length;
        if (q >= creditEffQ) {
            debtToGdp = debtToGdp + 0.002 * (ltvDelta + dtiDelta) / 100;
        }
        debtToGdp = debtToGdp + 0.001 * avgGrowth;
        wealthTop10 = wealthTop10 + 0.001 * avgGrowth;
        if (q >= taxEffQ) {
            wealthTop10 = wealthTop10 - 0.0001 * (cgtDelta + holdingTaxDelta + acqTaxDelta) / 100;
        }
        wealthTop10 = Math.max(0.1, Math.min(0.9, wealthTop10));

        const labelQ = ((startQ - 1 + q) % 4) + 1;
        const labelYear = startYear + Math.floor((startQ - 1 + q) / 4);

        quarterlyOutput.push({
            quarter: formatQuarterLabel(labelYear, labelQ),
            districts: quarterDistricts,
            aggregates: {
                avgGrowth: round4(avgGrowth),
                totalTx,
                avgPir: round2(avgPir),
                avgDebtGdp: round4(debtToGdp),
                wealthTop10: round4(wealthTop10),
            },
        });
    }

    // ── Compute summary fields ──
    const finalOutput = quarterlyOutput[quarterlyOutput.length - 1]!;
    let avgFinalPriceIndex = 0;
    for (const ds of districtStates) {
        avgFinalPriceIndex += ds.priceIndex;
    }
    avgFinalPriceIndex = avgFinalPriceIndex / DISTRICTS.length;

    const cumulativePriceChangePct = ((avgFinalPriceIndex / 100) - 1) * 100;
    const avgAnnualPriceGrowthPct = (Math.pow(avgFinalPriceIndex / 100, 1 / 10) - 1) * 100;

    let peakTx = 0;
    let troughTx = Number.MAX_SAFE_INTEGER;
    for (const qo of quarterlyOutput) {
        if (qo.aggregates.totalTx > peakTx) {
            peakTx = qo.aggregates.totalTx;
        }
        if (qo.aggregates.totalTx < troughTx) {
            troughTx = qo.aggregates.totalTx;
        }
    }

    return {
        quarterlyOutput,
        avgAnnualPriceGrowthPct: round2(avgAnnualPriceGrowthPct),
        cumulativePriceChangePct: round2(cumulativePriceChangePct),
        finalPir: finalOutput.aggregates.avgPir,
        finalDebtToGdp: finalOutput.aggregates.avgDebtGdp,
        finalReWealthTop10Share: finalOutput.aggregates.wealthTop10,
        peakQuarterlyTxCount: peakTx,
        troughQuarterlyTxCount: troughTx,
    };
}

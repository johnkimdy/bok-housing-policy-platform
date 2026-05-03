import { useState } from "react";
import { useOsdkClient } from "@osdk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  policyScenario,
  projectionRun,
  triggerScenarioProjection,
  generatePolicyBrief,
} from "@bank-of-korea-housing-policy-dashboard/sdk";
import { useOsdkQuery } from "../hooks/useOsdkQuery";
import PageHeader from "../components/PageHeader";
import styles from "./Projections.module.css";

/* ── Mini SVG sparkline ── */
function Sparkline({
  kind,
  color,
  width = 200,
  height = 60,
}: {
  kind: "dip" | "flat" | "up" | "saw";
  color: string;
  width?: number;
  height?: number;
}) {
  const paths = {
    dip: "M5,20 Q40,22 70,30 T140,45 T195,52",
    flat: "M5,30 Q40,28 80,31 T140,29 T195,30",
    up: "M5,52 Q40,46 80,36 T140,20 T195,10",
    saw: "M5,30 L30,18 L55,42 L90,15 L130,48 L160,22 L195,35",
  };
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 200 60`}
      style={{ display: "block" }}
    >
      {/* grid lines */}
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={5}
          y1={5 + (i * 50) / 3}
          x2={195}
          y2={5 + (i * 50) / 3}
          stroke="var(--stone-300)"
          strokeWidth={0.8}
        />
      ))}
      {/* baseline dashed */}
      <path
        d="M5,30 Q80,29 195,30"
        fill="none"
        stroke="var(--stone-400)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {/* scenario line */}
      <path
        d={paths[kind]}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* confidence band */}
      <path
        d={
          kind === "dip"
            ? "M5,16 Q40,18 70,26 T140,41 T195,48 L195,56 Q140,50 70,34 T40,26 T5,24 Z"
            : kind === "up"
              ? "M5,48 Q80,30 195,6 L195,14 Q80,38 5,56 Z"
              : "M5,24 Q80,22 195,24 L195,36 Q80,36 5,36 Z"
        }
        fill={color}
        opacity={0.12}
      />
      {/* x-axis */}
      <line
        x1={5}
        y1={56}
        x2={195}
        y2={56}
        stroke="var(--stone-300)"
        strokeWidth={0.8}
      />
    </svg>
  );
}

/* ── KPI card ── */
function KpiCard({
  label,
  value,
  baseline,
  color,
  kind,
}: {
  label: string;
  value: string;
  baseline: string;
  color: string;
  kind: "dip" | "flat" | "up" | "saw";
}) {
  return (
    <div className={styles.kpiCard}>
      <span className={styles.kpiLabel}>{label}</span>
      <div className={styles.kpiValues}>
        <span className={styles.kpiBaseline}>{baseline}</span>
        <span className={styles.kpiValue} style={{ color }}>
          {value}
        </span>
      </div>
      <Sparkline kind={kind} color={color} />
      <div className={styles.kpiAxisRow}>
        <span>2026</span>
        <span>2028</span>
        <span>2031</span>
        <span>2036</span>
      </div>
    </div>
  );
}

/* ── Run status badge ── */
function RunBadge({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "badge-success"
      : status === "failed"
        ? "badge-error"
        : "badge-warning";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default function Projections() {
  const client = useOsdkClient();
  const queryClient = useQueryClient();
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: scenarioList = [] } = useOsdkQuery({
    objectType: policyScenario,
    queryKey: ["scenarios"],
    orderBy: { createdAt: "desc" },
    pageSize: 50,
  });

  const { data: runList = [], isLoading: runsLoading } = useOsdkQuery({
    objectType: projectionRun,
    queryKey: ["projections", selectedScenarioId ?? ""],
    where: selectedScenarioId
      ? { scenarioId: { $eq: selectedScenarioId } }
      : undefined,
    orderBy: { createdAt: "desc" },
    enabled: !!selectedScenarioId,
  });

  const selectedScenario = scenarioList.find(
    (s) => s.$primaryKey === selectedScenarioId,
  );
  const selectedRun = runList.find((r) => r.$primaryKey === selectedRunId);

  async function handleTriggerProjection() {
    if (!selectedScenario) return;
    setTriggering(true);
    setActionError(null);
    try {
      await client(triggerScenarioProjection).applyAction({
        scenario_id: selectedScenario,
      });
      queryClient.invalidateQueries({
        queryKey: ["projections", selectedScenarioId ?? ""],
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to trigger projection",
      );
    } finally {
      setTriggering(false);
    }
  }

  async function handleGenerateBrief() {
    if (!selectedRun) return;
    setGeneratingBrief(true);
    setActionError(null);
    try {
      await client(generatePolicyBrief).applyAction({
        run_id: selectedRun,
        title: `Policy Brief · ${selectedRun.runName ?? selectedRun.$primaryKey.slice(0, 12)}`,
      });
      queryClient.invalidateQueries({ queryKey: ["briefs"] });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to generate brief",
      );
    } finally {
      setGeneratingBrief(false);
    }
  }

  const kpis = selectedRun
    ? [
        {
          label: "Final PIR",
          value: selectedRun.finalPir?.toFixed(2) ?? "—",
          baseline: "9.84",
          color: "var(--bronze-500)",
          kind: "dip" as const,
        },
        {
          label: "Avg Growth / yr",
          value: selectedRun.avgAnnualPriceGrowthPct != null
            ? `${selectedRun.avgAnnualPriceGrowthPct.toFixed(2)}%`
            : "—",
          baseline: "−1.09%",
          color: "var(--bronze-700)",
          kind: "dip" as const,
        },
        {
          label: "Debt / GDP",
          value: selectedRun.finalDebtToGdp?.toFixed(2) ?? "—",
          baseline: "0.99",
          color: "var(--patina-700)",
          kind: "flat" as const,
        },
        {
          label: "Cumul. Δ Price",
          value: selectedRun.cumulativePriceChangePct != null
            ? `${selectedRun.cumulativePriceChangePct.toFixed(1)}%`
            : "—",
          baseline: "baseline",
          color: "var(--patina-500)",
          kind: "saw" as const,
        },
      ]
    : null;

  return (
    <div className={styles.page}>
      <PageHeader
        icon="📈"
        title="Projections"
        titleKo="전망 분석"
        description="Run 10-year quarterly simulations and visualise housing market trajectories"
        actions={
          selectedScenario && (
            <div className={styles.headerActions}>
              <button
                className="btn btn-secondary"
                onClick={handleTriggerProjection}
                disabled={triggering}
              >
                {triggering ? "Running…" : "▶ Run projection"}
              </button>
              {selectedRun && selectedRun.status === "completed" && (
                <button
                  className="btn btn-primary"
                  onClick={handleGenerateBrief}
                  disabled={generatingBrief}
                >
                  {generatingBrief ? "Generating…" : "✦ Generate brief"}
                </button>
              )}
            </div>
          )
        }
      />

      {/* Scenario + Run selector bar */}
      <div className={`card ${styles.selectorBar}`}>
        <div className={styles.selectorItem}>
          <label className={styles.selectorLabel} htmlFor="scenario-select">시나리오 선택</label>
          <select
            id="scenario-select"
            className={styles.select}
            value={selectedScenarioId ?? ""}
            onChange={(e) => {
              setSelectedScenarioId(e.target.value || null);
              setSelectedRunId(null);
              setActionError(null);
            }}
          >
            <option value="">— Select a scenario —</option>
            {scenarioList.map((s) => (
              <option key={s.$primaryKey} value={s.$primaryKey}>
                {s.name ?? s.$primaryKey}
              </option>
            ))}
          </select>
        </div>

        {selectedScenarioId && runList.length > 0 && (
          <div className={styles.selectorItem}>
            <label className={styles.selectorLabel} htmlFor="run-select">Projection run</label>
            <select
              id="run-select"
              className={styles.select}
              value={selectedRunId ?? ""}
              onChange={(e) => setSelectedRunId(e.target.value || null)}
            >
              <option value="">— All runs —</option>
              {runList.map((r) => (
                <option key={r.$primaryKey} value={r.$primaryKey}>
                  {r.runName ?? r.$primaryKey.slice(0, 16)} · {r.status}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedScenario && (
          <div className={styles.scenarioMeta}>
            <span className={`badge badge-info`}>
              {selectedScenario.status}
            </span>
            <span className={styles.metaText}>
              {selectedScenario.startQuarter ?? ""}
            </span>
          </div>
        )}
      </div>

      {actionError && (
        <div className={styles.actionError}>{actionError}</div>
      )}

      <div className={styles.content}>
        {/* Run list */}
        <div className={`card ${styles.runsPanel}`}>
          <div className="card-header">
            <h2 className="card-title">프로젝션 실행 내역</h2>
            <span className="badge badge-info">{runList.length} runs</span>
          </div>

          {!selectedScenarioId ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <p className="empty-state-title">Select a scenario</p>
              <p>Choose a scenario above to view its projection runs</p>
            </div>
          ) : runsLoading ? (
            <div className="empty-state">
              <p>Loading projections…</p>
            </div>
          ) : runList.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <p className="empty-state-title">No projections yet</p>
              <p>Click &ldquo;Run projection&rdquo; above to start a 10-year simulation</p>
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Final PIR</th>
                  <th>Growth/yr</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {runList.map((run) => (
                  <tr
                    key={run.$primaryKey}
                    className={
                      selectedRunId === run.$primaryKey ? styles.rowActive : ""
                    }
                    onClick={() =>
                      setSelectedRunId(
                        selectedRunId === run.$primaryKey
                          ? null
                          : run.$primaryKey,
                      )
                    }
                  >
                    <td className={styles.idCell}>
                      {run.runName ?? run.$primaryKey.slice(0, 12) + "…"}
                    </td>
                    <td>
                      <RunBadge status={run.status ?? "unknown"} />
                    </td>
                    <td className={styles.monoCell}>
                      {run.finalPir?.toFixed(2) ?? "—"}
                    </td>
                    <td className={styles.monoCell}>
                      {run.avgAnnualPriceGrowthPct != null
                        ? `${run.avgAnnualPriceGrowthPct.toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className={styles.dateCell}>
                      {run.createdAt?.slice(0, 10) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Chart / KPI area */}
        <div className={`card ${styles.chartPanel}`}>
          <div className="card-header">
            <h2 className="card-title">
              {selectedRun
                ? `시계열 차트 · ${selectedRun.runName ?? selectedRun.$primaryKey.slice(0, 12)}`
                : "시계열 차트"}
            </h2>
            {selectedRun && (
              <div style={{ display: "flex", gap: 6 }}>
                <span className="badge badge-info">40 quarters</span>
                <span className="badge badge-info">2026-Q2 → 2036-Q2</span>
              </div>
            )}
          </div>

          {!selectedRun ? (
            <div className="empty-state">
              <div className="empty-state-icon">📈</div>
              <p className="empty-state-title">
                {selectedScenarioId
                  ? "Select a run to view charts"
                  : "Select a scenario first"}
              </p>
              <p>10-year quarterly projections will appear here</p>
            </div>
          ) : (
            <>
              {/* KPI strip */}
              <div className={styles.kpiStrip}>
                {kpis!.map((k) => (
                  <KpiCard key={k.label} {...k} />
                ))}
              </div>

              {/* Scenario summary */}
              <div className={styles.summaryRow}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Scenario</span>
                  <span className={styles.summaryValue}>
                    {selectedScenario?.name ?? "—"}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Horizon</span>
                  <span className={styles.summaryValue}>
                    {selectedScenario?.startQuarter ?? "2026-Q2"} → +10 yr · 40
                    quarters
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Top-10% RE wealth</span>
                  <span className={styles.summaryValue}>
                    {selectedRun.finalReWealthTop10Share != null
                      ? `${(selectedRun.finalReWealthTop10Share * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Peak Tx/quarter</span>
                  <span className={styles.summaryValue}>
                    {selectedRun.peakQuarterlyTxCount?.toLocaleString() ?? "—"}
                  </span>
                </div>
              </div>

              {/* Status / error message */}
              {selectedRun.status === "failed" && selectedRun.errorMessage && (
                <div className={styles.runError}>
                  ⚠ {selectedRun.errorMessage}
                </div>
              )}

              {/* Chart placeholder grid (4 panels) */}
              <div className={styles.chartGrid}>
                {(
                  [
                    {
                      title: "Price-to-Income Ratio",
                      sub: "quarterly · Seoul aggregate",
                      kind: "dip",
                      cur: selectedRun.finalPir?.toFixed(2) ?? "—",
                      base: "9.84",
                      color: "var(--bronze-500)",
                    },
                    {
                      title: "Household Debt / GDP",
                      sub: "quarterly · national",
                      kind: "flat",
                      cur: selectedRun.finalDebtToGdp?.toFixed(2) ?? "—",
                      base: "0.99",
                      color: "var(--patina-700)",
                    },
                    {
                      title: "Price Growth YoY",
                      sub: "ExtraTrees predictor",
                      kind: "dip",
                      cur: selectedRun.avgAnnualPriceGrowthPct != null
                        ? `${selectedRun.avgAnnualPriceGrowthPct.toFixed(2)}%`
                        : "—",
                      base: "−1.09%",
                      color: "var(--bronze-700)",
                    },
                    {
                      title: "Transaction Volume",
                      sub: "RandomForest predictor",
                      kind: "saw",
                      cur: selectedRun.peakQuarterlyTxCount?.toLocaleString() ?? "—",
                      base: "14,800",
                      color: "var(--patina-500)",
                    },
                  ] as const
                ).map((c) => (
                  <div key={c.title} className={styles.chartCard}>
                    <div className={styles.chartCardHeader}>
                      <div>
                        <div className={styles.chartCardTitle}>{c.title}</div>
                        <div className={styles.chartCardSub}>{c.sub}</div>
                      </div>
                      <div className={styles.chartCardKpi}>
                        <span style={{ color: c.color }}>{c.cur}</span>
                        <span className={styles.chartCardBase}>
                          baseline {c.base}
                        </span>
                      </div>
                    </div>
                    <Sparkline
                      kind={c.kind}
                      color={c.color}
                      width={320}
                      height={80}
                    />
                    <div className={styles.chartXAxis}>
                      {["2026", "2028", "2030", "2032", "2034", "2036"].map(
                        (y) => (
                          <span key={y}>{y}</span>
                        ),
                      )}
                    </div>
                    <div className={styles.chartLegend}>
                      <span className={styles.legendDashed}>── baseline</span>
                      <span style={{ color: c.color }}>── scenario</span>
                      <span className={styles.legendBand}>░ ±1σ</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

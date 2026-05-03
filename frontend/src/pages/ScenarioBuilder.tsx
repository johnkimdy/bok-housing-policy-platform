import { useState, useRef } from "react";
import { useOsdkClient } from "@osdk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  policyScenario,
  createPolicyScenario,
} from "@bank-of-korea-housing-policy-dashboard/sdk";
import { useOsdkQuery } from "../hooks/useOsdkQuery";
import PageHeader from "../components/PageHeader";
import styles from "./ScenarioBuilder.module.css";

const STATUS_COLORS: Record<string, string> = {
  approved: "var(--patina-500)",
  projected: "var(--bronze-500)",
  pending:  "var(--stone-500)",
  draft:    "var(--stone-400)",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className={styles.statusDot}>
      <span
        className={styles.dotCircle}
        style={{ background: STATUS_COLORS[status] ?? "var(--gray-400)" }}
      />
      {status}
    </span>
  );
}

function LeverGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.leverGroup}>
      <div className={styles.leverGroupHeader}>
        <span className={styles.leverGroupLabel}>{title}</span>
        <div className={styles.leverGroupLine} />
      </div>
      {children}
    </div>
  );
}

function LeverFingerprint({
  scenario,
}: {
  scenario: { capitalGainsTaxDeltaPp?: number | null; additionalUnitsPerYear?: number | null; ltvCapDeltaPp?: number | null; dtiCapDeltaPp?: number | null };
}) {
  const groups = [
    {
      t: "TAX",
      active: scenario.capitalGainsTaxDeltaPp != null,
      color: "var(--status-warning)",
    },
    {
      t: "SUPPLY",
      active: scenario.additionalUnitsPerYear != null,
      color: "var(--status-success)",
    },
    {
      t: "CREDIT",
      active:
        scenario.ltvCapDeltaPp != null || scenario.dtiCapDeltaPp != null,
      color: "#7c4dff",
    },
    { t: "MONETARY", active: false, color: "var(--gray-500)" },
  ];
  return (
    <div className={styles.fingerprint}>
      <span className={styles.sectionCaption}>
        Lever fingerprint · selected scenario
      </span>
      <div className={styles.fingerprintGrid}>
        {groups.map((g) => (
          <div key={g.t}>
            <span
              className={styles.fingerprintLabel}
              style={{ color: g.color }}
            >
              {g.t}
            </span>
            <div className={styles.fingerprintBar}>
              <div
                className={styles.fingerprintFill}
                style={{
                  background: g.color,
                  opacity: g.active ? 0.75 : 0.2,
                  width: g.active ? "100%" : "100%",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface FormState {
  name: string;
  description: string;
  status: string;
  startQuarter: string;
  acquisitionTaxDeltaPp: string;
  capitalGainsTaxDeltaPp: string;
  propertyHoldingTaxDeltaPp: string;
  additionalUnitsPerYear: string;
  seoulFraction: string;
  ltvCapDeltaPp: string;
  dtiCapDeltaPp: string;
  autoRunProjection: boolean;
  autoGenerateBrief: boolean;
}

const DEFAULT_FORM: FormState = {
  name: "",
  description: "",
  status: "draft",
  startQuarter: "2026-Q2",
  acquisitionTaxDeltaPp: "",
  capitalGainsTaxDeltaPp: "",
  propertyHoldingTaxDeltaPp: "",
  additionalUnitsPerYear: "",
  seoulFraction: "",
  ltvCapDeltaPp: "",
  dtiCapDeltaPp: "",
  autoRunProjection: true,
  autoGenerateBrief: false,
};

export default function ScenarioBuilder() {
  const client = useOsdkClient();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const { data: scenarioList = [], isLoading } = useOsdkQuery({
    objectType: policyScenario,
    queryKey: ["scenarios"],
    orderBy: { createdAt: "desc" },
    pageSize: 50,
  });

  const selectedScenario = scenarioList.find(
    (s) => s.$primaryKey === selectedKey,
  );

  function set(field: keyof FormState) {
    return (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const value =
        e.target.type === "checkbox"
          ? (e.target as HTMLInputElement).checked
          : e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await client(createPolicyScenario).applyAction({
        name: form.name.trim(),
        description: form.description || undefined,
        status: form.status,
        start_quarter: form.startQuarter || undefined,
        capital_gains_tax_delta_pp: form.capitalGainsTaxDeltaPp
          ? parseFloat(form.capitalGainsTaxDeltaPp)
          : undefined,
        property_holding_tax_delta_pp: form.propertyHoldingTaxDeltaPp
          ? parseFloat(form.propertyHoldingTaxDeltaPp)
          : undefined,
        acquisition_tax_delta_pp: form.acquisitionTaxDeltaPp
          ? parseFloat(form.acquisitionTaxDeltaPp)
          : undefined,
        additional_units_per_year: form.additionalUnitsPerYear
          ? parseInt(form.additionalUnitsPerYear)
          : undefined,
        seoul_fraction: form.seoulFraction
          ? parseFloat(form.seoulFraction) / 100
          : undefined,
        ltv_cap_delta_pp: form.ltvCapDeltaPp
          ? parseFloat(form.ltvCapDeltaPp)
          : undefined,
        dti_cap_delta_pp: form.dtiCapDeltaPp
          ? parseFloat(form.dtiCapDeltaPp)
          : undefined,
        auto_run_projection: form.autoRunProjection,
        auto_generate_brief: form.autoGenerateBrief,
      });
      setForm(DEFAULT_FORM);
      queryClient.invalidateQueries({ queryKey: ["scenarios"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create scenario");
    } finally {
      setSubmitting(false);
    }
  }

  const activeLeversCount = [
    form.capitalGainsTaxDeltaPp,
    form.propertyHoldingTaxDeltaPp,
    form.acquisitionTaxDeltaPp,
    form.additionalUnitsPerYear,
    form.seoulFraction,
    form.ltvCapDeltaPp,
    form.dtiCapDeltaPp,
  ].filter(Boolean).length;

  return (
    <div className={styles.page}>
      <PageHeader
        icon="🏗️"
        title="Scenario Builder"
        titleKo="시나리오 빌더"
        description="Configure 18 levers across four policy instruments"
      />

      <div className={styles.content}>
        {/* Left: Create Scenario Form */}
        <div className={`card ${styles.formPanel}`} ref={formRef}>
          <div className={styles.formHeading}>
            <span className={styles.sectionCaption}>
              새 정책 시나리오 · New Scenario
            </span>
            <h2 className={styles.formTitle}>
              Configure levers across
              <br />
              four policy instruments.
            </h2>
          </div>

          <form onSubmit={handleSubmit}>
            <div className={styles.fieldStack}>
              <div className={styles.fieldItem}>
                <label className={styles.fieldLabel} htmlFor="scenario-name">Scenario name</label>
                <input
                  id="scenario-name"
                    className={styles.fieldInput}
                  value={form.name}
                  onChange={set("name")}
                  placeholder="e.g. PIR-7.5 Target · Conservative"
                  required
                />
              </div>
              <div className={styles.fieldItem}>
                <label className={styles.fieldLabel} htmlFor="scenario-description">Description</label>
                <textarea
                  id="scenario-description"
                  className={styles.fieldTextarea}
                  value={form.description}
                  onChange={set("description")}
                  placeholder="Describe the policy rationale..."
                  rows={2}
                      />
                    </div>
              <div className={styles.fieldRow2}>
                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel} htmlFor="scenario-status">Status</label>
                  <select
                    id="scenario-status"
                    className={styles.fieldSelect}
                    value={form.status}
                    onChange={set("status")}
                  >
                    <option value="draft">draft</option>
                    <option value="pending">pending</option>
                    <option value="approved">approved</option>
                  </select>
                    </div>
                  <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel} htmlFor="scenario-start-quarter">Start Quarter</label>
                      <input
                    id="scenario-start-quarter"
                        className={styles.fieldInput}
                    value={form.startQuarter}
                    onChange={set("startQuarter")}
                    placeholder="2026-Q2"
                      />
                    </div>
                  </div>
              <LeverGroup title="Tax levers">
                <div className={styles.fieldRow3}>
                  <div className={styles.fieldItem}>
                    <label className={styles.fieldLabel} htmlFor="acquisition-tax">Acquisition tax Δ</label>
                    <div className={styles.fieldInputUnit}>
                      <input
                        id="acquisition-tax"
                        className={styles.fieldInput}
                        type="number"
                        step="0.1"
                        value={form.acquisitionTaxDeltaPp}
                        onChange={set("acquisitionTaxDeltaPp")}
                        placeholder="+2.8"
                      />
                      <span className={styles.unit}>pp</span>
                    </div>
                  </div>
                  <div className={styles.fieldItem}>
                    <label className={styles.fieldLabel} htmlFor="cgt-delta">CGT Δ</label>
                    <div className={styles.fieldInputUnit}>
                      <input
                        id="cgt-delta"
                        className={styles.fieldInput}
                        type="number"
                        step="0.1"
                        value={form.capitalGainsTaxDeltaPp}
                        onChange={set("capitalGainsTaxDeltaPp")}
                        placeholder="0.0"
                      />
                      <span className={styles.unit}>pp</span>
                    </div>
                  </div>
                  <div className={styles.fieldItem}>
                    <label className={styles.fieldLabel} htmlFor="property-tax">Property tax Δ</label>
                    <div className={styles.fieldInputUnit}>
                      <input
                        id="property-tax"
                        className={styles.fieldInput}
                        type="number"
                        step="0.1"
                        value={form.propertyHoldingTaxDeltaPp}
                        onChange={set("propertyHoldingTaxDeltaPp")}
                        placeholder="+0.2"
                      />
                      <span className={styles.unit}>pp</span>
                    </div>
                  </div>
                </div>
              </LeverGroup>

              <LeverGroup title="Supply levers">
                <div className={styles.fieldRow2}>
                  <div className={styles.fieldItem}>
                    <label className={styles.fieldLabel} htmlFor="annual-target">Annual target</label>
                    <div className={styles.fieldInputUnit}>
                      <input
                        id="annual-target"
                        className={styles.fieldInput}
                        type="number"
                        step="100"
                        value={form.additionalUnitsPerYear}
                        onChange={set("additionalUnitsPerYear")}
                        placeholder="15,987"
                      />
                      <span className={styles.unit}>units</span>
                  </div>
            </div>
                  <div className={styles.fieldItem}>
                    <label className={styles.fieldLabel} htmlFor="seoul-fraction">Seoul fraction</label>
                    <div className={styles.fieldInputUnit}>
                      <input
                        id="seoul-fraction"
                        className={styles.fieldInput}
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        value={form.seoulFraction}
                        onChange={set("seoulFraction")}
                        placeholder="40"
                      />
                      <span className={styles.unit}>%</span>
                </div>
          </div>
            </div>
              </LeverGroup>

              <LeverGroup title="Credit levers">
                <div className={styles.fieldRow2}>
                  <div className={styles.fieldItem}>
                    <label className={styles.fieldLabel} htmlFor="ltv-cap">LTV cap Δ</label>
                    <div className={styles.fieldInputUnit}>
                      <input
                        id="ltv-cap"
                        className={styles.fieldInput}
                        type="number"
                        step="0.1"
                        value={form.ltvCapDeltaPp}
                        onChange={set("ltvCapDeltaPp")}
                        placeholder="−10.9"
                      />
                      <span className={styles.unit}>pp</span>
                    </div>
                  </div>
                  <div className={styles.fieldItem}>
                    <label className={styles.fieldLabel} htmlFor="dti-cap">DTI cap Δ</label>
                    <div className={styles.fieldInputUnit}>
                      <input
                        id="dti-cap"
                        className={styles.fieldInput}
                        type="number"
                        step="0.1"
                        value={form.dtiCapDeltaPp}
                        onChange={set("dtiCapDeltaPp")}
                        placeholder="−2.3"
                      />
                      <span className={styles.unit}>pp</span>
                    </div>
                  </div>
                </div>
              </LeverGroup>
            </div>

            <div className={styles.checkboxRow}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.autoRunProjection}
                  onChange={set("autoRunProjection")}
                  className={styles.checkbox}
                />
                Auto-run projection
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.autoGenerateBrief}
                  onChange={set("autoGenerateBrief")}
                  className={styles.checkbox}
                />
                Auto-generate brief
              </label>
            </div>

            {error && <div className={styles.errorMsg}>{error}</div>}

            <div className={styles.buttonRow}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !form.name.trim()}
              >
                {submitting ? "Creating…" : "Create scenario"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setForm(DEFAULT_FORM)}
              >
                Reset
              </button>
            </div>

            {activeLeversCount > 0 && (
              <div className={styles.leverCountHint}>
                {activeLeversCount} of 7 levers configured
              </div>
            )}
          </form>
        </div>

        {/* Right: Scenarios Table */}
        <div className={`card ${styles.tablePanel}`}>
          <div className="card-header">
            <h2 className="card-title">시나리오 목록 · Existing Scenarios</h2>
            <span className="badge badge-info">{scenarioList.length} total</span>
          </div>

          {isLoading ? (
            <div className="empty-state">
              <p>Loading scenarios…</p>
            </div>
          ) : scenarioList.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <p className="empty-state-title">No scenarios yet</p>
              <p>Create your first policy scenario to get started</p>
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Levers</th>
                  <th>CGT Δ</th>
                  <th>Supply</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {scenarioList.map((scenario) => {
                  const leversSet = [
                    scenario.capitalGainsTaxDeltaPp,
                    scenario.propertyHoldingTaxDeltaPp,
                    scenario.acquisitionTaxDeltaPp,
                    scenario.additionalUnitsPerYear,
                    scenario.seoulFraction,
                    scenario.ltvCapDeltaPp,
                    scenario.dtiCapDeltaPp,
                  ].filter((v) => v != null).length;
                  const isSelected = selectedKey === scenario.$primaryKey;
                  return (
                    <tr
                      key={scenario.$primaryKey}
                      className={isSelected ? styles.rowActive : ""}
                      onClick={() =>
                        setSelectedKey(
                          isSelected ? null : scenario.$primaryKey,
                        )
                      }
                    >
                      <td className={styles.nameCell}>
                        {scenario.name ?? "—"}
                      </td>
                      <td>
                        <StatusDot status={scenario.status ?? "draft"} />
                      </td>
                      <td className={styles.monoCell}>{leversSet}/7</td>
                      <td className={styles.monoCell}>
                        {scenario.capitalGainsTaxDeltaPp != null
                          ? `${scenario.capitalGainsTaxDeltaPp > 0 ? "+" : ""}${scenario.capitalGainsTaxDeltaPp}pp`
                          : "—"}
                      </td>
                      <td className={styles.monoCell}>
                        {scenario.additionalUnitsPerYear != null
                          ? scenario.additionalUnitsPerYear.toLocaleString()
                          : "—"}
                      </td>
                      <td className={styles.dateCell}>
                        {scenario.createdAt
                          ? scenario.createdAt.slice(0, 10)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Lever fingerprint for selected scenario */}
          {selectedScenario && (
            <LeverFingerprint scenario={selectedScenario} />
          )}
        </div>
      </div>
    </div>
  );
}


import { useState, useRef, useEffect, useCallback } from "react";
import { useOsdkClient } from "@osdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { Sessions } from "@osdk/foundry.aipagents";
import { PalantirApiError } from "@osdk/client";
import {
  SolverRun,
  policyScenario,
  projectionRun,
  policyBrief,
  runPolicySolver,
  deleteSolverRun,
  triggerScenarioProjection,
  generatePolicyBrief,
} from "@bank-of-korea-housing-policy-dashboard/sdk";
import { useOsdkQuery } from "../hooks/useOsdkQuery";
import PageHeader from "../components/PageHeader";
import MarkdownRenderer from "../components/MarkdownRenderer";
import styles from "./AiAdvisor.module.css";

/* ─────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────── */
const AGENT_RID = "ri.aip-agents..agent.c5be8541-59ca-4e64-9b15-bc8655940260";

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
export interface ChatMsg {
  role: "user" | "bot";
  text: string;
  streaming?: boolean;
}

interface StoredSession {
  rid: string;
  title: string;
  createdAt: string;
  messages: ChatMsg[];
}

interface Candidate {
  rank: number;
  route: string;
  finalPir: number;
  growthPct: number;
  debtGdp: number;
  leverMix: [number, number, number, number];
  params: Record<string, string>;
  commentary?: string;
}

/* ─────────────────────────────────────────────────────────────
   Module-level session store — survives React unmount/remount
   so navigating away and back keeps all conversations intact.
───────────────────────────────────────────────────────────── */
const _store: { sessions: StoredSession[]; activeRid: string | null } = {
  sessions: [],
  activeRid: null,
};

/* ─────────────────────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────────────────────── */
function LeverMix({ mix }: { mix: [number, number, number, number] }) {
  const labels = ["credit", "tax", "supply", "mon."];
  const colors = ["var(--bok-primary)", "var(--bronze-500)", "var(--patina-500)", "var(--stone-500)"];
  return (
    <div className={styles.leverMixWrap}>
      <div className={styles.leverMixBar}>
        {mix.map((pct, i) =>
          pct > 0 ? <div key={i} style={{ width: `${pct}%`, background: colors[i] }} title={`${labels[i]}: ${pct}%`} /> : null,
        )}
      </div>
      <div className={styles.leverMixLabels}>
        {labels.map((l, i) => <span key={l} style={{ color: colors[i] }}>{l}</span>)}
      </div>
    </div>
  );
}

function parseCandidates(run: { resultsJson?: string | null }): Candidate[] {
  if (!run.resultsJson) return [];
  try {
    const parsed = JSON.parse(run.resultsJson);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, 5).map((c: Record<string, unknown>, i: number) => ({
        rank: i + 1,
        route: (c.route as string) ?? `Candidate ${i + 1}`,
        finalPir: (c.final_pir as number) ?? 0,
        growthPct: (c.avg_growth_pct as number) ?? 0,
        debtGdp: (c.final_debt_gdp as number) ?? 0,
        leverMix: (c.lever_mix as [number, number, number, number]) ?? [25, 25, 25, 25],
        params: (c.params as Record<string, string>) ?? {},
        commentary: c.commentary as string | undefined,
      }));
    }
  } catch { /* fall through */ }
  return [];
}

function CandidateRow({ candidate, expanded, onToggle }: { candidate: Candidate; expanded: boolean; onToggle: () => void }) {
  const pirColor = candidate.finalPir < 8.5 ? "var(--patina-700)" : candidate.finalPir < 9.5 ? "var(--bronze-500)" : "var(--danger)";
  return (
    <div className={`${styles.candidateCard} ${expanded ? styles.candidateExpanded : ""}`}>
      <div className={styles.candidateRow} role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle()}>
        <div className={styles.candidateRank} style={{ color: expanded ? "var(--bronze-500)" : "var(--stone-500)" }}>{candidate.rank}</div>
        <div className={styles.candidateName}>
          <span className={styles.candidateRoute}>{candidate.route}</span>
          <span className={styles.candidateHint}>{expanded ? "Collapse" : "Click to expand"}</span>
        </div>
        <LeverMix mix={candidate.leverMix} />
        <div className={styles.candidateKpi}><span className={styles.kpiCaption}>FINAL PIR</span><span className={styles.kpiNum} style={{ color: pirColor }}>{candidate.finalPir.toFixed(2)}</span></div>
        <div className={styles.candidateKpi}><span className={styles.kpiCaption}>GROWTH/YR</span><span className={styles.kpiNum} style={{ color: "var(--bronze-700)" }}>{candidate.growthPct.toFixed(2)}%</span></div>
        <div className={styles.candidateKpi}><span className={styles.kpiCaption}>DEBT/GDP</span><span className={styles.kpiNum}>{candidate.debtGdp.toFixed(2)}</span></div>
      </div>
      {expanded && (
        <div className={styles.candidateDetail}>
          {Object.keys(candidate.params).length > 0 && (
            <div className={styles.detailBox}>
              <span className={styles.detailCaption}>Lever settings</span>
              <div className={styles.paramGrid}>
                {Object.entries(candidate.params).map(([k, v]) => (
                  <div key={k} className={styles.paramRow}><span className={styles.paramKey}>{k}</span><span className={styles.paramVal}>{v}</span></div>
                ))}
              </div>
            </div>
          )}
          {candidate.commentary && (
            <div className={styles.detailBox}>
              <span className={styles.detailCaption}>AI commentary</span>
              <p className={styles.detailText}>{candidate.commentary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────── */
export default function AiAdvisor() {
  const client = useOsdkClient();
  const queryClient = useQueryClient();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Session sidebar (re-hydrated from module store on mount) ─────
  const [sessions, setSessions] = useState<StoredSession[]>(() => [..._store.sessions]);
  const [activeRid, setActiveRidState] = useState<string | null>(() => _store.activeRid);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Chat messages for the active session ─────────────────────────
  const [chatMessages, setChatMessagesRaw] = useState<ChatMsg[]>(
    () => _store.sessions.find(s => s.rid === _store.activeRid)?.messages ?? []
  );
  const [chatInput, setChatInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // ── Solver ───────────────────────────────────────────────────────
  const [targetPir, setTargetPir] = useState("9.0");
  const [targetDebtGdp, setTargetDebtGdp] = useState("1.0");
  const [targetGrowth, setTargetGrowth] = useState("5.0");
  const [targetWealth, setTargetWealth] = useState("0.50");
  const [targetCumulative, setTargetCumulative] = useState("40.0");
  const [runLabel, setRunLabel] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // ── Selection ────────────────────────────────────────────────────
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedCandidate, setExpandedCandidate] = useState<number | null>(null);

  // ── Quick actions ────────────────────────────────────────────────
  const [qaScenarioId, setQaScenarioId] = useState("");
  const [qaRunId, setQaRunId] = useState("");
  const [qaBriefTitle, setQaBriefTitle] = useState("");
  const [qaLoading, setQaLoading] = useState<string | null>(null);

  // ── OSDK queries ─────────────────────────────────────────────────
  const { data: solverRuns = [], isLoading: solverLoading } = useOsdkQuery({ objectType: SolverRun, queryKey: ["solver-runs"], orderBy: { createdAt: "desc" }, pageSize: 20 });
  const { data: scenarios = [] } = useOsdkQuery({ objectType: policyScenario, queryKey: ["scenarios"], orderBy: { createdAt: "desc" }, pageSize: 50 });
  const { data: projections = [] } = useOsdkQuery({ objectType: projectionRun, queryKey: ["projections", "all"], orderBy: { createdAt: "desc" }, pageSize: 30 });
  const { data: briefs = [] } = useOsdkQuery({ objectType: policyBrief, queryKey: ["briefs"], orderBy: { createdAt: "desc" }, pageSize: 20 });

  const selectedRun = solverRuns.find((r) => r.$primaryKey === selectedRunId);
  const candidates = selectedRun ? parseCandidates(selectedRun) : [];
  const approvedScenarios = scenarios.filter((s) => s.status === "approved");
  const completedRuns = projections.filter((r) => r.status === "completed");

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isStreaming]);

  // ── Store-aware setChatMessages ───────────────────────────────────
  const setChatMessages = useCallback((updater: ChatMsg[] | ((prev: ChatMsg[]) => ChatMsg[])) => {
    setChatMessagesRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Persist to module store so it survives unmount
      const stored = _store.sessions.find(s => s.rid === _store.activeRid);
      if (stored) stored.messages = next;
      return next;
    });
  }, []);

  const refreshSidebar = useCallback(() => setSessions([..._store.sessions]), []);

  // ── Switch to an existing session ────────────────────────────────
  const switchSession = useCallback((rid: string) => {
    _store.activeRid = rid;
    setActiveRidState(rid);
    setSessionError(null);
    const stored = _store.sessions.find(s => s.rid === rid);
    setChatMessagesRaw(stored?.messages ?? []);
  }, []);

  // ── Create a new session ─────────────────────────────────────────
  const createSession = useCallback(async () => {
    setSessionLoading(true);
    setSessionError(null);
    try {
      const session = await Sessions.create(client, AGENT_RID, {}, { preview: true });
      const welcome: ChatMsg = {
        role: "bot",
        text: "안녕하세요! I'm your **BOK Housing Policy AI Advisor** — powered by the AIP Agent Studio agent connected to your full ontology (scenarios, projections, solver runs, policy briefs).\n\nAsk me about policy tradeoffs, candidate rankings, PIR trajectories, or request to trigger a projection or generate a brief.",
      };
      const stored: StoredSession = {
        rid: session.rid,
        title: "New conversation",
        createdAt: new Date().toISOString(),
        messages: [welcome],
      };
      _store.sessions.unshift(stored);
      _store.activeRid = session.rid;
      setActiveRidState(session.rid);
      setChatMessagesRaw([welcome]);
      refreshSidebar();
    } catch (err) {
      if (err instanceof PalantirApiError) {
        if (err.errorName === "AgentNotFound" || err.statusCode === 404) {
          setSessionError(
            `AgentNotFound (404) — Two steps needed:\n` +
            `1. Enable api:aip-agents-write scope in Developer Console → Platform SDK tab.\n` +
            `2. Add the project containing the agent under "Project access".\n` +
            `3. Clear localStorage and re-login.`
          );
        } else {
          setSessionError(`Agent error (${err.errorName}): ${err.message}`);
        }
      } else {
        setSessionError(err instanceof Error ? err.message : "Failed to create agent session");
      }
    } finally {
      setSessionLoading(false);
    }
  }, [client, refreshSidebar]);

  // Auto-create a session on first load only
  useEffect(() => {
    if (_store.sessions.length === 0) createSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Send message with streaming ──────────────────────────────────
  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || isStreaming || !activeRid) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setIsStreaming(true);

    const contextPrefix = buildContextPrefix();
    const fullMessage = contextPrefix ? `[Context: ${contextPrefix}]\n\n${userMsg}` : userMsg;

    // Placeholder streaming bubble
    setChatMessages(prev => [...prev, { role: "bot", text: "", streaming: true }]);

    try {
      const response = await Sessions.streamingContinue(
        client,
        AGENT_RID,
        activeRid as never,
        { userInput: { text: fullMessage }, parameterInputs: {} },
        { preview: true },
      );

      if (!response.body) throw new Error("No response body from agent");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last (possibly incomplete) line in buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            // Palantir streaming format: { type: "delta", delta: "..." }
            // or fall back to other common shapes
            const delta: string | null =
              parsed?.delta ??
              parsed?.text ??
              parsed?.content ??
              parsed?.choices?.[0]?.delta?.content ??
              null;
            if (delta) {
              accumulated += delta;
              setChatMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.streaming) updated[updated.length - 1] = { ...last, text: accumulated };
                return updated;
              });
            }
          } catch {
            // Plain-text chunk (non-JSON SSE)
            accumulated += data;
            setChatMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.streaming) updated[updated.length - 1] = { ...last, text: accumulated };
              return updated;
            });
          }
        }
      }

      // Finalise — remove streaming flag
      setChatMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.streaming) updated[updated.length - 1] = { role: "bot", text: accumulated || "_(no response)_" };
        return updated;
      });

      // Auto-title the session after first real exchange
      const stored = _store.sessions.find(s => s.rid === activeRid);
      if (stored && stored.title === "New conversation") {
        stored.title = userMsg.slice(0, 52) + (userMsg.length > 52 ? "…" : "");
        refreshSidebar();
      }
    } catch (err) {
      const errMsg = err instanceof PalantirApiError
        ? `Agent error (${err.errorName}): ${err.message}`
        : err instanceof Error ? err.message : "Unknown error";
      setChatMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.streaming) updated[updated.length - 1] = { role: "bot", text: `⚠ ${errMsg}` };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  function buildContextPrefix(): string {
    const parts: string[] = [];
    if (scenarios.length > 0) parts.push(`${scenarios.length} scenarios (${scenarios.filter(s => s.status === "approved").length} approved)`);
    if (projections.length > 0) parts.push(`${projections.length} projection runs (${completedRuns.length} completed)`);
    if (briefs.length > 0) parts.push(`${briefs.length} policy briefs`);
    if (solverRuns.length > 0) {
      const totalFeasible = solverRuns.reduce((s, r) => s + (r.feasibleCount ?? 0), 0);
      parts.push(`${solverRuns.length} solver runs (${totalFeasible.toLocaleString()} total feasible candidates)`);
    }
    if (selectedRun) parts.push(`active solver run: "${selectedRun.runLabel ?? selectedRun.$primaryKey.slice(0, 10)}" — ${selectedRun.feasibleCount ?? 0} feasible, PIR target ≤ ${selectedRun.targetMaxPir ?? "—"}`);
    return parts.join("; ");
  }

  // ── Solver actions ───────────────────────────────────────────────
  async function handleRunSolver(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setRunError(null);
    try {
      await client(runPolicySolver).applyAction({
        target_max_pir: parseFloat(targetPir) || undefined,
        target_max_debt_gdp: parseFloat(targetDebtGdp) || undefined,
        target_max_growth: parseFloat(targetGrowth) || undefined,
        target_max_wealth: parseFloat(targetWealth) || undefined,
        target_max_cumulative: parseFloat(targetCumulative) || undefined,
        start_quarter: "2026-Q2",
      });
      await queryClient.invalidateQueries({ queryKey: ["solver-runs"] });
      if (activeRid) {
        setChatMessages(prev => [...prev, {
          role: "bot",
          text: `**Solver run triggered** with targets: Final PIR ≤ ${targetPir}, Debt/GDP ≤ ${targetDebtGdp}, Growth ≤ ${targetGrowth}%/yr.\n\nSelect the new run from the list to inspect candidates.`,
        }]);
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Solver failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleDeleteRun(run: typeof solverRuns[0]) {
    if (!confirm(`Delete solver run "${run.runLabel ?? run.$primaryKey}"?`)) return;
    try {
      await client(deleteSolverRun).applyAction({ solver_run: run });
      if (selectedRunId === run.$primaryKey) setSelectedRunId(null);
      await queryClient.invalidateQueries({ queryKey: ["solver-runs"] });
    } catch { /* silent */ }
  }

  // ── Quick actions ────────────────────────────────────────────────
  async function handleTriggerProjection() {
    const scenario = scenarios.find((s) => s.$primaryKey === qaScenarioId);
    if (!scenario) return;
    setQaLoading("projection");
    try {
      await client(triggerScenarioProjection).applyAction({ scenario_id: scenario });
      await queryClient.invalidateQueries({ queryKey: ["projections", "all"] });
      setChatMessages(prev => [...prev, {
        role: "bot",
        text: `**Projection triggered** for *${scenario.name ?? qaScenarioId}*. The 10-year stock-flow simulation is now running.`,
      }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "bot", text: `Failed to trigger projection: ${err instanceof Error ? err.message : "unknown error"}` }]);
    } finally {
      setQaLoading(null);
    }
  }

  async function handleGenerateBrief() {
    const run = projections.find((r) => r.$primaryKey === qaRunId);
    if (!run) return;
    const title = qaBriefTitle || `Policy Brief · ${run.runName ?? run.$primaryKey.slice(0, 12)} · ${new Date().toISOString().slice(0, 10)}`;
    setQaLoading("brief");
    try {
      await client(generatePolicyBrief).applyAction({ run_id: run, title });
      await queryClient.invalidateQueries({ queryKey: ["briefs"] });
      setChatMessages(prev => [...prev, {
        role: "bot",
        text: `**Policy brief generation invoked** — writing *"${title}"*. Find it in the Policy Briefs page once complete.`,
      }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "bot", text: `Failed to generate brief: ${err instanceof Error ? err.message : "unknown error"}` }]);
    } finally {
      setQaLoading(null);
      setQaBriefTitle("");
    }
  }

  // ── Filtered sidebar sessions ────────────────────────────────────
  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.messages.some(m => m.text.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  /* ─────────────────────────────────────────────────────────
     Render
  ───────────────────────────────────────────────────────── */
  return (
    <div className={styles.page}>
      <PageHeader
        icon="🤖"
        title="AI Advisor"
        titleKo="AI 어드바이저"
        description="AIP Agent Studio · Connected to full BOK Housing Policy ontology"
      />

      <div className={styles.content}>
        {/* ── Left: Solver + Quick Actions ── */}
        <div className={styles.solverColumn}>
          <div className="card">
            <div className={styles.cardHeading}>
              <span className={styles.caption}>Constraint solver</span>
              <h2 className={styles.cardTitle}>Set targets.<br />Find minimal interventions.</h2>
            </div>
            <form onSubmit={handleRunSolver}>
              <div className={styles.constraintList}>
                {[
                  { label: "Final PIR", sub: "from 9.84 baseline", value: targetPir, set: setTargetPir, op: "≤" },
                  { label: "Avg annual growth", value: targetGrowth, set: setTargetGrowth, op: "≤", unit: "%" },
                  { label: "Cumulative change", value: targetCumulative, set: setTargetCumulative, op: "≤", unit: "%" },
                  { label: "HH Debt / GDP", value: targetDebtGdp, set: setTargetDebtGdp, op: "≤" },
                  { label: "RE wealth top-10%", value: targetWealth, set: setTargetWealth, op: "≤" },
                ].map((c) => (
                  <div key={c.label} className={styles.constraintRow}>
                    <div className={styles.constraintLabel}>
                      <span>{c.label}</span>
                      {c.sub && <span className={styles.constraintSub}>{c.sub}</span>}
                    </div>
                    <div className={styles.constraintOp}>{c.op}</div>
                    <div className={styles.constraintInput}>
                      <input type="number" step="0.1" className={styles.numInput} value={c.value} onChange={(e) => c.set(e.target.value)} />
                      {c.unit && <span className={styles.unit}>{c.unit}</span>}
                    </div>
                    <span className={styles.constraintTag}>user</span>
                  </div>
                ))}
              </div>
              <div className={styles.formGroup}>
                <label className={styles.fieldLabel} htmlFor="run-label-input">Run label</label>
                <input id="run-label-input" className={styles.textInput} value={runLabel} onChange={(e) => setRunLabel(e.target.value)} placeholder="e.g. conservative targets" />
              </div>
              {runError && <div className={styles.runError}>{runError}</div>}
              <div className={styles.solverBtns}>
                <button type="submit" className="btn btn-primary" disabled={running}>{running ? "Running…" : "▶ Run solver"}</button>
                <button type="button" className="btn btn-secondary" onClick={() => { setTargetPir("9.0"); setTargetDebtGdp("1.0"); setTargetGrowth("5.0"); setTargetWealth("0.50"); setTargetCumulative("40.0"); setRunLabel(""); }}>Reset</button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card-header"><h2 className="card-title">Quick Actions</h2></div>
            <div className={styles.quickActions}>
              <div className={styles.qaBlock}>
                <span className={styles.qaLabel}>▶ Trigger projection</span>
                <select className={styles.qaSelect} value={qaScenarioId} onChange={(e) => setQaScenarioId(e.target.value)}>
                  <option value="">— select scenario —</option>
                  {approvedScenarios.map((s) => (
                    <option key={s.$primaryKey} value={s.$primaryKey}>{s.name ?? s.$primaryKey.slice(0, 20)}</option>
                  ))}
                </select>
                <button className="btn btn-secondary" disabled={!qaScenarioId || qaLoading === "projection"} onClick={handleTriggerProjection}>
                  {qaLoading === "projection" ? "Running…" : "Run"}
                </button>
              </div>
              <div className={styles.qaBlock}>
                <span className={styles.qaLabel}>✦ Generate policy brief</span>
                <select className={styles.qaSelect} value={qaRunId} onChange={(e) => setQaRunId(e.target.value)}>
                  <option value="">— select completed run —</option>
                  {completedRuns.map((r) => (
                    <option key={r.$primaryKey} value={r.$primaryKey}>{r.runName ?? r.$primaryKey.slice(0, 20)}</option>
                  ))}
                </select>
                <input className={styles.qaInput} value={qaBriefTitle} onChange={(e) => setQaBriefTitle(e.target.value)} placeholder="Brief title (optional)" />
                <button className="btn btn-primary" disabled={!qaRunId || qaLoading === "brief"} onClick={handleGenerateBrief}>
                  {qaLoading === "brief" ? "Generating…" : "Generate"}
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Solver runs</h2>
              <span className="badge badge-info">{solverRuns.length}</span>
            </div>
            {solverLoading ? (
              <div className="empty-state"><p>Loading…</p></div>
            ) : solverRuns.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🔬</div>
                <p className="empty-state-title">No solver runs yet</p>
                <p>Configure targets above and run the solver</p>
              </div>
            ) : (
              <div className={styles.runList}>
                {solverRuns.map((run) => {
                  const isSelected = selectedRunId === run.$primaryKey;
                  return (
                    <div key={run.$primaryKey} className={`${styles.runCard} ${isSelected ? styles.runCardActive : ""}`}
                      role="button" tabIndex={0}
                      onClick={() => { setSelectedRunId(isSelected ? null : run.$primaryKey); setExpandedCandidate(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setSelectedRunId(isSelected ? null : run.$primaryKey); setExpandedCandidate(null); } }}>
                      <div className={styles.runCardTop}>
                        <span className={styles.runLabel}>{run.runLabel ?? run.$primaryKey.slice(0, 16) + "…"}</span>
                        <span className="badge badge-success">{run.feasibleCount ?? 0} feasible</span>
                        <button className={styles.deleteBtn} onClick={(e) => { e.stopPropagation(); handleDeleteRun(run); }} title="Delete">✕</button>
                      </div>
                      <div className={styles.runCardMeta}>
                        <span>PIR ≤ {run.targetMaxPir ?? "—"} · Debt/GDP ≤ {run.targetMaxDebtGdp ?? "—"}</span>
                        <span>{run.createdAt?.slice(0, 10) ?? ""}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Candidates + AIP Agent Chat ── */}
        <div className={styles.rightColumn}>
          {/* Candidates */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">{selectedRun ? `Top candidates · ${selectedRun.runLabel ?? selectedRun.$primaryKey.slice(0, 12)}` : "Top 5 feasible candidates"}</h2>
              {selectedRun && (
                <div style={{ display: "flex", gap: 6 }}>
                  <span className="badge badge-success">{selectedRun.feasibleCount ?? 0} feasible</span>
                  <span className="badge badge-info">{selectedRun.totalEvaluations?.toLocaleString() ?? "—"} evaluated</span>
                </div>
              )}
            </div>
            {!selectedRun ? (
              <div className="empty-state">
                <div className="empty-state-icon">🔍</div>
                <p className="empty-state-title">{solverRuns.length > 0 ? "Select a run from the list" : "Run the solver to see candidates"}</p>
                <p>Top 5 parameter sets ranked by minimal intervention</p>
              </div>
            ) : candidates.length > 0 ? (
              <div className={styles.candidateList}>
                {candidates.map((c) => (
                  <CandidateRow key={c.rank} candidate={c} expanded={expandedCandidate === c.rank}
                    onToggle={() => setExpandedCandidate(expandedCandidate === c.rank ? null : c.rank)} />
                ))}
                <div className={styles.candidatesNote}>ranked by minimum intervention · click to expand</div>
              </div>
            ) : (
              <div className={styles.candidatesSummaryText}>
                <span className={styles.caption}>Candidates summary</span>
                <pre className={styles.summaryPre}>{selectedRun.candidatesSummary ?? "No structured candidate data."}</pre>
              </div>
            )}
          </div>

          {/* ── AIP Agent Chat panel ── */}
          <div className={`card ${styles.chatPanel}`}>

            {/* Sidebar */}
            <div className={styles.chatSidebar}>
              <div className={styles.sidebarHeader}>
                <span className={styles.sidebarTitle}>Conversations</span>
                <button className={styles.newConvoBtn} onClick={createSession} disabled={sessionLoading} title="New conversation">
                  {sessionLoading ? "…" : "+ New"}
                </button>
              </div>
              <div className={styles.sidebarSearch}>
                <input
                  className={styles.searchInput}
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className={styles.sessionList}>
                {filteredSessions.length === 0 && (
                  <div className={styles.sessionEmpty}>
                    {searchQuery ? "No results" : "No conversations yet"}
                  </div>
                )}
                {filteredSessions.map((s) => (
                  <div
                    key={s.rid}
                    className={`${styles.sessionItem} ${s.rid === activeRid ? styles.sessionItemActive : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => switchSession(s.rid)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && switchSession(s.rid)}
                  >
                    <span className={styles.sessionItemTitle}>{s.title}</span>
                    <span className={styles.sessionItemMeta}>
                      {s.messages.filter(m => m.role === "user").length} msg · {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chat main */}
            <div className={styles.chatMain}>
              <div className={styles.chatMainHeader}>
                <div>
                  <h2 className="card-title">AI 정책 어드바이저</h2>
                  <span className={styles.agentTag}>✦ AIP Agent Studio</span>
                </div>
                <div className={styles.sessionStatus}>
                  {sessionLoading && <span className={styles.sessionPending}>Connecting…</span>}
                  {activeRid && !sessionLoading && !sessionError && <span className={styles.sessionActive}>● Live</span>}
                  {sessionError && (
                    <button className="btn btn-secondary" onClick={createSession} style={{ fontSize: 10 }}>Reconnect</button>
                  )}
                  <span className={styles.chatContext}>
                    {scenarios.length}s · {projections.length}r · {briefs.length}b · {solverRuns.length}sol
                  </span>
                </div>
              </div>

              {sessionError && (
                <div className={styles.sessionErrorBanner}>⚠ {sessionError}</div>
              )}

              <div className={styles.chatMessages}>
                {chatMessages.map((msg, i) => (
                  <div key={i} className={msg.role === "bot" ? styles.chatBubbleBot : styles.chatBubbleUser}>
                    {msg.role === "bot" && <span className={styles.chatAvatar}>✦</span>}
                    <div className={styles.chatText}>
                      {msg.role === "bot"
                        ? <><MarkdownRenderer text={msg.text || "…"} />{msg.streaming && <span className={styles.cursor}>▌</span>}</>
                        : msg.text}
                    </div>
                    {msg.role === "user" && <span className={styles.chatUserAvatar}>P</span>}
                  </div>
                ))}
                {isStreaming && chatMessages[chatMessages.length - 1]?.role !== "bot" && (
                  <div className={styles.chatBubbleBot}>
                    <span className={styles.chatAvatar}>✦</span>
                    <div className={styles.chatText}><span className={styles.chatThinking}>…</span></div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form className={styles.chatInputRow} onSubmit={handleSendChat}>
                <input
                  className={styles.chatInputField}
                  placeholder={activeRid ? "Ask about tradeoffs, scenarios, projections, or solver candidates…" : "Connecting to agent…"}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isStreaming || !activeRid}
                />
                <button type="submit" className="btn btn-primary" disabled={!chatInput.trim() || isStreaming || !activeRid}>
                  ↵ Send
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

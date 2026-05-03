import { useState } from "react";
import { useOsdkClient } from "@osdk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  policyBrief,
  deletePolicyBrief,
} from "@bank-of-korea-housing-policy-dashboard/sdk";
import { useOsdkQuery } from "../hooks/useOsdkQuery";
import PageHeader from "../components/PageHeader";
import MarkdownRenderer from "../components/MarkdownRenderer";
import styles from "./PolicyBriefs.module.css";

/* ── Table of contents extracted from markdown headings ── */
function TableOfContents({ text }: { text: string }) {
  // Match ## headings (h2-level = section titles in our renderer)
  const headings = Array.from(
    text.matchAll(/^#{1,3}\s+(.+)/gm),
  ).map((m) => m[1].replace(/\*\*/g, "").trim()).slice(0, 10);

  if (headings.length === 0) return null;

  return (
    <div className={styles.toc}>
      <span className={styles.tocCaption}>Contents</span>
      <div className={styles.tocList}>
        {headings.map((h, i) => (
          <div key={i} className={styles.tocItem}>{h}</div>
        ))}
      </div>
    </div>
  );
}

/* ── Brief list item ── */
function BriefListItem({
  title,
  runId,
  createdAt,
  analystName,
  selected,
  onClick,
}: {
  title: string;
  runId: string;
  createdAt?: string | null;
  analystName?: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  const isAi =
    !analystName ||
    analystName.toLowerCase().includes("claude") ||
    analystName.toLowerCase().includes("ai");

  return (
    <button
      className={`${styles.briefItem} ${selected ? styles.briefItemActive : ""}`}
      onClick={onClick}
    >
      <div className={styles.briefItemTop}>
        <span className={styles.briefTitle}>{title}</span>
        <span className={styles.briefDate}>
          {createdAt ? createdAt.slice(0, 10) : "—"}
        </span>
      </div>
      <div className={styles.briefMeta}>
        <span className={styles.briefAuthor}>
          {isAi ? "✦ Claude Sonnet" : analystName ?? "system"}
        </span>
        <span className={styles.briefRunId}>
          run: {runId.slice(0, 8)}…
        </span>
      </div>
    </button>
  );
}

export default function PolicyBriefs() {
  const client = useOsdkClient();
  const queryClient = useQueryClient();
  const [selectedBriefKey, setSelectedBriefKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: briefList = [], isLoading } = useOsdkQuery({
    objectType: policyBrief,
    queryKey: ["briefs"],
    orderBy: { createdAt: "desc" },
    pageSize: 50,
  });

  const selectedBrief = briefList.find(
    (b) => b.$primaryKey === selectedBriefKey,
  );

  const filteredBriefs = briefList.filter(
    (b) =>
      !searchQuery ||
      b.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.analystName?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  async function handleDelete() {
    if (!selectedBrief) return;
    if (!confirm(`Delete brief "${selectedBrief.title}"?`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client(deletePolicyBrief).applyAction({
        brief: selectedBrief,
      });
      setSelectedBriefKey(null);
      queryClient.invalidateQueries({ queryKey: ["briefs"] });
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete brief",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        icon="📄"
        title="Policy Briefs"
        titleKo="정책 보고서"
        description="AI-generated policy analysis documents · Claude Sonnet 4"
        actions={
          selectedBrief && (
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "🗑 Delete"}
            </button>
          )
        }
      />

      <div className={styles.content}>
        {/* ── Left: Brief List ── */}
        <div className={`card ${styles.listPanel}`}>
          <div className={styles.listHeader}>
            <div className="card-header" style={{ marginBottom: 0 }}>
              <h2 className="card-title">보고서 목록 · Briefs</h2>
              <span className="badge badge-info">{briefList.length}</span>
            </div>

            <div className={styles.searchBox}>
              <input
                className={styles.searchInput}
                placeholder="⌕ search briefs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {deleteError && (
            <div className={styles.deleteError}>{deleteError}</div>
          )}

          {isLoading ? (
            <div className="empty-state">
              <p>Loading briefs…</p>
            </div>
          ) : filteredBriefs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <p className="empty-state-title">
                {searchQuery ? "No results" : "No briefs generated"}
              </p>
              <p>
                {searchQuery
                  ? "Try a different search term"
                  : 'Run a projection then click "Generate brief"'}
              </p>
            </div>
          ) : (
            <div className={styles.briefList}>
              {filteredBriefs.map((brief) => (
                <BriefListItem
                  key={brief.$primaryKey}
                  title={brief.title ?? brief.$primaryKey}
                  runId={brief.runId ?? "—"}
                  createdAt={brief.createdAt}
                  analystName={brief.analystName}
                  selected={selectedBriefKey === brief.$primaryKey}
                  onClick={() => setSelectedBriefKey(brief.$primaryKey)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Brief Reader ── */}
        <div className={`card ${styles.viewerPanel}`}>
          {!selectedBrief ? (
            <div className="empty-state">
              <div className="empty-state-icon">📖</div>
              <p className="empty-state-title">Select a brief</p>
              <p>Click a brief from the list to read it here</p>
            </div>
          ) : (
            <div className={styles.readerLayout}>
              {/* Main content */}
              <div className={styles.readerContent}>
                {/* Brief ID caption */}
                <span className={styles.briefCaption}>
                  Policy Brief · {selectedBrief.$primaryKey.slice(0, 8)}
                </span>

                {/* Titles */}
                <h2 className={styles.readerMainTitle}>
                  정책 시나리오 분석 보고서
                </h2>
                <h3 className={styles.readerSubTitle}>
                  {selectedBrief.title}
                </h3>

                {/* Meta strip */}
                <div className={styles.metaStrip}>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Projection run</span>
                    <span className={styles.metaValue}>
                      {selectedBrief.runId?.slice(0, 12)}…
                    </span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Generated</span>
                    <span className={styles.metaValue}>
                      {selectedBrief.createdAt
                        ? selectedBrief.createdAt.replace("T", " ").slice(0, 16) + " KST"
                        : "—"}
                    </span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>By</span>
                    <span className={styles.metaValue}>
                      {selectedBrief.analystName
                        ? (selectedBrief.analystName.toLowerCase().includes("claude")
                            ? "✦ "
                            : "") + selectedBrief.analystName
                        : "✦ Claude Sonnet 4"}
                    </span>
                  </div>
                  {selectedBrief.scenarioCount != null && (
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Scenarios</span>
                      <span className={styles.metaValue}>
                        {selectedBrief.scenarioCount}
                      </span>
                    </div>
                  )}
                </div>

                {/* Brief body — full markdown rendering */}
                <div className={styles.briefBody}>
                  {selectedBrief.briefText ? (
                    <MarkdownRenderer text={selectedBrief.briefText} />
                  ) : (
                    <p className={styles.briefParagraph}>No content available.</p>
                  )}
                </div>
              </div>

              {/* Floating sidebar: TOC + actions */}
              <div className={styles.readerSidebar}>
                {selectedBrief.briefText && (
                  <TableOfContents text={selectedBrief.briefText} />
                )}

                <div className={styles.sidebarActions}>
                  <button
                    className="btn btn-secondary"
                    style={{ width: "100%" }}
                    onClick={() => {
                      if (selectedBrief.briefText) {
                        const blob = new Blob([selectedBrief.briefText], {
                          type: "text/plain",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${selectedBrief.title ?? "brief"}.txt`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }
                    }}
                  >
                    ↓ Download TXT
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ width: "100%" }}
                    onClick={() => {
                      if (selectedBrief.briefText) {
                        navigator.clipboard.writeText(
                          selectedBrief.briefText,
                        );
                      }
                    }}
                  >
                    Copy to clipboard
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

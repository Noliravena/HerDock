import { useMemo, useState } from "react";
import { RUN_STATUS_LABELS, type RunStatus } from "@her-dock/agent-protocol";
import { useShallow } from "zustand/react/shallow";
import type { Run } from "../host/client";
import { useWorkbench } from "../store/workbench";

type RunFilter = "all" | "active" | "failed" | "completed";

const FILTERS: { value: RunFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "failed", label: "失败" },
  { value: "completed", label: "完成" },
];
const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting_approval"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "interrupted"]);

function matchesFilter(run: Run, filter: RunFilter): boolean {
  if (filter === "active") return ACTIVE_STATUSES.has(run.status);
  if (filter === "failed") return FAILED_STATUSES.has(run.status);
  if (filter === "completed") return run.status === "completed";
  return true;
}

/** Group runs into 今天 / 昨天 / 更早 buckets like the activity feed in the design. */
function groupRuns(runs: Run[]): { label: string; en: string; rows: Run[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 3600 * 1000;
  const buckets: Record<string, Run[]> = { today: [], yesterday: [], earlier: [] };
  for (const r of runs) {
    const t = new Date(r.updatedAt || r.createdAt || "").getTime();
    if (Number.isNaN(t) || t >= startOfToday) buckets.today.push(r);
    else if (t >= startOfYesterday) buckets.yesterday.push(r);
    else buckets.earlier.push(r);
  }
  return [
    { label: "今天", en: "TODAY", rows: buckets.today },
    { label: "昨天", en: "YESTERDAY", rows: buckets.yesterday },
    { label: "更早", en: "EARLIER", rows: buckets.earlier },
  ].filter((g) => g.rows.length > 0);
}

function progressPct(run: Run): number {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(run.planProgress || "");
  if (m) {
    const done = Number(m[1]);
    const total = Number(m[2]) || 1;
    return Math.round((done / total) * 100);
  }
  return run.status === "completed" ? 100 : run.status === "failed" ? 20 : 50;
}

export function ActivityView() {
  const { allRuns, retryRun, run, runs, selectRun, workspaces } = useWorkbench(
    useShallow((state) => ({
      allRuns: state.allRuns,
      retryRun: state.retryRun,
      run: state.run,
      runs: state.runs,
      selectRun: state.selectRun,
      workspaces: state.workspaces,
    })),
  );
  const [filter, setFilter] = useState<RunFilter>("all");
  const source = useMemo(
    () => (allRuns.length ? allRuns : runs.length ? runs : run ? [run] : []),
    [allRuns, run, runs],
  );
  const counts = useMemo(() => {
    const next: Record<RunFilter, number> = {
      all: source.length,
      active: 0,
      failed: 0,
      completed: 0,
    };
    for (const item of source) {
      if (matchesFilter(item, "active")) next.active += 1;
      if (matchesFilter(item, "failed")) next.failed += 1;
      if (matchesFilter(item, "completed")) next.completed += 1;
    }
    return next;
  }, [source]);
  const groups = useMemo(
    () =>
      groupRuns(filter === "all" ? source : source.filter((item) => matchesFilter(item, filter))),
    [filter, source],
  );
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  return (
    <div className="activity">
      <div className="activity-toolbar" role="group" aria-label="运行状态筛选">
        {FILTERS.map(({ value, label }) => (
          <button
            type="button"
            className={filter === value ? "active" : ""}
            key={value}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>{counts[value]}</span>
          </button>
        ))}
      </div>
      {!groups.length && <div className="empty-hint">此筛选条件下没有运行记录。</div>}
      {groups.map((g) => (
        <div key={g.en}>
          <div className="act-group-head">
            <span className="label">{g.label}</span>
            <span className="en">{g.en}</span>
            <div className="rule" />
            <span className="meta">{g.rows.length} runs</span>
          </div>
          <div className="act-list">
            {g.rows.map((r) => (
              <article key={r.id} className="act-card">
                <span className={`act-rail ${r.status}`} />
                <button type="button" className="act-body" onClick={() => void selectRun(r.id)}>
                  <div className="act-top">
                    <span className={`run-dot ${r.status}`} />
                    <span className="act-id">{r.id}</span>
                    <span className="act-title">{r.prompt || "未命名运行"}</span>
                    <span className={`status-chip ${r.status}`}>
                      {RUN_STATUS_LABELS[r.status as RunStatus] || r.status}
                    </span>
                    <span className="act-time">{timeOf(r.updatedAt || r.createdAt)}</span>
                  </div>
                  <div className="act-summary">
                    {r.errorMessage ||
                      `${workspaceNames.get(r.workspaceId) || r.workspaceId} · ${r.providerId}`}
                  </div>
                  <div className="act-foot">
                    <span className="bar">
                      <i
                        style={{
                          width: `${progressPct(r)}%`,
                          background: railColor(r.status),
                        }}
                      />
                    </span>
                    <span className="act-steps">{r.planProgress || "—"}</span>
                    <span className="act-cost">
                      {r.tokenUsage?.total ? `${r.tokenUsage.total} tokens` : r.providerId}
                    </span>
                  </div>
                </button>
                {FAILED_STATUSES.has(r.status) && (
                  <button type="button" className="act-retry" onClick={() => void retryRun(r.id)}>
                    重试
                  </button>
                )}
              </article>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function railColor(status: string): string {
  switch (status) {
    case "running":
    case "starting":
      return "var(--warn)";
    case "waiting_human":
    case "waiting_approval":
    case "paused":
      return "var(--accent)";
    case "completed":
      return "var(--ok)";
    case "failed":
    case "cancelled":
      return "var(--danger)";
    default:
      return "var(--faint)";
  }
}

function timeOf(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

import { useMemo, useState } from "react";
import { MagnifyingGlass, Timer } from "@phosphor-icons/react";
import { RUN_STATUS_LABELS, type RunStatus } from "@her-dock/agent-protocol";
import { useShallow } from "zustand/react/shallow";
import type { Run } from "../host/client";
import { useWorkbench } from "../store/workbench";
import { IconKanban, IconRows } from "./Icons";

type RunFilter = "all" | "active" | "failed" | "completed";

const FILTERS: { value: RunFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "failed", label: "失败" },
  { value: "completed", label: "完成" },
];
const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting_approval"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "interrupted"]);

/** Board columns, in the order the design lays them out. */
const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: "queued", label: "排队", statuses: ["queued"] },
  { key: "running", label: "执行中", statuses: ["running", "starting"] },
  { key: "waiting_approval", label: "待审批", statuses: ["waiting_approval", "paused"] },
  { key: "completed", label: "已完成", statuses: ["completed"] },
  { key: "failed", label: "失败 / 中断", statuses: ["failed", "cancelled", "interrupted"] },
];

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

/** Wall-clock duration of a run, or how long it has been going. */
function durationOf(run: Run): string {
  const start = new Date(run.startedAt || run.createdAt || "").getTime();
  const end = new Date(run.finishedAt || run.updatedAt || "").getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function ActivityView() {
  const { activityLayout, allRuns, retryRun, run, runs, selectRun, setActivityLayout, workspaces } =
    useWorkbench(
      useShallow((state) => ({
        activityLayout: state.activityLayout,
        allRuns: state.allRuns,
        retryRun: state.retryRun,
        run: state.run,
        runs: state.runs,
        selectRun: state.selectRun,
        setActivityLayout: state.setActivityLayout,
        workspaces: state.workspaces,
      })),
    );
  const [filter, setFilter] = useState<RunFilter>("all");
  const [query, setQuery] = useState("");
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
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return source.filter(
      (item) =>
        matchesFilter(item, filter) &&
        (!needle ||
          item.id.toLowerCase().includes(needle) ||
          item.prompt.toLowerCase().includes(needle)),
    );
  }, [filter, query, source]);
  const groups = useMemo(() => groupRuns(visible), [visible]);
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
  const todayTokens = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return source.reduce((sum, item) => {
      const t = new Date(item.updatedAt || item.createdAt || "").getTime();
      if (Number.isNaN(t) || t < startOfToday.getTime()) return sum;
      return sum + (item.tokenUsage?.total || 0);
    }, 0);
  }, [source]);
  const stats = [
    { label: "执行中", value: counts.active, tone: "running" },
    {
      label: "待审批",
      value: source.filter((item) => item.status === "waiting_approval").length,
      tone: "waiting_approval",
    },
    { label: "今日完成", value: counts.completed, tone: "completed" },
    { label: "今日 tokens", value: todayTokens, tone: "idle" },
  ];

  const summaryOf = (r: Run) =>
    r.errorMessage || `${workspaceNames.get(r.workspaceId) || r.workspaceId} · ${r.providerId}`;

  return (
    <div className="activity">
      <div className="activity-head">
        <h1>活动</h1>
        <div className="activity-stats">
          {stats.map((stat) => (
            <span className="activity-stat" key={stat.label}>
              <span className={`run-dot ${stat.tone}`} />
              <b>{stat.value}</b>
              {stat.label}
            </span>
          ))}
        </div>
        <label className="activity-search">
          <MagnifyingGlass size={12} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Run"
          />
        </label>
        <div className="seg icon-seg" role="group" aria-label="活动视图">
          <button
            type="button"
            title="列表"
            aria-pressed={activityLayout === "list"}
            className={activityLayout === "list" ? "active" : ""}
            onClick={() => setActivityLayout("list")}
          >
            <IconRows />
          </button>
          <button
            type="button"
            title="看板"
            aria-pressed={activityLayout === "board"}
            className={activityLayout === "board" ? "active" : ""}
            onClick={() => setActivityLayout("board")}
          >
            <IconKanban />
          </button>
        </div>
      </div>

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
        <span className="activity-source mono">本地历史 · herdock-v1.db</span>
      </div>

      {activityLayout === "list" && (
        <div className="activity-scroll">
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
                      <div className="act-summary">{summaryOf(r)}</div>
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
                          {durationOf(r)} ·{" "}
                          {r.tokenUsage?.total ? `${r.tokenUsage.total} tokens` : r.providerId}
                        </span>
                      </div>
                    </button>
                    {FAILED_STATUSES.has(r.status) && (
                      <button
                        type="button"
                        className="act-retry"
                        onClick={() => void retryRun(r.id)}
                      >
                        重试
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {activityLayout === "board" && (
        <div className="activity-board">
          {COLUMNS.map((column) => {
            const cards = visible.filter((r) => column.statuses.includes(r.status));
            return (
              <section className="board-col" key={column.key}>
                <header>
                  <span className={`board-dot ${column.statuses[0]}`} />
                  <span className="board-label">{column.label}</span>
                  <span className="board-count">{cards.length}</span>
                </header>
                <div className="board-cards">
                  {cards.map((r) => (
                    <button
                      type="button"
                      className={`board-card ${r.status}`}
                      key={r.id}
                      onClick={() => void selectRun(r.id)}
                    >
                      <span className="board-card-top">
                        <span className="mono id">{r.id}</span>
                        <span className={`status-chip ${r.status}`}>
                          {RUN_STATUS_LABELS[r.status as RunStatus] || r.status}
                        </span>
                        <span className="mono time">{timeOf(r.updatedAt || r.createdAt)}</span>
                      </span>
                      <span className="board-card-title">{r.prompt || "未命名运行"}</span>
                      <span className="board-card-summary">{summaryOf(r)}</span>
                      <span className="board-card-progress">
                        <span className="bar">
                          <i
                            style={{
                              width: `${progressPct(r)}%`,
                              background: railColor(r.status),
                            }}
                          />
                        </span>
                        <span className="mono">{r.planProgress || "—"}</span>
                      </span>
                      <span className="board-card-foot">
                        <span className="mono prov">{r.providerId}</span>
                        <span className="mono dur">
                          <Timer size={11} />
                          {durationOf(r)}
                        </span>
                      </span>
                    </button>
                  ))}
                  {!cards.length && <div className="board-empty">暂无</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
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

import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { RUN_STATUS_LABELS, type RunStatus } from "@her-dock/agent-protocol";
import { useShallow } from "zustand/react/shallow";
import type { Run, Session, Workspace } from "../host/client";
import { runDuration } from "../lib/runMetrics";
import { useWorkbench } from "../store/workbench";
import {
  ConsoleShell,
  ErrorBanner,
  JobBar,
  PageEmpty,
  StatusPill,
  useElapsedLabel,
} from "./pageElements";

export function ActivityView() {
  const centerView = useWorkbench((state) => state.centerView);
  if (centerView === "history") return <GrokHistory />;
  return <GrokActivity />;
}

function sessionWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 3600 * 1000;
  const t = d.getTime();
  if (t >= startOfToday)
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (t >= startOfYesterday) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function sessionBucket(iso?: string): "today" | "yesterday" | "earlier" {
  if (!iso) return "earlier";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "earlier";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfToday - 24 * 3600 * 1000) return "yesterday";
  return "earlier";
}

function runHint(status?: string): string {
  if (!status) return "";
  if (["queued", "starting", "running"].includes(status)) return "进行中";
  if (["waiting_approval", "waiting_human", "paused"].includes(status)) return "待审批";
  if (["failed", "cancelled", "interrupted"].includes(status)) return "失败";
  return "";
}

function GrokHistory() {
  const state = useWorkbench(
    useShallow((s) => ({
      allRuns: s.allRuns,
      hostOnline: s.hostOnline,
      newSession: s.newSession,
      runs: s.runs,
      selectSession: s.selectSession,
      session: s.session,
      sessions: s.sessions,
      workspace: s.workspace,
      workspaces: s.workspaces,
      workspaceSessions: s.workspaceSessions,
    })),
  );
  const [query, setQuery] = useState("");
  const knownRuns = state.allRuns.length ? state.allRuns : state.runs;
  const workspaces: Workspace[] = state.workspaces.length
    ? state.workspaces
    : state.workspace
      ? [state.workspace]
      : [];

  const items = useMemo(() => {
    const seen = new Set<string>();
    const next: { session: Session; workspaceName: string; run?: Run }[] = [];
    for (const workspace of workspaces) {
      const list =
        state.workspaceSessions[workspace.id] ||
        (workspace.id === state.workspace?.id ? state.sessions : []);
      for (const session of list) {
        if (seen.has(session.id)) continue;
        seen.add(session.id);
        next.push({
          session,
          workspaceName: workspace.name,
          run: knownRuns.find((item) => item.sessionId === session.id),
        });
      }
    }
    next.sort((a, b) => {
      const ta = new Date(
        a.run?.updatedAt || a.session.updatedAt || a.session.createdAt || "",
      ).getTime();
      const tb = new Date(
        b.run?.updatedAt || b.session.updatedAt || b.session.createdAt || "",
      ).getTime();
      return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    });
    return next;
  }, [knownRuns, state.sessions, state.workspace?.id, state.workspaceSessions, workspaces]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.session.title.toLowerCase().includes(needle) ||
        item.workspaceName.toLowerCase().includes(needle),
    );
  }, [items, query]);

  const groups = useMemo(() => {
    const buckets: Record<string, typeof visible> = { today: [], yesterday: [], earlier: [] };
    for (const item of visible) {
      buckets[
        sessionBucket(item.run?.updatedAt || item.session.updatedAt || item.session.createdAt)
      ].push(item);
    }
    return [
      { key: "today", label: "今天", rows: buckets.today },
      { key: "yesterday", label: "昨天", rows: buckets.yesterday },
      { key: "earlier", label: "更早", rows: buckets.earlier },
    ].filter((group) => group.rows.length > 0);
  }, [visible]);

  const manyWorkspaces = workspaces.length > 1;
  const searching = Boolean(query.trim());

  return (
    <ConsoleShell
      title="历史"
      hostOnline={state.hostOnline}
      actions={
        <label className="g-search">
          <MagnifyingGlass size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话"
          />
        </label>
      }
    >
      {!groups.length && searching && (
        <PageEmpty title="没有匹配的对话" body="换个标题或工作区名称再试一次。" />
      )}
      {!groups.length && !searching && (
        <PageEmpty
          title="还没有对话"
          body="从一条消息开始。之后可以在这里按天找回会话。"
          action={{ label: "新建会话", onClick: () => void state.newSession() }}
        />
      )}
      {groups.map((group) => (
        <section className="g-hist-group" key={group.key} data-slot="thread-list">
          <h2 className="g-hist-sep">{group.label}</h2>
          <div className="g-hist-list">
            {group.rows.map((item) => {
              const hint = runHint(item.run?.status);
              return (
                <button
                  type="button"
                  key={item.session.id}
                  className={`g-hist-row ${state.session?.id === item.session.id ? "on" : ""}`}
                  onClick={() => void state.selectSession(item.session.id)}
                >
                  <span className={`run-dot ${item.run?.status || "idle"}`} />
                  <span className="g-hist-title">{item.session.title || "新会话"}</span>
                  <span className="g-hist-meta">
                    {manyWorkspaces && <em>{item.workspaceName}</em>}
                    {hint && <i className={item.run?.status}>{hint}</i>}
                    <time>
                      {sessionWhen(
                        item.run?.updatedAt || item.session.updatedAt || item.session.createdAt,
                      )}
                    </time>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </ConsoleShell>
  );
}

type RunFilter = "all" | "active" | "failed" | "completed";

const FILTERS: { value: RunFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "failed", label: "失败" },
  { value: "completed", label: "完成" },
];
const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting_approval"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "interrupted"]);

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

function pillOf(status: string): "working" | "waiting" | "done" | "failed" {
  if (["queued", "starting", "running"].includes(status)) return "working";
  if (["waiting_approval", "waiting_human", "paused"].includes(status)) return "waiting";
  if (FAILED_STATUSES.has(status)) return "failed";
  return "done";
}

function GrokActivity() {
  const {
    activityLayout,
    allRuns,
    hostOnline,
    retryRun,
    run,
    runs,
    selectRun,
    setActivityLayout,
    workspaces,
  } = useWorkbench(
    useShallow((state) => ({
      activityLayout: state.activityLayout,
      allRuns: state.allRuns,
      hostOnline: state.hostOnline,
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
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
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
  const summaryOf = (item: Run) =>
    `${workspaceNames.get(item.workspaceId) || item.workspaceId} · ${item.providerId}`;
  const filtered = filter !== "all" || Boolean(query.trim());

  return (
    <ConsoleShell
      title="活动"
      hostOnline={hostOnline}
      actions={
        <>
          <label className="g-search">
            <MagnifyingGlass size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 Run"
            />
          </label>
          <div className="g-tabs" role="group" aria-label="活动视图">
            <button
              type="button"
              className={activityLayout === "list" ? "on" : ""}
              onClick={() => setActivityLayout("list")}
            >
              列表
            </button>
            <button
              type="button"
              className={activityLayout === "board" ? "on" : ""}
              onClick={() => setActivityLayout("board")}
            >
              看板
            </button>
          </div>
        </>
      }
    >
      <div className="g-tabs" role="group" aria-label="运行状态筛选">
        {FILTERS.map(({ value, label }) => (
          <button
            type="button"
            className={filter === value ? "on" : ""}
            key={value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {!visible.length && (
        <PageEmpty
          title={filtered ? "没有匹配的运行" : "还没有运行记录"}
          body={
            filtered ? "当前筛选或搜索没有命中队列里的任务。" : "发送一条消息后，运行会出现在这里。"
          }
          action={
            filtered
              ? {
                  label: "查看全部",
                  onClick: () => {
                    setFilter("all");
                    setQuery("");
                  },
                }
              : undefined
          }
        />
      )}
      {activityLayout === "list" && !!visible.length && (
        <div className="aui-inbox" data-slot="background-inbox">
          {visible.map((item) => (
            <InboxCard
              key={item.id}
              item={item}
              summary={summaryOf(item)}
              onOpen={() => void selectRun(item.id)}
              onRetry={() => void retryRun(item.id)}
            />
          ))}
        </div>
      )}
      {activityLayout === "board" && !!visible.length && (
        <div className="bui-board">
          {COLUMNS.map((column) => {
            const cards = visible.filter((item) => column.statuses.includes(item.status));
            return (
              <section className="bui-board-col" key={column.key}>
                <header>
                  <span className={`bui-task-dot ${column.statuses[0]}`} />
                  {column.label}
                  <em>{cards.length}</em>
                </header>
                {cards.map((item) => (
                  <button
                    type="button"
                    className="bui-task"
                    key={item.id}
                    onClick={() => void selectRun(item.id)}
                  >
                    <span className="bui-task-copy">
                      <strong>{item.prompt || "未命名运行"}</strong>
                      <small>{summaryOf(item)}</small>
                    </span>
                    {column.key === "running" && item.planProgress && (
                      <JobBar progress={item.planProgress} />
                    )}
                  </button>
                ))}
                {!cards.length && <p className="g-empty">暂无</p>}
              </section>
            );
          })}
        </div>
      )}
    </ConsoleShell>
  );
}

function InboxCard({
  item,
  summary,
  onOpen,
  onRetry,
}: {
  item: Run;
  summary: string;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const failed = FAILED_STATUSES.has(item.status);
  const live = ACTIVE_STATUSES.has(item.status);
  const elapsed = useElapsedLabel(live ? item.startedAt || item.createdAt : undefined);
  const waited = live ? elapsed : runDuration(item);

  return (
    <article className="aui-inbox-card">
      <button type="button" className="aui-inbox-main" onClick={onOpen}>
        <span className="aui-inbox-copy">
          <strong>{item.prompt || "未命名运行"}</strong>
          <small>{summary}</small>
          {item.status === "running" && item.planProgress && (
            <JobBar progress={item.planProgress} />
          )}
        </span>
        <span className="aui-inbox-meta">
          <StatusPill
            state={pillOf(item.status)}
            label={RUN_STATUS_LABELS[item.status as RunStatus] || item.status}
            elapsed={waited || undefined}
          />
          <time>{timeOf(item.updatedAt || item.createdAt)}</time>
        </span>
      </button>
      {failed && (
        <ErrorBanner
          title="运行未完成"
          detail={item.errorMessage || "运行失败或被中断。"}
          onRetry={onRetry}
        />
      )}
    </article>
  );
}

function timeOf(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

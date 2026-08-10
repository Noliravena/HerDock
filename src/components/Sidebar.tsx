import { APP_DISPLAY_NAME } from "@her-dock/shared";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench, type GroupMode } from "../store/workbench";
import type { Run, Session, Workspace } from "../host/client";
import {
  IconActivity,
  IconChevron,
  IconCompose,
  IconConnector,
  IconFile,
  IconGear,
  IconPlus,
  IconSearch,
  IconSkills,
} from "./Icons";

const GROUP_LABEL: Record<GroupMode, string> = {
  time: "按时间",
  status: "按状态",
  name: "按名称",
};

const STATUS_RANK: Record<string, number> = {
  running: 0,
  starting: 0,
  waiting_human: 1,
  waiting_approval: 1,
  paused: 2,
  queued: 2,
  completed: 3,
  cancelled: 4,
  failed: 5,
};

/** Latest run status per session, used for the coloured dots in the tree. */
function statusOf(runs: Run[], sessionId: string): string {
  return runs.find((r) => r.sessionId === sessionId)?.status || "idle";
}

export function Sidebar({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const state = useWorkbench(
    useShallow((s) => ({
      allRuns: s.allRuns,
      approvals: s.approvals,
      artifacts: s.artifacts,
      centerView: s.centerView,
      collapsedWorkspaces: s.collapsedWorkspaces,
      connectors: s.connectors,
      cycleGroupMode: s.cycleGroupMode,
      groupMode: s.groupMode,
      hostOnline: s.hostOnline,
      newSession: s.newSession,
      platform: s.platform,
      providers: s.providers,
      queue: s.queue,
      runs: s.runs,
      selectSession: s.selectSession,
      session: s.session,
      sessions: s.sessions,
      setCenterView: s.setCenterView,
      setSettingsOpen: s.setSettingsOpen,
      setSideTab: s.setSideTab,
      sideTab: s.sideTab,
      skills: s.skills,
      togglePalette: s.togglePalette,
      toggleWorkspaceCollapsed: s.toggleWorkspaceCollapsed,
      workspace: s.workspace,
      workspaces: s.workspaces,
      workspaceSessions: s.workspaceSessions,
    })),
  );
  const workspaces: Workspace[] = state.workspaces.length
    ? state.workspaces
    : state.workspace
      ? [state.workspace]
      : [];
  const pendingApprovals = state.approvals.length;
  const liveRuns = state.queue.length;

  const knownRuns = state.allRuns.length ? state.allRuns : state.runs;
  const sortSessions = (list: Session[]): Session[] => {
    const copy = [...list];
    if (state.groupMode === "name")
      return copy.sort((a, b) => a.title.localeCompare(b.title, "zh"));
    if (state.groupMode === "status") {
      return copy.sort(
        (a, b) =>
          (STATUS_RANK[statusOf(knownRuns, a.id)] ?? 9) -
          (STATUS_RANK[statusOf(knownRuns, b.id)] ?? 9),
      );
    }
    return copy;
  };

  return (
    <aside className="left">
      {state.platform.windowControl === "macos" && (
        <div className="mac-lights">
          <span className="traffic">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}

      <div className="brand">
        <div className="logo">行</div>
        <div className="brand-name">
          HerDock <span>行知</span>
        </div>
        <button
          type="button"
          className="icon-btn push"
          title="搜索 / 命令面板"
          onClick={state.togglePalette}
        >
          <IconSearch />
        </button>
      </div>

      <div className="nav-group">
        <button type="button" className="nav-item" onClick={() => void state.newSession()}>
          <IconCompose />
          <span>新建会话</span>
          <span className="hint">{state.platform.newHint}</span>
        </button>
        <button
          type="button"
          className={`nav-item ${state.centerView === "activity" ? "active" : ""}`}
          onClick={() => state.setCenterView("activity")}
        >
          <IconActivity />
          <span>活动</span>
          {liveRuns > 0 && <span className="hint warn">{liveRuns}</span>}
        </button>
      </div>

      <div className="section-label">
        <span>工作区</span>
        <button
          type="button"
          className="group-toggle"
          onClick={state.cycleGroupMode}
          title="切换分组方式"
        >
          {GROUP_LABEL[state.groupMode]}
          <IconChevron size={9} />
        </button>
        <button type="button" className="icon-btn" onClick={onOpenWorkspace} title="打开文件夹">
          <IconPlus size={11} />
        </button>
      </div>

      <div className="ws-scroll">
        {workspaces.map((w) => {
          const collapsed = !!state.collapsedWorkspaces[w.id];
          const sessions = sortSessions(
            state.workspaceSessions[w.id] || (w.id === state.workspace?.id ? state.sessions : []),
          );
          return (
            <div className="ws-block" key={w.id}>
              <button
                type="button"
                className={`ws-head ${collapsed ? "collapsed" : ""}`}
                onClick={() => state.toggleWorkspaceCollapsed(w.id)}
              >
                <span className="caret">
                  <IconChevron size={10} />
                </span>
                <span className="ws-dot" />
                <span className="ws-name">{w.name}</span>
                {w.dirtySummary && <span className="ws-diff">{w.dirtySummary}</span>}
              </button>
              {!collapsed &&
                sessions.map((sess) => (
                  <button
                    key={sess.id}
                    type="button"
                    className={`session-row ${state.session?.id === sess.id ? "active" : ""}`}
                    onClick={() => void state.selectSession(sess.id)}
                    title={sess.title}
                  >
                    <span className={`run-dot ${statusOf(knownRuns, sess.id)}`} />
                    <span className="name">{sess.title}</span>
                  </button>
                ))}
              {!collapsed && !sessions.length && (
                <div className="empty-hint" style={{ padding: "6px 12px", fontSize: 11.5 }}>
                  暂无会话
                </div>
              )}
            </div>
          );
        })}
        {!workspaces.length && (
          <div className="empty-hint">还没有工作区，点右上角 + 打开一个本地文件夹。</div>
        )}
      </div>

      <div className="nav-bottom">
        <button
          type="button"
          className={`nav-item ${state.sideTab === "skills" ? "active" : ""}`}
          onClick={() => state.setSideTab("skills")}
        >
          <IconSkills />
          <span>技能</span>
          <span className="hint">{state.skills.length || ""}</span>
        </button>
        <button
          type="button"
          className={`nav-item ${state.sideTab === "approvals" ? "active" : ""}`}
          onClick={() => state.setSideTab("approvals")}
        >
          <IconConnector />
          <span>本地 MCP</span>
          <span className={`hint ${pendingApprovals ? "warn" : ""}`}>
            {pendingApprovals || state.connectors.length || ""}
          </span>
        </button>
        <button
          type="button"
          className={`nav-item ${state.sideTab === "cost" ? "active" : ""}`}
          onClick={() => state.setSideTab("cost")}
        >
          <IconFile />
          <span>产物库</span>
          <span className="hint">{state.artifacts.length || ""}</span>
        </button>
      </div>

      <div className="user-card">
        <button type="button" className="inner" onClick={() => state.setSettingsOpen(true)}>
          <div className="avatar">
            <IconGear />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="user-name">{APP_DISPLAY_NAME}</div>
            <div className="user-meta">
              {state.hostOnline
                ? `本地核心 · ${state.providers.filter((provider) => provider.available).length} Provider`
                : "核心未连接"}
            </div>
          </div>
          <span className="icon-btn push" aria-hidden>
            <IconGear />
          </span>
        </button>
      </div>
    </aside>
  );
}

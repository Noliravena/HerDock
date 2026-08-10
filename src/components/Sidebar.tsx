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
  IconFolderOpen,
  IconGear,
  IconMenu,
  IconPanelRight,
  IconPlus,
  IconSearch,
  IconSkills,
} from "./Icons";
import { Popover } from "./Popover";

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

/** Per-workspace accent, matching the three-colour rhythm of the design mock. */
const WS_ACCENTS = ["#3b5ba5", "#4a7a3c", "#a5622a", "#6b4f8a", "#b4483a"];

function accentFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return WS_ACCENTS[hash % WS_ACCENTS.length];
}

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
      rightOpen: s.rightOpen,
      togglePalette: s.togglePalette,
      toggleRight: s.toggleRight,
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
  const readyProviders = state.providers.filter((provider) => provider.available).length;
  const brandInTitleBar = state.platform.windowControl === "windows";

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
        <div className="mac-lights" data-tauri-drag-region>
          <span className="traffic">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}

      {/* The Windows caption bar already carries the mark and product name, so the
          sidebar only needs the menu there. */}
      <header className={`brand ${brandInTitleBar ? "menu-only" : ""}`}>
        {!brandInTitleBar && (
          <>
            <span className="logo">行</span>
            <span className="brand-text">
              <span className="brand-title">HerDock</span>
              <span className="brand-sub">行知 · 本地工作台</span>
            </span>
          </>
        )}
        <Popover
          className={`sidebar-menu ${brandInTitleBar ? "" : "push"}`}
          side="bottom"
          align={brandInTitleBar ? "start" : "end"}
          title="菜单"
          label={<IconMenu />}
        >
          {(close) => (
            <div className="pop-scroll">
              <div className="pop-section">
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    close();
                    state.togglePalette();
                  }}
                >
                  <IconSearch />
                  <span>搜索 / 命令面板</span>
                  <kbd>{state.platform.commandHint}</kbd>
                </button>
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    close();
                    void state.newSession();
                  }}
                >
                  <IconCompose />
                  <span>新建会话</span>
                  <kbd>{state.platform.newHint}</kbd>
                </button>
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    close();
                    onOpenWorkspace();
                  }}
                >
                  <IconFolderOpen />
                  <span>打开工作区文件夹…</span>
                  <kbd>{state.platform.modifierKey} O</kbd>
                </button>
              </div>

              <div className="pop-section">
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    close();
                    state.setCenterView("activity");
                  }}
                >
                  <IconActivity />
                  <span>活动</span>
                  {liveRuns > 0 && <kbd>{liveRuns}</kbd>}
                </button>
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    close();
                    state.toggleRight();
                  }}
                >
                  <IconPanelRight />
                  <span>{state.rightOpen ? "隐藏右侧栏" : "显示右侧栏"}</span>
                </button>
              </div>

              <div className="pop-section">
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    close();
                    state.setSettingsOpen(true);
                  }}
                >
                  <IconGear />
                  <span>设置</span>
                  <kbd>{state.platform.modifierKey} ,</kbd>
                </button>
              </div>
            </div>
          )}
        </Popover>
      </header>

      <nav className="nav-group">
        <button type="button" className="nav-item" onClick={() => void state.newSession()}>
          <span className="nav-glyph">
            <IconCompose />
          </span>
          <span className="nav-text">新建会话</span>
          <span className="nav-kbd">{state.platform.newHint}</span>
        </button>
        <button
          type="button"
          className={`nav-item ${state.centerView === "activity" ? "active" : ""}`}
          onClick={() => state.setCenterView("activity")}
        >
          <span className="nav-glyph">
            <IconActivity />
          </span>
          <span className="nav-text">活动</span>
          {liveRuns > 0 && <span className="nav-badge warn">{liveRuns}</span>}
        </button>
      </nav>

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
            <div
              className="ws-block"
              key={w.id}
              style={{ ["--ws-accent" as string]: accentFor(w.id) }}
            >
              <button
                type="button"
                className={`ws-head ${collapsed ? "collapsed" : ""}`}
                onClick={() => state.toggleWorkspaceCollapsed(w.id)}
                title={w.rootPath || w.name}
              >
                <span className="caret">
                  <IconChevron size={10} />
                </span>
                <span className="ws-dot" />
                <span className="ws-name">{w.name}</span>
                {w.dirtySummary ? (
                  <span className="ws-diff">{w.dirtySummary}</span>
                ) : (
                  sessions.length > 0 && <span className="ws-count">{sessions.length}</span>
                )}
              </button>
              {!collapsed && sessions.length > 0 && (
                <div className="ws-sessions">
                  {sessions.map((sess) => (
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
                </div>
              )}
              {!collapsed && !sessions.length && (
                <div className="ws-sessions">
                  <p className="ws-empty">暂无会话</p>
                </div>
              )}
            </div>
          );
        })}
        {!workspaces.length && (
          <div className="ws-blank">
            <p>还没有工作区</p>
            <button type="button" className="ghost-btn" onClick={onOpenWorkspace}>
              <IconPlus size={11} />
              打开本地文件夹
            </button>
          </div>
        )}
      </div>

      <nav className="nav-bottom">
        <button
          type="button"
          className={`nav-item ${state.sideTab === "skills" ? "active" : ""}`}
          onClick={() => state.setSideTab("skills")}
        >
          <span className="nav-glyph">
            <IconSkills />
          </span>
          <span className="nav-text">技能</span>
          {state.skills.length > 0 && <span className="nav-badge">{state.skills.length}</span>}
        </button>
        <button
          type="button"
          className={`nav-item ${state.sideTab === "approvals" ? "active" : ""}`}
          onClick={() => state.setSideTab("approvals")}
        >
          <span className="nav-glyph">
            <IconConnector />
          </span>
          <span className="nav-text">本地 MCP</span>
          {(pendingApprovals || state.connectors.length) > 0 && (
            <span className={`nav-badge ${pendingApprovals ? "warn" : ""}`}>
              {pendingApprovals || state.connectors.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`nav-item ${state.sideTab === "cost" ? "active" : ""}`}
          onClick={() => state.setSideTab("cost")}
        >
          <span className="nav-glyph">
            <IconFile />
          </span>
          <span className="nav-text">产物库</span>
          {state.artifacts.length > 0 && (
            <span className="nav-badge">{state.artifacts.length}</span>
          )}
        </button>
      </nav>

      <div className="user-card">
        <button
          type="button"
          className="inner"
          onClick={() => state.setSettingsOpen(true)}
          title="打开设置"
        >
          <span className="avatar">
            行
            <i className={`presence ${state.hostOnline ? "on" : "off"}`} />
          </span>
          <span className="user-text">
            <span className="user-name">{APP_DISPLAY_NAME}</span>
            <span className="user-meta">
              {state.hostOnline ? `本地核心 · ${readyProviders} PROVIDER` : "核心未连接"}
            </span>
          </span>
          <span className="user-gear" aria-hidden>
            <IconGear />
          </span>
        </button>
      </div>
    </aside>
  );
}

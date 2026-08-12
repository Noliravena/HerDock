import { useShallow } from "zustand/react/shallow";
import { useWorkbench, type GroupMode } from "../store/workbench";
import type { Run, Session, Workspace } from "../host/client";
import {
  IconActivity,
  IconChevron,
  IconCompose,
  IconConnector,
  IconDesign,
  IconFile,
  IconFolderOpen,
  IconGear,
  IconSearch,
  IconShield,
  IconSkills,
  IconUsage,
} from "./Icons";
import { BrandMark } from "./BrandMark";

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

/** Latest run for a session, used for the coloured dot and the trailing time. */
function latestRun(runs: Run[], sessionId: string): Run | undefined {
  return runs.find((r) => r.sessionId === sessionId);
}

/** Short time stamp for a session row — 14:32 today, 8月4日 for older days. */
function sessionStamp(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function Sidebar({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const state = useWorkbench(
    useShallow((s) => ({
      allRuns: s.allRuns,
      approvals: s.approvals,
      artifacts: s.artifacts,
      appSurface: s.appSurface,
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
      setAppSurface: s.setAppSurface,
      setSettingsOpen: s.setSettingsOpen,
      settingsOpen: s.settingsOpen,
      skills: s.skills,
      togglePalette: s.togglePalette,
      toggleWorkspaceCollapsed: s.toggleWorkspaceCollapsed,
      updateStatus: s.updateStatus,
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
  const designArtifacts = state.artifacts.filter(
    (item) =>
      item.kind !== "file" &&
      item.path.startsWith("out/design/") &&
      ["html", "deck-html"].includes(item.renderer || ""),
  ).length;
  const brandInTitleBar = state.platform.windowControl === "windows";
  const workbench = state.appSurface === "workbench";
  const onView = (view: string) => workbench && state.centerView === view;

  const knownRuns = state.allRuns.length ? state.allRuns : state.runs;
  const sortSessions = (list: Session[]): Session[] => {
    const copy = [...list];
    if (state.groupMode === "name")
      return copy.sort((a, b) => a.title.localeCompare(b.title, "zh"));
    if (state.groupMode === "status") {
      return copy.sort(
        (a, b) =>
          (STATUS_RANK[latestRun(knownRuns, a.id)?.status || ""] ?? 9) -
          (STATUS_RANK[latestRun(knownRuns, b.id)?.status || ""] ?? 9),
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

      {/* The Windows caption bar already carries the mark and product name. */}
      {!brandInTitleBar && (
        <header className="brand" data-tauri-drag-region>
          <BrandMark className="logo" />
          <span className="brand-text">
            <span className="brand-title">HerDock</span>
            <span className="brand-sub">行知 · 本地工作台</span>
          </span>
        </header>
      )}

      <nav className={`nav-group ${brandInTitleBar ? "top-pad" : ""}`}>
        <button type="button" className="nav-item" onClick={() => void state.newSession()}>
          <span className="nav-glyph">
            <IconCompose />
          </span>
          <span className="nav-text">新建会话</span>
          <span className="nav-kbd">{state.platform.newHint}</span>
        </button>
        <button
          type="button"
          className={`nav-item ${state.appSurface === "design" ? "active" : ""}`}
          onClick={() => state.setAppSurface("design")}
        >
          <span className="nav-glyph">
            <IconDesign />
          </span>
          <span className="nav-text">设计</span>
          {designArtifacts > 0 && <span className="nav-badge">{designArtifacts}</span>}
        </button>
        <button
          type="button"
          className={`nav-item ${onView("activity") ? "active" : ""}`}
          onClick={() => state.setCenterView("activity")}
        >
          <span className="nav-glyph">
            <IconActivity />
          </span>
          <span className="nav-text">活动</span>
          {liveRuns > 0 && <span className="nav-badge warn">{liveRuns}</span>}
        </button>
        <button
          type="button"
          className={`nav-item ${onView("approvals") ? "active" : ""}`}
          onClick={() => state.setCenterView("approvals")}
        >
          <span className="nav-glyph">
            <IconShield />
          </span>
          <span className="nav-text">审批中心</span>
          {pendingApprovals > 0 && <span className="nav-badge alert">{pendingApprovals}</span>}
        </button>
        <button type="button" className="nav-item" onClick={state.togglePalette}>
          <span className="nav-glyph">
            <IconSearch size={16} />
          </span>
          <span className="nav-text">搜索</span>
          <span className="nav-kbd">{state.platform.commandHint}</span>
        </button>
        <button type="button" className="nav-item" onClick={onOpenWorkspace}>
          <span className="nav-glyph">
            <IconFolderOpen size={16} />
          </span>
          <span className="nav-text">打开文件夹</span>
          <span className="nav-kbd">{state.platform.modifierKey} O</span>
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
                  {sessions.map((sess) => {
                    const run = latestRun(knownRuns, sess.id);
                    return (
                      <button
                        key={sess.id}
                        type="button"
                        className={`session-row ${state.session?.id === sess.id ? "active" : ""}`}
                        onClick={() => void state.selectSession(sess.id)}
                        title={sess.title}
                      >
                        <span className={`run-dot ${run?.status || "idle"}`} />
                        <span className="name">{sess.title}</span>
                        <span className="session-time">
                          {sessionStamp(run?.updatedAt || sess.updatedAt || sess.createdAt)}
                        </span>
                      </button>
                    );
                  })}
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
              <IconFolderOpen size={12} />
              打开本地文件夹
            </button>
          </div>
        )}
      </div>

      <nav className="nav-bottom">
        <button
          type="button"
          className={`nav-item ${onView("skills") ? "active" : ""}`}
          onClick={() => state.setCenterView("skills")}
        >
          <span className="nav-glyph">
            <IconSkills />
          </span>
          <span className="nav-text">技能</span>
          {state.skills.length > 0 && <span className="nav-badge">{state.skills.length}</span>}
        </button>
        <button
          type="button"
          className={`nav-item ${onView("mcp") ? "active" : ""}`}
          onClick={() => state.setCenterView("mcp")}
        >
          <span className="nav-glyph">
            <IconConnector />
          </span>
          <span className="nav-text">本地 MCP</span>
          {state.connectors.length > 0 && (
            <span className="nav-badge">{state.connectors.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`nav-item ${onView("usage") ? "active" : ""}`}
          onClick={() => state.setCenterView("usage")}
        >
          <span className="nav-glyph">
            <IconUsage />
          </span>
          <span className="nav-text">用量与成本</span>
        </button>
        <button
          type="button"
          className={`nav-item ${onView("artifacts") ? "active" : ""}`}
          onClick={() => state.setCenterView("artifacts")}
        >
          <span className="nav-glyph">
            <IconFile />
          </span>
          <span className="nav-text">产物库</span>
          {state.artifacts.length > 0 && (
            <span className="nav-badge">{state.artifacts.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`nav-item ${state.settingsOpen ? "active" : ""}`}
          onClick={() => state.setSettingsOpen(true)}
        >
          <span className="nav-glyph">
            <IconGear size={16} />
          </span>
          <span className="nav-text">设置</span>
          <span className="nav-kbd">{state.platform.modifierKey} ,</span>
        </button>
      </nav>

      <div className="core-strip" title={state.hostOnline ? "本地核心已连接" : "本地核心未连接"}>
        <span className={`core-dot ${state.hostOnline ? "on" : "off"}`} />
        <span className="core-text">
          {state.hostOnline ? `本地核心 · ${readyProviders} PROVIDER` : "核心未连接"}
        </span>
        <span className="core-version">{state.updateStatus?.currentVersion || ""}</span>
      </div>
    </aside>
  );
}

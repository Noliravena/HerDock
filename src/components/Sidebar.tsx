import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench, type GroupMode } from "../store/workbench";
import { hostApi, type Run, type Session, type Workspace } from "../host/client";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { GrokStyleMark } from "./BrandMark";
import { PanelSash } from "./PanelSash";
import { useConfirm } from "./pageElements";
import {
  SidebarIconActivity,
  SidebarIconApprovals,
  SidebarIconArtifacts,
  SidebarIconBlocks,
  SidebarIconCaret,
  SidebarIconClose,
  SidebarIconDesign,
  SidebarIconDots,
  SidebarIconGear,
  SidebarIconGrid,
  SidebarIconHistory,
  SidebarIconMcp,
  SidebarIconPanel,
  SidebarIconPlus,
  SidebarIconPlusBare,
  SidebarIconSearch,
  SidebarIconSkills,
  SidebarIconTrash,
  SidebarIconUsage,
} from "./SidebarIcons";
import {
  Archive,
  ArrowCounterClockwise,
  CopySimple,
  FolderOpen,
  GitFork,
  PencilSimple,
} from "@phosphor-icons/react";

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

type NavLeaf = {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  dim?: boolean;
  badge?: number;
  quiet?: boolean;
  onClick: () => void;
};

function NavButton({
  item,
  title,
  sub,
}: {
  item: NavLeaf;
  title?: string;
  sub?: boolean;
}) {
  const aria = item.badge ? `${item.label} ${item.badge}` : item.label;
  return (
    <button
      type="button"
      className={`g-nav-item${sub ? " sub" : ""}${item.dim ? " dim" : ""}${item.active ? " active" : ""}`}
      aria-label={aria}
      title={title}
      onClick={item.onClick}
    >
      <span className="g-nav-ico">{item.icon}</span>
      <span className="nav-text">{item.label}</span>
      {item.badge ? (
        <span className={`nav-badge${item.quiet ? " quiet" : ""}`}>{item.badge}</span>
      ) : null}
    </button>
  );
}

function NavGroup({
  label,
  icon,
  open,
  onToggle,
  items,
  rail,
}: {
  label: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  items: NavLeaf[];
  rail: boolean;
}) {
  const hasActive = items.some((item) => item.active);
  const collapsedBadge = !open
    ? items.find((item) => item.badge && !item.quiet)?.badge ||
      items.find((item) => item.badge)?.badge
    : undefined;
  const collapsedQuiet = !items.some((item) => item.badge && !item.quiet);
  if (rail) {
    return items.map((item) => <NavButton key={item.id} item={item} title={item.label} />);
  }
  return (
    <div className={`g-nav-group${open ? " open" : ""}${hasActive ? " has-active" : ""}`}>
      <button
        type="button"
        className="g-nav-item g-nav-group-head"
        aria-expanded={open}
        aria-label={`${label} · ${open ? "收起" : "展开"}`}
        onClick={onToggle}
      >
        <span className="g-nav-ico">{icon}</span>
        <span className="nav-text">{label}</span>
        {collapsedBadge ? (
          <span className={`nav-badge${collapsedQuiet ? " quiet" : ""}`}>{collapsedBadge}</span>
        ) : null}
        <span className="g-nav-caret" aria-hidden>
          <SidebarIconCaret size={16} />
        </span>
      </button>
      <div className="g-nav-sub">
        <div className="g-nav-sub-inner">
          {items.map((item) => (
            <NavButton key={item.id} item={item} sub />
          ))}
        </div>
      </div>
    </div>
  );
}

type SidebarMenu =
  | { kind: "session"; x: number; y: number; session: Session }
  | { kind: "project"; x: number; y: number; workspace: Workspace };

const MENU_ICO = { size: 15, weight: "bold" as const };

/** Latest run for a session, used for the coloured dot and the trailing time. */
function latestRun(runs: Run[], sessionId: string): Run | undefined {
  return runs.find((r) => r.sessionId === sessionId);
}

export function Sidebar({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  return <GrokSidebar onOpenWorkspace={onOpenWorkspace} />;
}

function GrokSidebar({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const state = useWorkbench(
    useShallow((s) => ({
      allRuns: s.allRuns,
      appSurface: s.appSurface,
      approvals: s.approvals,
      beginRenameSession: s.beginRenameSession,
      cycleGroupMode: s.cycleGroupMode,
      deleteSession: s.deleteSession,
      deleteWorkspace: s.deleteWorkspace,
      forkSession: s.forkSession,
      archiveSession: s.archiveSession,
      unarchiveSession: s.unarchiveSession,
      groupMode: s.groupMode,
      hostOnline: s.hostOnline,
      leftOpen: s.leftOpen,
      leftWidth: s.leftWidth,
      newSession: s.newSession,
      openWorkspacePath: s.openWorkspacePath,
      platform: s.platform,
      queue: s.queue,
      renamingSessionId: s.renamingSessionId,
      renameSession: s.renameSession,
      resetLeftWidth: s.resetLeftWidth,
      runs: s.runs,
      selectSession: s.selectSession,
      session: s.session,
      sessions: s.sessions,
      setAppSurface: s.setAppSurface,
      setCenterView: s.setCenterView,
      setLeftWidth: s.setLeftWidth,
      setSettingsOpen: s.setSettingsOpen,
      settingsOpen: s.settingsOpen,
      toggleLeft: s.toggleLeft,
      togglePalette: s.togglePalette,
      toggleWorkspaceCollapsed: s.toggleWorkspaceCollapsed,
      collapsedWorkspaces: s.collapsedWorkspaces,
      centerView: s.centerView,
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
  const rail = !state.leftOpen;
  const pendingApprovals = state.approvals.length;
  const knownRuns = state.allRuns.length ? state.allRuns : state.runs;
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [askConfirm, confirmLayer] = useConfirm();
  const [archivedOpen, setArchivedOpen] = useState<Record<string, boolean>>({});
  const [navOpen, setNavOpen] = useState({ work: true, extra: false });
  const accountName = state.workspace?.name || "本地";
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

  const isMac = state.platform.windowControl === "macos";

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const closeSessionSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const workActive =
    state.appSurface === "design" ||
    state.centerView === "history" ||
    state.centerView === "activity" ||
    state.centerView === "approvals";
  const extraActive =
    state.appSurface !== "design" &&
    (state.centerView === "usage" ||
      state.centerView === "skills" ||
      state.centerView === "mcp" ||
      state.centerView === "artifacts");

  useEffect(() => {
    if (workActive) setNavOpen((value) => (value.work ? value : { ...value, work: true }));
    if (extraActive) setNavOpen((value) => (value.extra ? value : { ...value, extra: true }));
  }, [workActive, extraActive]);

  const workItems: NavLeaf[] = [
    {
      id: "design",
      label: "设计",
      icon: <SidebarIconDesign size={20} />,
      active: state.appSurface === "design",
      onClick: () => state.setAppSurface("design"),
    },
    {
      id: "history",
      label: "历史",
      icon: <SidebarIconHistory size={20} />,
      active: state.appSurface !== "design" && state.centerView === "history",
      onClick: () => state.setCenterView("history"),
    },
    {
      id: "activity",
      label: "活动",
      icon: <SidebarIconActivity size={20} />,
      active: state.appSurface !== "design" && state.centerView === "activity",
      badge: state.queue.length || undefined,
      quiet: true,
      onClick: () => state.setCenterView("activity"),
    },
    {
      id: "approvals",
      label: "审批",
      icon: <SidebarIconApprovals size={20} />,
      active: state.appSurface !== "design" && state.centerView === "approvals",
      badge: pendingApprovals || undefined,
      onClick: () => state.setCenterView("approvals"),
    },
  ];
  const extraItems: NavLeaf[] = [
    {
      id: "usage",
      label: "用量",
      icon: <SidebarIconUsage size={20} />,
      active: state.appSurface !== "design" && state.centerView === "usage",
      dim: true,
      onClick: () => state.setCenterView("usage"),
    },
    {
      id: "skills",
      label: "技能",
      icon: <SidebarIconSkills size={20} />,
      active: state.appSurface !== "design" && state.centerView === "skills",
      dim: true,
      onClick: () => state.setCenterView("skills"),
    },
    {
      id: "mcp",
      label: "MCP",
      icon: <SidebarIconMcp size={20} />,
      active: state.appSurface !== "design" && state.centerView === "mcp",
      dim: true,
      onClick: () => state.setCenterView("mcp"),
    },
    {
      id: "artifacts",
      label: "产物",
      icon: <SidebarIconArtifacts size={20} />,
      active: state.appSurface !== "design" && state.centerView === "artifacts",
      dim: true,
      onClick: () => state.setCenterView("artifacts"),
    },
  ];

  return (
    <aside className={`left grok-sidebar ${rail ? "collapsed" : ""}`}>
      <div className="g-brand-row" data-tauri-drag-region>
        {isMac ? (
          <div className="mac-lights" data-tauri-drag-region>
            <span className="traffic">
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="sidebar-collapse"
            title={`收起侧栏 · ${state.platform.modifierKey} B`}
            aria-label={rail ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!rail}
            onClick={state.toggleLeft}
          >
            <SidebarIconPanel size={20} />
          </button>
        )}
        {!rail && (
          <div className="g-brand">
            <GrokStyleMark size={18} />
            <span>HerDock</span>
          </div>
        )}
        <span className="g-brand-grow" data-tauri-drag-region />
        {!rail && (
          <button
            type="button"
            className="chrome-btn"
            aria-label="搜索"
            title={`搜索 · ${state.platform.commandHint}`}
            onClick={state.togglePalette}
          >
            <SidebarIconSearch size={20} />
          </button>
        )}
        {isMac && (
          <button
            type="button"
            className="sidebar-collapse"
            title={`收起侧栏 · ${state.platform.modifierKey} B`}
            aria-label={rail ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!rail}
            onClick={state.toggleLeft}
          >
            <SidebarIconPanel size={20} />
          </button>
        )}
      </div>

      <nav className="g-nav">
        <button
          type="button"
          className="g-nav-item primary"
          aria-label="新建会话"
          title={`新建会话 · ${state.platform.newHint}`}
          onClick={() => void state.newSession()}
        >
          <span className="g-nav-ico">
            <SidebarIconPlus size={20} />
          </span>
          <span className="nav-text">新建会话</span>
        </button>
        <NavGroup
          label="工作台"
          icon={<SidebarIconGrid size={20} />}
          open={navOpen.work}
          onToggle={() => setNavOpen((value) => ({ ...value, work: !value.work }))}
          items={workItems}
          rail={rail}
        />
        <NavGroup
          label="扩展"
          icon={<SidebarIconBlocks size={20} />}
          open={navOpen.extra}
          onToggle={() => setNavOpen((value) => ({ ...value, extra: !value.extra }))}
          items={extraItems}
          rail={rail}
        />
        {rail && (
          <button
            type="button"
            className="g-nav-item"
            aria-label="搜索"
            title="搜索"
            onClick={state.togglePalette}
          >
            <span className="g-nav-ico">
              <SidebarIconSearch size={20} />
            </span>
          </button>
        )}
      </nav>

      {!rail && (
        <div
          className="g-tree"
          onContextMenu={(event) => {
            if (
              (event.target as HTMLElement).closest(
                "input, textarea, .session-row, .ws-row, .ws-actions",
              )
            )
              return;
            event.preventDefault();
          }}
        >
          <div className={`g-l1 ${searchOpen ? "searching" : ""}`}>
            <div className="g-l1-lead">
              <button
                type="button"
                className="g-l1-head"
                onClick={() => setProjectsOpen((v) => !v)}
                title={`项目 · ${projectsOpen ? "收起" : "展开"}`}
                tabIndex={searchOpen ? -1 : 0}
              >
                <span>项目</span>
              </button>
              <button
                type="button"
                className="g-l1-group"
                title={`会话分组方式，点击切换（当前：${GROUP_LABEL[state.groupMode]}）`}
                onClick={state.cycleGroupMode}
                tabIndex={searchOpen ? -1 : 0}
              >
                {GROUP_LABEL[state.groupMode]}
              </button>
            </div>
            <div className="g-l1-find">
              <button
                type="button"
                className={`g-l1-search ${searchOpen ? "on" : ""}`}
                title="搜索会话"
                aria-label="搜索会话"
                aria-expanded={searchOpen}
                onClick={() => {
                  if (searchOpen) searchInputRef.current?.focus();
                  else setSearchOpen(true);
                }}
              >
                <SidebarIconSearch size={16} />
              </button>
              <input
                ref={searchInputRef}
                className="g-l1-find-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeSessionSearch();
                  }
                }}
                placeholder="搜索会话"
                aria-label="搜索会话"
                tabIndex={searchOpen ? 0 : -1}
              />
              <button
                type="button"
                className="g-l1-find-cancel"
                title="取消搜索"
                aria-label="取消搜索"
                tabIndex={searchOpen ? 0 : -1}
                onClick={closeSessionSearch}
              >
                <SidebarIconClose size={14} />
              </button>
            </div>
            <button
              type="button"
              className="g-l1-add"
              title="打开文件夹，添加项目"
              aria-label="打开文件夹，添加项目"
              onClick={onOpenWorkspace}
            >
              <SidebarIconPlusBare size={16} />
            </button>
          </div>
          {projectsOpen &&
            workspaces.map((w) => {
              const collapsed = !!state.collapsedWorkspaces[w.id];
              const isActive = w.id === state.workspace?.id;
              const needle = query.trim().toLowerCase();
              const projectHit = !needle || w.name.toLowerCase().includes(needle);
              const allSessions = sortSessions(
                state.workspaceSessions[w.id] ||
                  (w.id === state.workspace?.id ? state.sessions : []),
              ).filter(
                (sess) =>
                  projectHit ||
                  sess.title.toLowerCase().includes(needle) ||
                  sess.id === state.renamingSessionId ||
                  sess.id === state.session?.id,
              );
              if (needle && !projectHit && !allSessions.length) return null;
              const activeSessions = allSessions.filter((sess) => !sess.archivedAt);
              const archivedSessions = allSessions.filter((sess) => sess.archivedAt);
              const buckets =
                state.groupMode === "time"
                  ? DAY_GROUPS.map((group) => ({
                      ...group,
                      items: activeSessions.filter(
                        (sess) =>
                          dayBucket(sessionTime(sess, latestRun(knownRuns, sess.id))) === group.key,
                      ),
                    })).filter((group) => group.items.length > 0)
                  : [];
              const showDayHeads = state.groupMode === "time" && buckets.length > 1;
              const showArchived = archivedSessions.length > 0 && (archivedOpen[w.id] || !!needle);
              const openProjectMenu = (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                setMenu({
                  kind: "project",
                  x: event.clientX,
                  y: event.clientY,
                  workspace: w,
                });
              };
              const renderRow = (sess: Session) => (
                <SessionRow
                  key={sess.id}
                  session={sess}
                  run={latestRun(knownRuns, sess.id)}
                  active={state.session?.id === sess.id}
                  renaming={state.renamingSessionId === sess.id}
                  onSelect={() => void state.selectSession(sess.id)}
                  onRename={(title) => void state.renameSession(sess.id, title)}
                  onBeginRename={() => state.beginRenameSession(sess.id)}
                  onCancelRename={() => state.beginRenameSession(null)}
                  onDelete={() => {
                    void askConfirm({
                      title: "删除会话？",
                      body: `删除会话「${sess.title}」？相关运行记录会一并去掉。`,
                      confirmLabel: "删除",
                      danger: true,
                    }).then((ok) => {
                      if (ok) void state.deleteSession(sess.id);
                    });
                  }}
                  onMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMenu({
                      kind: "session",
                      x: event.clientX,
                      y: event.clientY,
                      session: sess,
                    });
                  }}
                />
              );
              return (
                <div
                  className={`ws-block ${isActive ? "current" : ""}`}
                  key={w.id}
                  style={{ ["--ws-accent" as string]: accentFor(w.id) }}
                >
                  <div
                    className={`ws-row ${collapsed ? "" : "open"}`}
                    onContextMenu={openProjectMenu}
                  >
                    <button
                      type="button"
                      className={`g-l2 ${collapsed ? "" : "open"}`}
                      onClick={() => state.toggleWorkspaceCollapsed(w.id)}
                      title={w.rootPath || w.name}
                      aria-expanded={!collapsed}
                    >
                      <span className="ws-avatar" aria-hidden>
                        {(w.name || "?").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="ws-text">
                        <span className="ws-name">{w.name}</span>
                      </span>
                    </button>
                    <span className="ws-meta" aria-hidden>
                      {activeSessions.length > 1 && (
                        <span className="ws-count">{activeSessions.length}</span>
                      )}
                      <span className="ws-caret">
                        <SidebarIconCaret size={15} />
                      </span>
                    </span>
                    <span className="ws-actions">
                      <button
                        type="button"
                        title="新建会话"
                        aria-label={`在 ${w.name} 新建会话`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void state.newSession(w.id);
                        }}
                      >
                        <SidebarIconPlusBare size={15} />
                      </button>
                      <button
                        type="button"
                        title="更多"
                        aria-label={`${w.name} 更多`}
                        onClick={openProjectMenu}
                      >
                        <SidebarIconDots size={16} />
                      </button>
                    </span>
                  </div>
                  {isActive && !collapsed && (w.branch || w.dirtySummary) && (
                    <p className="ws-sub-line" title={w.rootPath}>
                      {w.branch && <span className="ws-branch">{w.branch}</span>}
                      {w.dirtySummary && <span className="ws-diff">{w.dirtySummary}</span>}
                    </p>
                  )}
                  {!collapsed && activeSessions.length > 0 && (
                    <div className="g-l3-list">
                      {showDayHeads
                        ? buckets.map((group) => (
                            <Fragment key={group.key}>
                              <div className="g-day-head">{group.label}</div>
                              {group.items.map(renderRow)}
                            </Fragment>
                          ))
                        : activeSessions.map(renderRow)}
                    </div>
                  )}
                  {!collapsed && archivedSessions.length > 0 && (
                    <div className="g-archived">
                      <button
                        type="button"
                        className="g-archived-head"
                        onClick={() =>
                          setArchivedOpen((current) => ({
                            ...current,
                            [w.id]: !current[w.id],
                          }))
                        }
                        aria-expanded={showArchived}
                      >
                        已归档
                        <span>{archivedSessions.length}</span>
                      </button>
                      {showArchived && (
                        <div className="g-l3-list">{archivedSessions.map(renderRow)}</div>
                      )}
                    </div>
                  )}
                  {!collapsed && !activeSessions.length && !archivedSessions.length && (
                    <p className="g-empty">
                      尚无会话
                      <button type="button" onClick={() => void state.newSession(w.id)}>
                        新建
                      </button>
                    </p>
                  )}
                </div>
              );
            })}
          {projectsOpen && !workspaces.length && (
            <p className="g-empty">还没有项目。点 + 打开本地文件夹。</p>
          )}
        </div>
      )}

      <button
        type="button"
        className={`g-account ${state.settingsOpen ? "active" : ""}`}
        title={`设置 · ${accountName}${state.hostOnline ? " · 本地核心已连接" : " · 核心未连接"}`}
        onClick={() => state.setSettingsOpen(true)}
      >
        <span className="g-avatar">{accountName.slice(0, 1)}</span>
        {!rail && (
          <span className="g-account-text">
            <span className="g-account-name">{accountName}</span>
            <span className="g-account-sub">
              {state.hostOnline ? "本地核心 · 已连接" : "本地核心 · 未连接"}
            </span>
          </span>
        )}
        {!rail && (
          <span className="g-account-gear" aria-hidden>
            <SidebarIconGear size={18} />
          </span>
        )}
      </button>

      {!rail && (
        <PanelSash
          label="调节左侧栏宽度"
          value={state.leftWidth}
          onChange={state.setLeftWidth}
          onReset={state.resetLeftWidth}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={
            menu.kind === "session"
              ? sessionMenu(menu.session, state, askConfirm)
              : projectMenu(menu.workspace, state, onOpenWorkspace, askConfirm)
          }
        />
      )}
      {confirmLayer}
    </aside>
  );
}

function sessionMenu(
  session: Session,
  state: {
    beginRenameSession: (id: string | null) => void;
    deleteSession: (id: string) => Promise<void>;
    forkSession: (beforeSeq?: number, sourceId?: string) => Promise<void>;
    archiveSession: (id: string) => Promise<void>;
    unarchiveSession: (id: string) => Promise<void>;
    selectSession: (id: string) => Promise<void>;
  },
  askConfirm: (options: {
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>,
): ContextMenuItem[] {
  const archived = Boolean(session.archivedAt);
  return [
    {
      id: "open",
      label: "打开",
      onSelect: () => void state.selectSession(session.id),
    },
    {
      id: "rename",
      label: "重命名",
      icon: <PencilSimple {...MENU_ICO} />,
      onSelect: () => {
        window.setTimeout(() => state.beginRenameSession(session.id), 0);
      },
    },
    {
      id: "fork",
      label: "分叉",
      icon: <GitFork {...MENU_ICO} />,
      onSelect: () => void state.forkSession(undefined, session.id),
    },
    archived
      ? {
          id: "unarchive",
          label: "取消归档",
          icon: <ArrowCounterClockwise {...MENU_ICO} />,
          onSelect: () => void state.unarchiveSession(session.id),
        }
      : {
          id: "archive",
          label: "归档",
          icon: <Archive {...MENU_ICO} />,
          onSelect: () => void state.archiveSession(session.id),
        },
    { id: "sep-delete", type: "separator" },
    {
      id: "delete",
      label: "删除会话",
      danger: true,
      icon: <SidebarIconTrash size={15} />,
      onSelect: () => {
        void askConfirm({
          title: "删除会话？",
          body: `删除会话「${session.title}」？相关运行记录会一并去掉。`,
          confirmLabel: "删除",
          danger: true,
        }).then((ok) => {
          if (ok) void state.deleteSession(session.id);
        });
      },
    },
  ];
}

function projectMenu(
  workspace: Workspace,
  state: {
    newSession: (workspaceId?: string) => Promise<void>;
    openWorkspacePath: (path: string) => Promise<void>;
    deleteWorkspace: (id: string) => Promise<void>;
  },
  onOpenWorkspace: () => void,
  askConfirm: (options: {
    title: string;
    body: string;
    confirmLabel: string;
    danger: boolean;
  }) => Promise<boolean>,
): ContextMenuItem[] {
  return [
    {
      id: "new-session",
      label: "新建会话",
      icon: <SidebarIconPlusBare size={15} />,
      onSelect: () => void state.newSession(workspace.id),
    },
    {
      id: "open",
      label: "打开项目",
      icon: <FolderOpen {...MENU_ICO} />,
      onSelect: () => void state.openWorkspacePath(workspace.rootPath),
    },
    {
      id: "reveal",
      label: "在资源管理器中显示",
      icon: <FolderOpen {...MENU_ICO} />,
      onSelect: () => {
        void hostApi.revealWorkspace(workspace.id).catch((error) => {
          console.error(error);
        });
      },
    },
    {
      id: "copy-path",
      label: "复制路径",
      icon: <CopySimple {...MENU_ICO} />,
      onSelect: () => {
        void navigator.clipboard?.writeText(workspace.rootPath);
      },
    },
    { id: "sep-add", type: "separator" },
    {
      id: "add-folder",
      label: "打开其他文件夹…",
      onSelect: onOpenWorkspace,
    },
    { id: "sep-delete", type: "separator" },
    {
      id: "delete",
      label: "删除项目",
      danger: true,
      icon: <SidebarIconTrash size={15} />,
      onSelect: () => {
        void askConfirm({
          title: "删除项目？",
          body: `从工作台移除「${workspace.name}」？磁盘上的文件夹不会删除，该项目下的会话和运行记录会一并去掉。`,
          confirmLabel: "删除",
          danger: true,
        }).then((ok) => {
          if (ok) void state.deleteWorkspace(workspace.id);
        });
      },
    },
  ];
}

/** Short stamp for a thread row — 14:32 today, 8月4日 for older days. */
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

/** Coarse recency bucket for the thread-list's "Today"-style section heads. */
function dayBucket(iso?: string): "today" | "week" | "older" {
  if (!iso) return "older";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "older";
  const age = Date.now() - time;
  if (age < 86400000) return "today";
  if (age < 7 * 86400000) return "week";
  return "older";
}

const DAY_GROUPS: { key: "today" | "week" | "older"; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "week", label: "7 天内" },
  { key: "older", label: "更早" },
];

function sessionTime(session: Session, run?: Run): string {
  return run?.updatedAt || session.updatedAt || session.createdAt || "";
}

/** Statuses worth a dot; finished threads stay quiet like assistant-ui's unread rule. */
const NOTABLE_STATUSES = new Set([
  "running",
  "starting",
  "queued",
  "waiting_approval",
  "waiting_human",
  "failed",
  "cancelled",
  "interrupted",
]);

function SessionRow({
  session,
  run,
  active,
  renaming,
  onSelect,
  onRename,
  onBeginRename,
  onCancelRename,
  onDelete,
  onMenu,
}: {
  session: Session;
  run?: Run;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onBeginRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onMenu: (event: MouseEvent) => void;
}) {
  const [value, setValue] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!renaming) return;
    setValue(session.title);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming, session.title]);

  if (renaming) {
    return (
      <form
        className={`session-row editing ${active ? "active" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          const next = value.trim();
          if (next && next !== session.title) onRename(next);
          else onCancelRename();
        }}
      >
        <input
          ref={inputRef}
          value={value}
          aria-label="会话名称"
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            const next = value.trim();
            if (next && next !== session.title) onRename(next);
            else onCancelRename();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancelRename();
            }
          }}
        />
      </form>
    );
  }

  const status = run?.status || "";
  const archived = Boolean(session.archivedAt);
  const showDot = !active && !archived && NOTABLE_STATUSES.has(status);
  const stamp = sessionStamp(run?.updatedAt || session.updatedAt || session.createdAt);

  return (
    <div
      className={`session-row ${active ? "active" : ""} ${archived ? "archived" : ""}`}
      role="button"
      tabIndex={0}
      aria-current={active || undefined}
      onClick={onSelect}
      onDoubleClick={(event) => {
        event.preventDefault();
        onBeginRename();
      }}
      onContextMenu={onMenu}
      onKeyDown={(event) => {
        if (event.key === "F2") {
          event.preventDefault();
          onBeginRename();
        } else if (event.key === "Enter") {
          onSelect();
        } else if (event.key === "Delete") {
          event.preventDefault();
          onDelete();
        }
      }}
      title={session.title}
    >
      {showDot && <span className={`run-dot ${status}`} aria-hidden />}
      <span className="name">{session.title}</span>
      <span className="row-aside">
        <span className="row-time" aria-hidden>
          {stamp && <time>{stamp}</time>}
        </span>
        <span className="row-actions">
          <button
            type="button"
            title="更多操作"
            aria-label={`${session.title} 更多操作`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMenu(event);
            }}
          >
            <SidebarIconDots size={16} />
          </button>
          <button
            type="button"
            className="danger"
            title="删除会话"
            aria-label={`删除会话 ${session.title}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }}
          >
            <SidebarIconTrash size={15} />
          </button>
        </span>
      </span>
    </div>
  );
}

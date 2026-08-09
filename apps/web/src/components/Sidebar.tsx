import { APP_DISPLAY_NAME } from "@her-dock/shared";
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
  const s = useWorkbench();
  const workspaces: Workspace[] = s.workspaces.length
    ? s.workspaces
    : s.workspace
      ? [s.workspace]
      : [];
  const pendingApprovals = s.approvals.length;
  const liveRuns = s.queue.length;

  const knownRuns = s.allRuns.length ? s.allRuns : s.runs;
  const sortSessions = (list: Session[]): Session[] => {
    const copy = [...list];
    if (s.groupMode === "name") return copy.sort((a, b) => a.title.localeCompare(b.title, "zh"));
    if (s.groupMode === "status") {
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
      {s.platform.chrome === "mac" && (
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
        <div className="brand-name">行知</div>
        <button
          type="button"
          className="icon-btn push"
          title="搜索 / 命令面板"
          onClick={s.togglePalette}
        >
          <IconSearch />
        </button>
      </div>

      <div className="nav-group">
        <button type="button" className="nav-item" onClick={() => void s.newSession()}>
          <IconCompose />
          <span>新建会话</span>
          <span className="hint">{s.platform.newHint}</span>
        </button>
        <button
          type="button"
          className={`nav-item ${s.centerView === "activity" ? "active" : ""}`}
          onClick={() => s.setCenterView("activity")}
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
          onClick={s.cycleGroupMode}
          title="切换分组方式"
        >
          {GROUP_LABEL[s.groupMode]}
          <IconChevron size={9} />
        </button>
        <button type="button" className="icon-btn" onClick={onOpenWorkspace} title="打开文件夹">
          <IconPlus size={11} />
        </button>
      </div>

      <div className="ws-scroll">
        {workspaces.map((w) => {
          const collapsed = !!s.collapsedWorkspaces[w.id];
          const sessions = sortSessions(s.workspaceSessions[w.id] || (w.id === s.workspace?.id ? s.sessions : []));
          return (
            <div className="ws-block" key={w.id}>
              <button
                type="button"
                className={`ws-head ${collapsed ? "collapsed" : ""}`}
                onClick={() => s.toggleWorkspaceCollapsed(w.id)}
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
                    className={`session-row ${s.session?.id === sess.id ? "active" : ""}`}
                    onClick={() => void s.selectSession(sess.id)}
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
          className={`nav-item ${s.sideTab === "skills" ? "active" : ""}`}
          onClick={() => s.setSideTab("skills")}
        >
          <IconSkills />
          <span>技能</span>
          <span className="hint">{s.skills.length || ""}</span>
        </button>
        <button
          type="button"
          className={`nav-item ${s.sideTab === "approvals" ? "active" : ""}`}
          onClick={() => s.setSideTab("approvals")}
        >
          <IconConnector />
          <span>连接器</span>
          <span className={`hint ${pendingApprovals ? "warn" : ""}`}>
            {pendingApprovals || s.connectors.length || ""}
          </span>
        </button>
        <button
          type="button"
          className={`nav-item ${s.sideTab === "cost" ? "active" : ""}`}
          onClick={() => s.setSideTab("cost")}
        >
          <IconFile />
          <span>产物库</span>
          <span className="hint">{s.artifacts.length || ""}</span>
        </button>
      </div>

      <div className="user-card">
        <button type="button" className="inner" onClick={() => s.setSideTab("cost")}>
          <div className="avatar">开</div>
          <div style={{ minWidth: 0 }}>
            <div className="user-name">{APP_DISPLAY_NAME}</div>
            <div className="user-meta">
              {s.hostOnline ? `${(s.usage?.credits ?? 0).toLocaleString()} CREDITS` : "离线 FIXTURE"}
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

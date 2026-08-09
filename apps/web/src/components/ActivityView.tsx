import { RUN_STATUS_LABELS, type RunStatus } from "@her-dock/agent-protocol";
import type { Run } from "../host/client";
import { useWorkbench } from "../store/workbench";

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
  const s = useWorkbench();
  const runs = s.allRuns.length ? s.allRuns : s.runs.length ? s.runs : s.run ? [s.run] : [];
  const groups = groupRuns(runs);
  const wsName = (id: string) => s.workspaces.find((w) => w.id === id)?.name || id;

  if (!groups.length) {
    return (
      <div className="activity">
        <div className="empty-hint">还没有运行记录。发送一个任务后，这里会按天汇总所有 run。</div>
      </div>
    );
  }

  return (
    <div className="activity">
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
              <button
                key={r.id}
                type="button"
                className="act-card"
                onClick={() => void s.selectSession(r.sessionId)}
              >
                <span className={`act-rail ${r.status}`} />
                <div className="act-body">
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
                    {r.errorMessage || `${wsName(r.workspaceId)} · ${r.providerId}`}
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
                </div>
              </button>
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

import { RUN_STATUS_LABELS, type RunStatus } from "@her-dock/agent-protocol";
import { useWorkbench, type SideTab } from "../store/workbench";
import { FileTree } from "./FileTree";

const SIDE_TABS: [SideTab, string][] = [
  ["workspace", "工作区"],
  ["approvals", "审批"],
  ["context", "上下文"],
  ["skills", "技能"],
  ["cost", "用量"],
];

const SKILL_STATUS: Record<string, string> = {
  enabled: "已启用",
  readonly: "只读",
  limited: "受限",
  disabled: "已停用",
};

const CONNECTOR_STATUS: Record<string, string> = {
  connected: "已连接",
  expired: "已过期",
  disconnected: "未连接",
};

export function RightPanel() {
  const s = useWorkbench();

  return (
    <aside className="right">
      <div className="side-tabs">
        {SIDE_TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={s.sideTab === k ? "active" : ""}
            onClick={() => s.setSideTab(k)}
          >
            {label}
            {k === "approvals" && s.approvals.length ? ` ${s.approvals.length}` : ""}
          </button>
        ))}
      </div>

      {s.sideTab === "workspace" && <WorkspaceTab />}
      {s.sideTab === "approvals" && <ApprovalsTab />}
      {s.sideTab === "context" && <ContextTab />}
      {s.sideTab === "skills" && <SkillsTab />}
      {s.sideTab === "cost" && <CostTab />}
    </aside>
  );
}

function WorkspaceTab() {
  const s = useWorkbench();
  return (
    <div className="side-body">
      <div className="side-meta">
        <span>{s.workspace?.name || "未打开工作区"}</span>
        {s.workspace?.dirtySummary && <span className="diff">{s.workspace.dirtySummary}</span>}
      </div>
      {s.tree.length ? (
        <FileTree nodes={s.tree} active={s.openFile} onOpen={(p) => void s.openPath(p)} />
      ) : (
        <div className="empty-hint">工作区为空，或还没有连接 Host。</div>
      )}
    </div>
  );
}

function ApprovalsTab() {
  const s = useWorkbench();
  return (
    <div className="side-body padded">
      {s.approvals.map((a) => (
        <div className="appr-card" key={a.approvalId}>
          <div className="appr-title">
            <span>{a.title}</span>
            <span className={`risk ${riskClass(a.risk)}`}>{riskLabel(a.risk)}</span>
          </div>
          <div className="appr-detail">{a.detail}</div>
          <div className="appr-from">
            {a.runId} · {a.kind}
          </div>
          <div className="appr-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void s.resolveApproval(a.approvalId, "approve_once")}
            >
              批准一次
            </button>
            <button
              type="button"
              onClick={() => void s.resolveApproval(a.approvalId, "always_allow")}
            >
              始终允许
            </button>
            <button type="button" onClick={() => void s.resolveApproval(a.approvalId, "deny")}>
              拒绝
            </button>
          </div>
        </div>
      ))}
      {s.approvals.length > 0 && (
        <div className="side-note">「始终允许」会写进工作区规则，之后同类动作不再询问。</div>
      )}

      <div>
        <div className="side-title">连接器</div>
        <div className="panel-card">
          {s.connectors.map((c) => (
            <div className="conn-row" key={c.id}>
              <span>{c.name}</span>
              <span className="val">{c.scopes.join(" / ") || "—"}</span>
              <span className={`st ${c.status}`}>{CONNECTOR_STATUS[c.status] || c.status}</span>
            </div>
          ))}
          {!s.connectors.length && <div className="empty-hint">Host 在线后显示连接器。</div>}
        </div>
      </div>

      {!s.approvals.length && (
        <div className="side-note">当前没有待审批的动作。风险动作会在这里等待你确认。</div>
      )}
    </div>
  );
}

function ContextTab() {
  const s = useWorkbench();
  const ctx = s.context;
  const used = s.usage?.context.used ?? 0;
  const limit = s.usage?.context.limit ?? 200000;
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));

  return (
    <div className="side-body padded">
      <div>
        <div className="side-title">已加载上下文</div>
        <div className="stack">
          {(ctx?.files || []).map((f) => (
            <button
              key={f.path}
              type="button"
              className="ctx-row"
              onClick={() => void s.openPath(f.path)}
            >
              <span className={`kind-tag ${f.kind}`}>{kindLabel(f.kind)}</span>
              <span className="ctx-path">{f.path}</span>
              <span className="ctx-size">{f.size}</span>
            </button>
          ))}
          {!ctx?.files.length && (
            <div className="empty-hint">未识别到上下文文件。可在 xingzhi.yml 里声明 rules 与 dataGlobs。</div>
          )}
        </div>
      </div>

      <div>
        <div className="side-title">工作区规则</div>
        <div className="panel-card pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(ctx?.rules || []).map((r, i) => (
            <div className="rule-line" key={i}>
              <i />
              <span>{r}</span>
            </div>
          ))}
          {!ctx?.rules.length && <div className="rule-line"><i /><span>暂无规则文件。</span></div>}
        </div>
      </div>

      <div>
        <div className="side-title">上下文占用</div>
        <div className="panel-card pad">
          <div className="meter-value">
            <b>{formatTokens(used)}</b>
            <span>/ {formatTokens(limit)} tokens</span>
          </div>
          <div className="meter">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillsTab() {
  const s = useWorkbench();
  return (
    <div className="side-body padded">
      <div className="stack">
        {s.skills.map((sk) => (
          <div className="skill-card" key={sk.id}>
            <div className="skill-head">
              <span className="skill-glyph">{sk.glyph}</span>
              <span className="skill-name">{sk.name}</span>
              <span className={`st ${sk.status}`}>{SKILL_STATUS[sk.status] || sk.status}</span>
            </div>
            <div className="skill-desc">{sk.detail}</div>
          </div>
        ))}
        {!s.skills.length && <div className="empty-hint">Host 在线后显示可用技能。</div>}
      </div>
    </div>
  );
}

function CostTab() {
  const s = useWorkbench();
  const providers = s.providers;

  return (
    <div className="side-body padded">
      <div>
        <div className="side-title">算力用量</div>
        <div className="stack">
          {(s.usage?.buckets || []).map((b) => {
            const pct = b.limit
              ? Math.min(100, Math.round((b.tokens / b.limit) * 100))
              : Math.min(100, Math.round((b.tokens / 200000) * 100));
            return (
              <div className="usage-card" key={b.key}>
                <div className="usage-top">
                  <span className="k">{b.label}</span>
                  <span className="v">
                    {b.limit ? `${formatTokens(b.tokens)} / ${formatTokens(b.limit)}` : formatTokens(b.tokens)}
                  </span>
                </div>
                <div className="meter">
                  <i
                    style={{
                      width: `${pct}%`,
                      background: b.key === "month" ? "var(--warn)" : b.key === "today" ? "var(--ok)" : "var(--accent)",
                    }}
                  />
                </div>
                <div className="usage-sub">
                  {b.runs} 次运行 · {b.calls} 个事件
                </div>
              </div>
            );
          })}
          {!s.usage && <div className="empty-hint">Host 在线后统计 token 与运行次数。</div>}
        </div>
      </div>

      <div>
        <div className="side-title">运行环境</div>
        <div className="panel-card">
          <div className="conn-row">
            <span>平台</span>
            <span className="val">
              {s.platform.os} · {s.platform.defaultShell}
            </span>
            <span className={`st ${s.hostOnline ? "ready" : "missing"}`}>
              {s.hostOnline ? "就绪" : "离线"}
            </span>
          </div>
          {providers.map((p) => (
            <div className="conn-row" key={p.id}>
              <span>{p.displayName}</span>
              <span className="val">{p.version || p.detail || p.path || "—"}</span>
              <span className={`st ${p.available ? "ready" : "missing"}`}>
                {p.available ? "就绪" : "未安装"}
              </span>
            </div>
          ))}
          <div className="conn-row">
            <span>沙箱</span>
            <span className="val">{s.policy?.label || "本地工作区"}</span>
            <span className="st limited">受限</span>
          </div>
          <div className="conn-row">
            <span>网络</span>
            <span className="val">
              {s.policy?.networkDefaultDeny === false ? "默认允许" : "默认拒绝"}
            </span>
            <span className={`st ${s.policy?.networkDefaultDeny === false ? "ready" : "limited"}`}>
              {s.policy?.networkDefaultDeny === false ? "开放" : "受限"}
            </span>
          </div>
        </div>
      </div>

      <div>
        <div className="side-title">定时任务</div>
        <div className="panel-card">
          {s.schedules.map((sc) => (
            <div className="sched-row" key={sc.id}>
              <div className="sched-top">
                <span className="sched-name">{sc.name}</span>
                <button
                  type="button"
                  className={`toggle ${sc.enabled ? "on" : ""}`}
                  onClick={() => void s.toggleSchedule(sc.id)}
                  title={sc.enabled ? "已启用" : "已暂停"}
                >
                  <i />
                </button>
              </div>
              <div className="sched-meta">
                <span className="cron" title={sc.cron}>
                  {cronLabel(sc.cron)}
                </span>
                <span className="sched-next">
                  {sc.enabled ? `下次 ${formatNext(sc.nextRunAt)}` : "已暂停"}
                </span>
              </div>
            </div>
          ))}
          {!s.schedules.length && (
            <div className="empty-hint">还没有定时任务。可用 Host 的 /v1/schedules 创建。</div>
          )}
        </div>
      </div>

      <div>
        <div className="side-title">本次会话产物</div>
        <div className="stack">
          {s.artifacts.map((a) => (
            <button
              key={a.id}
              type="button"
              className="art-row"
              onClick={() => void s.openPath(a.path)}
            >
              <span className={`ext ${a.ext}`}>{(a.ext || "·").slice(0, 4)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="art-name">{a.name}</div>
                <div className="art-meta">
                  {a.sizeBytes ? formatBytes(a.sizeBytes) : "—"} · {a.path}
                </div>
              </div>
            </button>
          ))}
          {!s.artifacts.length && <div className="empty-hint">暂无产物（out/ 目录为空）。</div>}
        </div>
      </div>

      {s.run && (
        <div>
          <div className="side-title">当前运行</div>
          <div className="panel-card">
            <div className="conn-row">
              <span>{s.run.id}</span>
              <span className="val">{s.run.planProgress || "—"}</span>
              <span className={`st ${s.run.status}`}>
                {RUN_STATUS_LABELS[s.run.status as RunStatus] || s.run.status}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function kindLabel(kind: string): string {
  return { rule: "规则", data: "数据", code: "代码", config: "配置" }[kind] || kind;
}

function riskLabel(risk: string): string {
  return { low: "低", medium: "中", high: "高" }[risk] || risk;
}

function riskClass(risk: string): string {
  return risk === "low" ? "low" : risk === "high" ? "high" : "";
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** Render a 5-field cron as the Chinese label used in the design (每天 07:00 …). */
function cronLabel(cron: string): string {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = f;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return cron;
  const at = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") return `每天 ${at}`;
  if (dom === "*" && mon === "*" && /^\d$/.test(dow)) return `每周${WEEKDAYS[Number(dow)]} ${at}`;
  if (/^\d+$/.test(dom) && mon === "*" && dow === "*") return `每月 ${dom} 日 ${at}`;
  return cron;
}

function formatNext(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

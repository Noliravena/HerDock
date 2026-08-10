import { useState } from "react";
import {
  CalendarPlus,
  DownloadSimple,
  FilePlus,
  FolderOpen,
  FolderPlus,
  MagnifyingGlass,
  Paperclip,
  PencilSimple,
  Power,
  Trash,
  X,
} from "@phosphor-icons/react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { RUN_STATUS_LABELS, type RunStatus } from "@her-dock/agent-protocol";
import { useShallow } from "zustand/react/shallow";
import { hostApi, type SearchResult } from "../host/client";
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
  const { approvalCount, setSideTab, sideTab } = useWorkbench(
    useShallow((state) => ({
      approvalCount: state.approvals.length,
      setSideTab: state.setSideTab,
      sideTab: state.sideTab,
    })),
  );

  return (
    <aside className="right-panel">
      <div className="side-tabs">
        {SIDE_TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={sideTab === k ? "active" : ""}
            onClick={() => setSideTab(k)}
          >
            {label}
            {k === "approvals" && approvalCount ? ` ${approvalCount}` : ""}
          </button>
        ))}
      </div>

      {sideTab === "workspace" && <WorkspaceTab />}
      {sideTab === "approvals" && <ApprovalsTab />}
      {sideTab === "context" && <ContextTab />}
      {sideTab === "skills" && <SkillsTab />}
      {sideTab === "cost" && <CostTab />}
    </aside>
  );
}

function WorkspaceTab() {
  const { openFile, openPath, refreshTree, tree, workspace } = useWorkbench(
    useShallow((state) => ({
      openFile: state.openFile,
      openPath: state.openPath,
      refreshTree: state.refreshTree,
      tree: state.tree,
      workspace: state.workspace,
    })),
  );
  const [mode, setMode] = useState<"search" | "file" | "dir" | "rename" | null>(null);
  const [value, setValue] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const submit = async () => {
    if (!workspace || !value.trim() || !mode) return;
    try {
      if (mode === "search") {
        setResults(await hostApi.searchFiles(workspace.id, value));
        return;
      }
      if (mode === "rename" && openFile) await hostApi.renameFile(workspace.id, openFile, value);
      else await hostApi.createFile(workspace.id, value, mode === "dir" ? "dir" : "file");
      setMode(null);
      setValue("");
      await refreshTree();
      if (mode === "rename") await openPath(value);
    } catch (error) {
      useWorkbench.setState({ error: String(error) });
    }
  };
  const chooseMode = (next: typeof mode) => {
    setMode(next);
    setValue(next === "rename" ? openFile || "" : "");
    setResults([]);
  };
  return (
    <div className="side-body">
      <div className="side-meta">
        <span>{workspace?.name || "未打开工作区"}</span>
        {workspace?.dirtySummary && <span className="diff">{workspace.dirtySummary}</span>}
      </div>
      <div className="workspace-tools">
        <button type="button" title="搜索文件" onClick={() => chooseMode("search")}>
          <MagnifyingGlass size={13} />
        </button>
        <button type="button" title="新建文件" onClick={() => chooseMode("file")}>
          <FilePlus size={13} />
        </button>
        <button type="button" title="新建文件夹" onClick={() => chooseMode("dir")}>
          <FolderPlus size={13} />
        </button>
        <span />
        <button
          type="button"
          title="重命名当前文件"
          disabled={!openFile}
          onClick={() => chooseMode("rename")}
        >
          <PencilSimple size={13} />
        </button>
        <button
          type="button"
          title="删除当前文件"
          disabled={!openFile}
          onClick={() => {
            if (!workspace || !openFile || !window.confirm(`确认删除 ${openFile}？`)) return;
            void hostApi
              .deleteFile(workspace.id, openFile)
              .then(() => {
                useWorkbench.setState({
                  openFile: null,
                  fileContent: "",
                  centerView: "chat",
                  activeTab: "chat",
                });
                return refreshTree();
              })
              .catch((error) => useWorkbench.setState({ error: String(error) }));
          }}
        >
          <Trash size={13} />
        </button>
      </div>
      {mode && (
        <div className="workspace-input">
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void submit()}
            placeholder={
              mode === "search"
                ? "搜索文件或内容"
                : mode === "rename"
                  ? "新的相对路径"
                  : mode === "dir"
                    ? "文件夹相对路径"
                    : "文件相对路径"
            }
          />
          <button type="button" onClick={() => void submit()}>
            {mode === "search" ? "搜索" : "确认"}
          </button>
        </div>
      )}
      {results.length > 0 && (
        <div className="workspace-results">
          {results.map((result) => (
            <button
              type="button"
              key={`${result.path}:${result.line}`}
              onClick={() => void openPath(result.path)}
            >
              <span>
                {result.path}
                {result.line ? `:${result.line}` : ""}
              </span>
              <small>{result.preview}</small>
            </button>
          ))}
        </div>
      )}
      {tree.length ? (
        <FileTree nodes={tree} active={openFile} onOpen={(p) => void openPath(p)} />
      ) : (
        <div className="empty-hint">工作区为空，或尚未打开本地文件夹。</div>
      )}
    </div>
  );
}

function ApprovalsTab() {
  const {
    approvals,
    connectors,
    resolveApproval,
    selectedMcpIds,
    toggleMcpRuntime,
    toggleMcpSelection,
  } = useWorkbench(
    useShallow((state) => ({
      approvals: state.approvals,
      connectors: state.connectors,
      resolveApproval: state.resolveApproval,
      selectedMcpIds: state.selectedMcpIds,
      toggleMcpRuntime: state.toggleMcpRuntime,
      toggleMcpSelection: state.toggleMcpSelection,
    })),
  );
  return (
    <div className="side-body padded">
      {approvals.map((a) => (
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
              onClick={() => void resolveApproval(a.approvalId, "approve_once")}
            >
              批准一次
            </button>
            <button
              type="button"
              onClick={() => void resolveApproval(a.approvalId, "always_allow")}
            >
              始终允许
            </button>
            <button type="button" onClick={() => void resolveApproval(a.approvalId, "deny")}>
              拒绝
            </button>
          </div>
        </div>
      ))}
      {approvals.length > 0 && (
        <div className="side-note">「始终允许」会写进工作区规则，之后同类动作不再询问。</div>
      )}

      <div>
        <div className="side-title">本地 MCP</div>
        <div className="panel-card">
          {connectors.map((c) => (
            <div className="conn-row" key={c.id}>
              <input
                type="checkbox"
                checked={selectedMcpIds.includes(c.id)}
                disabled={c.status !== "ready" && c.status !== "connected"}
                onChange={() => toggleMcpSelection(c.id)}
                title="用于本次运行"
              />
              <span>{c.name}</span>
              <span className="val">{c.scopes.join(" / ") || "—"}</span>
              <span className={`st ${c.status}`}>{CONNECTOR_STATUS[c.status] || c.status}</span>
              <button
                type="button"
                className="icon-btn small"
                title={c.status === "ready" || c.status === "connected" ? "停止" : "启动"}
                onClick={() =>
                  void toggleMcpRuntime(c.id, c.status !== "ready" && c.status !== "connected")
                }
              >
                <Power size={12} />
              </button>
            </div>
          ))}
          {!connectors.length && (
            <div className="empty-hint">尚未配置本地 MCP 服务，可在设置中添加。</div>
          )}
        </div>
      </div>

      {!approvals.length && (
        <div className="side-note">当前没有待审批的动作。风险动作会在这里等待你确认。</div>
      )}
    </div>
  );
}

function ContextTab() {
  const state = useWorkbench(
    useShallow((s) => ({
      context: s.context,
      contextItems: s.contextItems,
      importContextPaths: s.importContextPaths,
      openPath: s.openPath,
      removeContextItem: s.removeContextItem,
      selectedContextIds: s.selectedContextIds,
      toggleContextItem: s.toggleContextItem,
      usage: s.usage,
    })),
  );
  const ctx = state.context;
  const used = state.usage?.context.used ?? 0;
  const limit = state.usage?.context.limit ?? 200000;
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const pickAttachments = async () => {
    const paths = await open({ multiple: true, directory: false, title: "添加文本上下文" });
    const selected = typeof paths === "string" ? [paths] : paths || [];
    if (selected.length) await state.importContextPaths(selected);
  };

  return (
    <div className="side-body padded">
      <div>
        <div className="side-title side-title-actions">
          <span>会话附件</span>
          <button type="button" title="添加文本附件" onClick={() => void pickAttachments()}>
            <Paperclip size={13} />
          </button>
        </div>
        <div className="stack">
          {state.contextItems.map((item) => (
            <div
              className={`context-item ${state.selectedContextIds.includes(item.id) ? "selected" : ""}`}
              key={item.id}
            >
              <label>
                <input
                  type="checkbox"
                  checked={state.selectedContextIds.includes(item.id)}
                  onChange={() => state.toggleContextItem(item.id)}
                />
                <span>
                  <b>{item.displayName}</b>
                  <small>
                    {item.sourceKind === "workspace"
                      ? item.relativePath
                      : `${formatBytes(item.sizeBytes)} · 已复制`}
                  </small>
                </span>
              </label>
              <button
                type="button"
                className="icon-btn small"
                title="移除附件"
                onClick={() => void state.removeContextItem(item.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {!state.contextItems.length && (
            <div className="empty-hint">可添加 UTF-8 文本，单文件不超过 2 MiB。</div>
          )}
        </div>
      </div>
      <div>
        <div className="side-title">已加载上下文</div>
        <div className="stack">
          {(ctx?.files || []).map((f) => (
            <button
              key={f.path}
              type="button"
              className="ctx-row"
              onClick={() => void state.openPath(f.path)}
            >
              <span className={`kind-tag ${f.kind}`}>{kindLabel(f.kind)}</span>
              <span className="ctx-path">{f.path}</span>
              <span className="ctx-size">{f.size}</span>
            </button>
          ))}
          {!ctx?.files.length && (
            <div className="empty-hint">
              未识别到上下文文件。可在 herdock.yml 里声明 rules 与 dataGlobs。
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="side-title">工作区规则</div>
        <div
          className="panel-card pad"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {(ctx?.rules || []).map((r, i) => (
            <div className="rule-line" key={i}>
              <i />
              <span>{r}</span>
            </div>
          ))}
          {!ctx?.rules.length && (
            <div className="rule-line">
              <i />
              <span>暂无规则文件。</span>
            </div>
          )}
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
  const { selectedSkillIds, skills, toggleSkill } = useWorkbench(
    useShallow((state) => ({
      selectedSkillIds: state.selectedSkillIds,
      skills: state.skills,
      toggleSkill: state.toggleSkill,
    })),
  );
  return (
    <div className="side-body padded">
      <div className="stack">
        {skills.map((sk) => (
          <button
            type="button"
            className={`skill-card selectable ${selectedSkillIds.includes(sk.id) ? "selected" : ""}`}
            key={sk.id}
            onClick={() => toggleSkill(sk.id)}
          >
            <div className="skill-head">
              <input
                type="checkbox"
                tabIndex={-1}
                readOnly
                checked={selectedSkillIds.includes(sk.id)}
              />
              <span className="skill-glyph">{sk.glyph}</span>
              <span className="skill-name">{sk.name}</span>
              <span className={`st ${sk.status}`}>{SKILL_STATUS[sk.status] || sk.status}</span>
            </div>
            <div className="skill-desc">{sk.detail}</div>
          </button>
        ))}
        {!skills.length && (
          <div className="empty-hint">在 .agents/skills 或 HerDock 全局目录中添加 SKILL.md。</div>
        )}
      </div>
    </div>
  );
}

function CostTab() {
  const state = useWorkbench(
    useShallow((s) => ({
      artifacts: s.artifacts,
      hostOnline: s.hostOnline,
      openPath: s.openPath,
      platform: s.platform,
      policy: s.policy,
      providerId: s.providerId,
      providers: s.providers,
      run: s.run,
      schedules: s.schedules,
      toggleSchedule: s.toggleSchedule,
      usage: s.usage,
      workspace: s.workspace,
    })),
  );
  const providers = state.providers;
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleName, setScheduleName] = useState("");
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleCron, setScheduleCron] = useState("0 9 * * 1-5");
  const saveSchedule = async () => {
    if (!state.workspace || !scheduleName.trim() || !schedulePrompt.trim()) return;
    try {
      const schedule = await hostApi.saveSchedule({
        workspaceId: state.workspace.id,
        name: scheduleName,
        prompt: schedulePrompt,
        cron: scheduleCron,
        providerId: state.providerId,
        enabled: true,
      });
      useWorkbench.setState({ schedules: [...state.schedules, schedule] });
      setScheduleOpen(false);
      setScheduleName("");
      setSchedulePrompt("");
    } catch (error) {
      useWorkbench.setState({ error: String(error) });
    }
  };
  const deleteSchedule = async (id: string) => {
    await hostApi.deleteSchedule(id);
    useWorkbench.setState((state) => ({
      schedules: state.schedules.filter((item) => item.id !== id),
    }));
  };
  const exportArtifact = async (path: string, name: string) => {
    if (!state.workspace) return;
    const destination = await save({ defaultPath: name, title: "导出产物" });
    if (destination) await hostApi.exportArtifact(state.workspace.id, path, destination);
  };

  return (
    <div className="side-body padded">
      <div>
        <div className="side-title">算力用量</div>
        <div className="stack">
          {(state.usage?.buckets || []).map((b) => {
            const pct = Math.min(100, Math.round((b.tokens / 200000) * 100));
            return (
              <div className="usage-card" key={b.key}>
                <div className="usage-top">
                  <span className="k">{b.label}</span>
                  <span className="v">{formatTokens(b.tokens)}</span>
                </div>
                <div className="meter">
                  <i
                    style={{
                      width: `${pct}%`,
                      background:
                        b.key === "month"
                          ? "var(--warn)"
                          : b.key === "today"
                            ? "var(--ok)"
                            : "var(--accent)",
                    }}
                  />
                </div>
                <div className="usage-sub">
                  {b.runs} 次运行 · {b.calls} 个事件
                </div>
              </div>
            );
          })}
          {!state.usage && (
            <div className="empty-hint">运行 Agent 后显示本地 token 与调用统计。</div>
          )}
        </div>
      </div>

      <div>
        <div className="side-title">运行环境</div>
        <div className="panel-card">
          <div className="conn-row">
            <span>平台</span>
            <span className="val">
              {state.platform.os} · {state.platform.defaultShell}
            </span>
            <span className={`st ${state.hostOnline ? "ready" : "missing"}`}>
              {state.hostOnline ? "就绪" : "离线"}
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
            <span className="val">{state.policy?.label || "本地工作区"}</span>
            <span className="st limited">受限</span>
          </div>
          <div className="conn-row">
            <span>网络</span>
            <span className="val">
              {state.policy?.networkDefaultDeny === false ? "默认允许" : "默认拒绝"}
            </span>
            <span
              className={`st ${state.policy?.networkDefaultDeny === false ? "ready" : "limited"}`}
            >
              {state.policy?.networkDefaultDeny === false ? "开放" : "受限"}
            </span>
          </div>
        </div>
      </div>

      <div>
        <div className="side-title side-title-actions">
          <span>定时任务</span>
          <button
            type="button"
            onClick={() => setScheduleOpen((open) => !open)}
            title="新建定时任务"
          >
            <CalendarPlus size={13} />
          </button>
        </div>
        {scheduleOpen && (
          <div className="schedule-form">
            <input
              value={scheduleName}
              onChange={(event) => setScheduleName(event.target.value)}
              placeholder="任务名称"
            />
            <input
              value={scheduleCron}
              onChange={(event) => setScheduleCron(event.target.value)}
              placeholder="5 段 Cron"
            />
            <textarea
              value={schedulePrompt}
              onChange={(event) => setSchedulePrompt(event.target.value)}
              placeholder="定时运行的提示词"
              rows={3}
            />
            <button
              type="button"
              disabled={!state.workspace || !scheduleName.trim() || !schedulePrompt.trim()}
              onClick={() => void saveSchedule()}
            >
              保存本地计划
            </button>
          </div>
        )}
        <div className="panel-card">
          {state.schedules.map((sc) => (
            <div className="sched-row" key={sc.id}>
              <div className="sched-top">
                <span className="sched-name">{sc.name}</span>
                <button
                  type="button"
                  className="icon-btn small"
                  onClick={() => void deleteSchedule(sc.id)}
                  title="删除定时任务"
                >
                  <Trash size={12} />
                </button>
                <button
                  type="button"
                  className={`toggle ${sc.enabled ? "on" : ""}`}
                  onClick={() => void state.toggleSchedule(sc.id)}
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
          {!state.schedules.length && (
            <div className="empty-hint">还没有定时任务，可在设置中创建本地计划。</div>
          )}
        </div>
      </div>

      <div>
        <div className="side-title">本次会话产物</div>
        <div className="stack">
          {state.artifacts.map((a) => (
            <div key={a.id} className="art-row">
              <span className={`ext ${a.ext}`}>{(a.ext || "·").slice(0, 4)}</span>
              <div style={{ minWidth: 0 }}>
                <button
                  type="button"
                  className="art-name art-open"
                  onClick={() => void state.openPath(a.path)}
                >
                  {a.name}
                </button>
                <div className="art-meta">
                  {a.sizeBytes ? formatBytes(a.sizeBytes) : "—"} · {a.path}
                </div>
              </div>
              <div className="art-actions">
                <button
                  type="button"
                  className="icon-btn small"
                  title="在文件夹中定位"
                  onClick={() =>
                    state.workspace && void hostApi.revealArtifact(state.workspace.id, a.path)
                  }
                >
                  <FolderOpen size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn small"
                  title="导出副本"
                  onClick={() => void exportArtifact(a.path, a.name)}
                >
                  <DownloadSimple size={13} />
                </button>
              </div>
            </div>
          ))}
          {!state.artifacts.length && <div className="empty-hint">暂无产物（out/ 目录为空）。</div>}
        </div>
      </div>

      {state.run && (
        <div>
          <div className="side-title">当前运行</div>
          <div className="panel-card">
            <div className="conn-row">
              <span>{state.run.id}</span>
              <span className="val">{state.run.planProgress || "—"}</span>
              <span className={`st ${state.run.status}`}>
                {RUN_STATUS_LABELS[state.run.status as RunStatus] || state.run.status}
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

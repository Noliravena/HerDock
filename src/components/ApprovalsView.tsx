import { useEffect } from "react";
import {
  Check,
  CursorClick,
  FileText,
  Globe,
  PencilSimple,
  Prohibit,
  ShieldCheck,
  TerminalWindow,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import type { Approval } from "../host/client";
import { useWorkbench } from "../store/workbench";

/** Approval scopes, mapped 1:1 onto decisions the Rust core actually honours. */
const SCOPES: { id: string; label: string; desc: string }[] = [
  { id: "approve_once", label: "仅本次", desc: "只放行这一次调用，下次同样动作仍会询问" },
  { id: "allow_run", label: "本次运行内允许", desc: "当前 Run 结束前不再询问相同动作，重启后失效" },
  {
    id: "always_allow",
    label: "永久允许该范围",
    desc: "写入本地权限规则，可在下方「权限规则」里撤销",
  },
];

const RISK_LABEL: Record<string, string> = { low: "低风险", medium: "需确认", high: "高风险" };
const KIND_LABEL: Record<string, string> = {
  shell: "执行命令",
  workspace_write: "写入工作区",
  network: "网络访问",
  browser: "浏览器操作",
  destructive: "破坏性操作",
  provider_cli: "运行 Provider CLI",
  mcp: "MCP 工具调用",
};

function riskTone(risk: string): string {
  return risk === "high" ? "high" : risk === "low" ? "low" : "medium";
}

function kindIcon(kind: string, size = 13) {
  switch (kind) {
    case "shell":
    case "provider_cli":
      return <TerminalWindow size={size} />;
    case "network":
      return <Globe size={size} />;
    case "browser":
      return <CursorClick size={size} />;
    case "destructive":
      return <Prohibit size={size} />;
    default:
      return <FileText size={size} />;
  }
}

/** "等 4m" — how long the agent has been parked on this request. */
function waited(iso?: string): string {
  if (!iso) return "等待中";
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return "等待中";
  const seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
  if (seconds < 60) return `等 ${seconds}s`;
  if (seconds < 3600) return `等 ${Math.round(seconds / 60)}m`;
  return `等 ${Math.round(seconds / 3600)}h`;
}

export function ApprovalsView() {
  const state = useWorkbench(
    useShallow((s) => ({
      allRuns: s.allRuns,
      approvals: s.approvals,
      approvalScope: s.approvalScope,
      approvalTab: s.approvalTab,
      deletePolicyRule: s.deletePolicyRule,
      policyRules: s.policyRules,
      resolveApproval: s.resolveApproval,
      selectApproval: s.selectApproval,
      selectedApprovalId: s.selectedApprovalId,
      setApprovalScope: s.setApprovalScope,
      setApprovalTab: s.setApprovalTab,
      selectRun: s.selectRun,
    })),
  );
  const { approvals } = state;
  const selected: Approval | undefined =
    approvals.find((item) => item.approvalId === state.selectedApprovalId) || approvals[0];

  // Keep the selection anchored when the queue changes underneath us.
  useEffect(() => {
    if (selected && selected.approvalId !== state.selectedApprovalId)
      state.selectApproval(selected.approvalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.approvalId]);

  const runOf = (id: string) => state.allRuns.find((run) => run.id === id);

  return (
    <div className="console-view approvals-view">
      <header className="console-head">
        <h1>审批中心</h1>
        {approvals.length > 0 ? (
          <span className="console-note">
            <span className="pulse-dot" />
            {approvals.length} 个请求等待你决定，Agent 已暂停
          </span>
        ) : (
          <span className="console-note quiet">没有待处理的请求</span>
        )}
        <div className="seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={state.approvalTab === "pending"}
            className={state.approvalTab === "pending" ? "active" : ""}
            onClick={() => state.setApprovalTab("pending")}
          >
            待审批
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={state.approvalTab === "rules"}
            className={state.approvalTab === "rules" ? "active" : ""}
            onClick={() => state.setApprovalTab("rules")}
          >
            权限规则
          </button>
        </div>
      </header>

      {state.approvalTab === "pending" && (
        <div className="approvals-split">
          <div className="approval-queue">
            {approvals.map((item) => {
              const run = runOf(item.runId);
              return (
                <button
                  type="button"
                  key={item.approvalId}
                  className={`approval-card ${selected?.approvalId === item.approvalId ? "active" : ""}`}
                  onClick={() => state.selectApproval(item.approvalId)}
                >
                  <span className="approval-card-top">
                    <span className={`approval-icon ${riskTone(item.risk)}`}>
                      {kindIcon(item.kind, 12)}
                    </span>
                    <span className="approval-action">{item.title}</span>
                    <span className={`risk ${riskTone(item.risk)}`}>
                      {RISK_LABEL[item.risk] || item.risk}
                    </span>
                  </span>
                  <span className="approval-target">{item.scopeKey || item.detail}</span>
                  <span className="approval-card-foot">
                    <span className="run-id">{item.runId}</span>
                    <span className="run-title">
                      {run?.prompt || KIND_LABEL[item.kind] || item.kind}
                    </span>
                    <span className="wait">{waited(item.createdAt)}</span>
                  </span>
                </button>
              );
            })}
            {!approvals.length && <div className="empty-hint">队列为空。</div>}
            <div className="approval-hint">
              <ShieldCheck size={14} />
              <span>未处理的请求会让运行停在原地，直到你决定或取消它。</span>
            </div>
          </div>

          {selected ? (
            <div className="approval-detail">
              <div className="detail-head">
                <span className={`approval-icon lg ${riskTone(selected.risk)}`}>
                  {kindIcon(selected.kind, 16)}
                </span>
                <div className="detail-title">
                  <strong>{selected.title}</strong>
                  <span>{selected.detail}</span>
                </div>
                <span className={`risk ${riskTone(selected.risk)}`}>
                  {RISK_LABEL[selected.risk] || selected.risk}
                </span>
              </div>

              <div className="kv-card">
                <div className="kv-row">
                  <span className="k">类别</span>
                  <span className="v">{KIND_LABEL[selected.kind] || selected.kind}</span>
                </div>
                <div className="kv-row">
                  <span className="k">范围</span>
                  <span className="v">{selected.scopeKey || "—"}</span>
                </div>
                <div className="kv-row">
                  <span className="k">发起</span>
                  <span className="v">
                    {selected.runId}
                    {runOf(selected.runId)?.planProgress
                      ? ` · 第 ${runOf(selected.runId)?.planProgress} 步`
                      : ""}
                  </span>
                </div>
                <div className="kv-row">
                  <span className="k">Provider</span>
                  <span className="v">{runOf(selected.runId)?.providerId || "—"}</span>
                </div>
              </div>

              <div className="detail-section">
                <span className="side-title">PAYLOAD</span>
                <pre className="payload">
                  {`# ${KIND_LABEL[selected.kind] || selected.kind}\n${selected.detail}\n${
                    selected.scopeKey ? `scope: ${selected.scopeKey}` : ""
                  }`.trim()}
                </pre>
              </div>

              <div className="detail-section">
                <span className="side-title">批准范围</span>
                <div className="scope-list">
                  {SCOPES.map((scope) => (
                    <button
                      type="button"
                      key={scope.id}
                      className={`scope-row ${state.approvalScope === scope.id ? "active" : ""}`}
                      onClick={() => state.setApprovalScope(scope.id)}
                    >
                      <span className="radio">
                        <i />
                      </span>
                      <span className="scope-text">
                        <strong>{scope.label}</strong>
                        <span>{scope.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="detail-actions">
                <button
                  type="button"
                  className="solid"
                  onClick={() =>
                    void state.resolveApproval(selected.approvalId, state.approvalScope)
                  }
                >
                  <Check size={13} />
                  批准并继续
                </button>
                <button
                  type="button"
                  className="ghost-btn danger"
                  onClick={() => void state.resolveApproval(selected.approvalId, "deny")}
                >
                  <X size={13} />
                  拒绝
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void state.selectRun(selected.runId)}
                >
                  <PencilSimple size={13} />
                  查看运行
                </button>
              </div>
              <p className="detail-foot">
                执行命令与写入工作区前，HerDock 会先写一次检查点，批准后仍可回滚。
              </p>
            </div>
          ) : (
            <div className="approval-detail empty">
              <div className="empty-hint">风险动作会在这里等待你确认，队列现在是空的。</div>
            </div>
          )}
        </div>
      )}

      {state.approvalTab === "rules" && (
        <div className="console-scroll">
          <div className="rule-list">
            {state.policyRules.map((rule) => (
              <div className="rule-card" key={rule.id}>
                <span className={`approval-icon ${rule.effect === "allow" ? "low" : "medium"}`}>
                  {kindIcon(rule.ruleType, 14)}
                </span>
                <span className="rule-text">
                  <strong>{KIND_LABEL[rule.ruleType] || rule.ruleType}</strong>
                  <span className="mono">{rule.scopeKey}</span>
                </span>
                <span className={`mode ${rule.effect}`}>
                  {rule.effect === "allow" ? "允许" : rule.effect === "deny" ? "拒绝" : "询问"}
                </span>
                <button
                  type="button"
                  className="icon-btn small"
                  title="删除规则"
                  onClick={() => void state.deletePolicyRule(rule.id)}
                >
                  <Trash size={14} />
                </button>
              </div>
            ))}
            {!state.policyRules.length && (
              <div className="empty-hint">
                还没有持久化的允许规则。选择「永久允许该范围」批准一次动作后会出现在这里。
              </div>
            )}
            <p className="console-foot">
              规则保存在本地数据库中，只做精确范围匹配。删除后相关动作会重新回到审批队列。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect } from "react";
import {
  CursorClick,
  FileText,
  Globe,
  Prohibit,
  TerminalWindow,
  Trash,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../store/workbench";
import { ApprovalCard, ConsoleShell, PageEmpty, SpecSheet } from "./pageElements";

/** Approval scopes, mapped 1:1 onto decisions the Rust core actually honours. */
const SCOPES: { id: string; label: string; kind?: "primary" | "ghost" }[] = [
  { id: "deny", label: "拒绝" },
  { id: "allow_run", label: "本次运行内允许" },
  { id: "always_allow", label: "永久允许" },
  { id: "approve_once", label: "批准一次", kind: "primary" },
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

function addedOn(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

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
  return <GrokApprovals />;
}

function GrokApprovals() {
  const state = useWorkbench(
    useShallow((s) => ({
      allRuns: s.allRuns,
      approvals: s.approvals,
      approvalTab: s.approvalTab,
      deletePolicyRule: s.deletePolicyRule,
      hostOnline: s.hostOnline,
      policyRules: s.policyRules,
      resolveApproval: s.resolveApproval,
      selectApproval: s.selectApproval,
      selectRun: s.selectRun,
      selectedApprovalId: s.selectedApprovalId,
      setApprovalTab: s.setApprovalTab,
      sessions: s.sessions,
      workspaceSessions: s.workspaceSessions,
    })),
  );
  const selected =
    state.approvals.find((item) => item.approvalId === state.selectedApprovalId) ||
    state.approvals[0];

  useEffect(() => {
    if (selected && selected.approvalId !== state.selectedApprovalId)
      state.selectApproval(selected.approvalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.approvalId]);

  const sessionTitle = (runId: string) => {
    const run = state.allRuns.find((item) => item.id === runId);
    if (!run) return "";
    const session =
      Object.values(state.workspaceSessions)
        .flat()
        .find((item) => item.id === run.sessionId) ||
      state.sessions.find((item) => item.id === run.sessionId);
    return session?.title || "";
  };

  return (
    <ConsoleShell
      title="审批"
      hostOnline={state.hostOnline}
      actions={
        <div className="g-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={state.approvalTab === "pending" ? "on" : ""}
            onClick={() => state.setApprovalTab("pending")}
          >
            待处理{state.approvals.length ? ` ${state.approvals.length}` : ""}
          </button>
          <button
            type="button"
            role="tab"
            className={state.approvalTab === "rules" ? "on" : ""}
            onClick={() => state.setApprovalTab("rules")}
          >
            规则
          </button>
        </div>
      }
    >
      {state.approvalTab === "pending" && !state.approvals.length && (
        <PageEmpty title="没有需要确认的动作" body="Agent 可以继续跑，新的权限请求会出现在这里。" />
      )}
      {state.approvalTab === "pending" &&
        state.approvals.map((item) => {
          const open = selected?.approvalId === item.approvalId;
          const command = [
            `# ${KIND_LABEL[item.kind] || item.kind}`,
            item.detail,
            item.scopeKey ? `scope: ${item.scopeKey}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          return (
            <ApprovalCard
              key={item.approvalId}
              icon={kindIcon(item.kind, 16)}
              title={item.title}
              subtitle={[
                RISK_LABEL[item.risk] || item.risk,
                sessionTitle(item.runId),
                waited(item.createdAt),
              ]
                .filter(Boolean)
                .join(" · ")}
              command={command}
              selected={open}
              onSelect={() => state.selectApproval(item.approvalId)}
            >
              {SCOPES.map((scope) => (
                <button
                  type="button"
                  key={scope.id}
                  className={scope.kind === "primary" ? "primary" : ""}
                  onClick={() => void state.resolveApproval(item.approvalId, scope.id)}
                >
                  {scope.label}
                </button>
              ))}
              <button type="button" onClick={() => void state.selectRun(item.runId)}>
                查看运行
              </button>
            </ApprovalCard>
          );
        })}

      {state.approvalTab === "rules" && !state.policyRules.length && (
        <PageEmpty
          title="还没有长期规则"
          body="批准时选「永久允许」就会出现在这里，之后可以逐条撤销。"
        />
      )}
      {state.approvalTab === "rules" &&
        state.policyRules.map((rule) => (
          <div className="aui-rule" key={rule.id}>
            <SpecSheet
              title={KIND_LABEL[rule.ruleType] || rule.ruleType}
              subtitle={rule.scopeKey}
              rows={[
                { label: "范围", value: rule.scopeKey, emphasis: true },
                { label: "写入日", value: addedOn(rule.createdAt) },
                {
                  label: "效果",
                  value:
                    rule.effect === "allow" ? "允许" : rule.effect === "deny" ? "拒绝" : "询问",
                },
              ]}
            />
            <button
              type="button"
              className="aui-rule-del"
              title="撤销规则"
              onClick={() => void state.deletePolicyRule(rule.id)}
            >
              <Trash size={14} />
            </button>
          </div>
        ))}
    </ConsoleShell>
  );
}

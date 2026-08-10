/** Risk buckets used by the local approval UI and command classifier. */
export type RiskLevel = "low" | "medium" | "high";

export type ShellCommandClass =
  "read_only" | "workspace_write" | "package_install" | "network" | "destructive" | "unknown";

export type ApprovalDecision = "approve_once" | "always_allow" | "deny";

export interface ApprovalRequest {
  id: string;
  runId: string;
  title: string;
  detail: string;
  risk: RiskLevel;
  kind: "write_path" | "shell" | "network" | "connector" | "other";
  scopeKey?: string;
}

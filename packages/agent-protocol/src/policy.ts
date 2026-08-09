import type { ConnectorId, OrgId } from "./ids";
import type { AutoExecuteLevel } from "./provider";

/** Risk buckets used by the approval UI and shell classifier. */
export type RiskLevel = "low" | "medium" | "high";

export type ShellCommandClass =
  | "read_only"
  | "workspace_write"
  | "package_install"
  | "network"
  | "destructive"
  | "unknown";

export interface PathRule {
  /** Glob relative to workspace root, or absolute prefix when `absolute` is true. */
  pattern: string;
  absolute?: boolean;
}

export interface NetworkRule {
  /** Host or host:port patterns, e.g. `api.github.com`, `*.example.com`. */
  hostPattern: string;
}

export interface PolicyBundle {
  version: string;
  orgId: OrgId;
  /** Max auto-execute level the org allows; UI cannot exceed this. */
  maxAutoExecute: AutoExecuteLevel;
  /** Shell classes that always require human approval. */
  forceApprovalClasses: ShellCommandClass[];
  readAllow: PathRule[];
  writeAllow: PathRule[];
  /** Explicit denials always win over allow. */
  writeDeny: PathRule[];
  networkAllow: NetworkRule[];
  /** When true, any host not in networkAllow is blocked. */
  networkDefaultDeny: boolean;
  /** Connector ids the org has enabled. */
  enabledConnectors: ConnectorId[];
  /** Optional human-readable source note (org name / policy pack). */
  label?: string;
}

export type ApprovalDecision =
  | "approve_once"
  | "always_allow"
  | "deny";

export interface ApprovalRequest {
  id: string;
  runId: string;
  title: string;
  detail: string;
  risk: RiskLevel;
  /** e.g. write_path, shell, network, connector */
  kind: "write_path" | "shell" | "network" | "connector" | "other";
  /** Payload for always-allow persistence (must still pass org policy). */
  scopeKey?: string;
}

export interface ConnectorDescriptor {
  id: ConnectorId;
  name: string;
  status: "connected" | "expired" | "disconnected" | "error";
  scopes: string[];
  /** Domains granted by this connector (merged into network allow at runtime). */
  hostPatterns?: string[];
  detail?: string;
}

/** Strict local default when org policy cannot be fetched. */
export function defaultOfflinePolicy(orgId: OrgId = "local" as OrgId): PolicyBundle {
  return {
    version: "offline-1",
    orgId,
    maxAutoExecute: "ask_risky",
    forceApprovalClasses: ["package_install", "network", "destructive", "unknown"],
    readAllow: [{ pattern: "**/*" }],
    writeAllow: [{ pattern: "**/*" }, { pattern: "out/**" }],
    writeDeny: [],
    networkAllow: [],
    networkDefaultDeny: true,
    enabledConnectors: [],
    label: "Offline strict default",
  };
}

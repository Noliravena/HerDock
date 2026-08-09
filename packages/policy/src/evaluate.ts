import type {
  AutoExecuteLevel,
  PathRule,
  PolicyBundle,
  ShellCommandClass,
  XingzhiWorkspaceConfig,
} from "@her-dock/agent-protocol";
import { matchesAnyRule, normalizeRelPath } from "./match";

const AUTO_RANK: Record<AutoExecuteLevel, number> = {
  ask_always: 0,
  ask_risky: 1,
  auto_workspace: 2,
  auto_all: 3,
};

export function clampAutoExecute(
  requested: AutoExecuteLevel,
  orgMax: AutoExecuteLevel,
): AutoExecuteLevel {
  return AUTO_RANK[requested] <= AUTO_RANK[orgMax] ? requested : orgMax;
}

/**
 * Merge org policy with workspace config.
 * Workspace may only add writeAllow (still checked against org) and lower autoExecute.
 */
export function mergePolicy(
  org: PolicyBundle,
  workspace?: XingzhiWorkspaceConfig | null,
): PolicyBundle {
  if (!workspace) return org;

  const extraWrite: PathRule[] = (workspace.writeAllow ?? []).map((pattern) => ({
    pattern,
  }));

  return {
    ...org,
    maxAutoExecute: workspace.autoExecute
      ? clampAutoExecute(workspace.autoExecute, org.maxAutoExecute)
      : org.maxAutoExecute,
    writeAllow: [...org.writeAllow, ...extraWrite],
    label: workspace.name
      ? `${org.label ?? "org"} + ${workspace.name}`
      : org.label,
  };
}

export type PathAccess = "allow" | "deny";

export function evaluateWrite(
  policy: PolicyBundle,
  relativePath: string,
): PathAccess {
  const path = normalizeRelPath(relativePath);
  if (matchesAnyRule(path, policy.writeDeny)) return "deny";
  if (matchesAnyRule(path, policy.writeAllow)) return "allow";
  return "deny";
}

export function evaluateRead(
  policy: PolicyBundle,
  relativePath: string,
): PathAccess {
  const path = normalizeRelPath(relativePath);
  if (matchesAnyRule(path, policy.readAllow)) return "allow";
  return "deny";
}

export function evaluateNetwork(
  policy: PolicyBundle,
  host: string,
): PathAccess {
  const h = host.toLowerCase();
  const allowed = policy.networkAllow.some((r) =>
    matchHost(r.hostPattern.toLowerCase(), h),
  );
  if (allowed) return "allow";
  return policy.networkDefaultDeny ? "deny" : "allow";
}

function matchHost(pattern: string, host: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // .example.com
    return host.endsWith(suffix) || host === pattern.slice(2);
  }
  return host === pattern;
}

export type ShellDecision = {
  class: ShellCommandClass;
  requiresApproval: boolean;
};

/** Heuristic classifier — host may replace with richer analysis later. */
export function classifyShellCommand(command: string): ShellCommandClass {
  const c = command.trim().toLowerCase();
  if (!c) return "unknown";
  if (/\b(rm\s+-rf|del\s+\/s|format\s+|mkfs)\b/.test(c)) return "destructive";
  if (/\b(curl|wget|invoke-webrequest|npm\s+publish)\b/.test(c)) return "network";
  if (/\b(npm\s+i|npm\s+install|pnpm\s+add|pip\s+install|brew\s+install)\b/.test(c)) {
    return "package_install";
  }
  if (/\b(git\s+push|git\s+commit)\b/.test(c)) return "workspace_write";
  if (/\b(cat|type|ls|dir|git\s+status|git\s+diff|rg|find)\b/.test(c)) {
    return "read_only";
  }
  if (/\b(python|node|pnpm|npm\s+test|go\s+test)\b/.test(c)) {
    return "workspace_write";
  }
  return "unknown";
}

export function evaluateShell(
  policy: PolicyBundle,
  command: string,
  autoExecute: AutoExecuteLevel,
): ShellDecision {
  const cls = classifyShellCommand(command);
  const force = policy.forceApprovalClasses.includes(cls);

  if (autoExecute === "ask_always") {
    return { class: cls, requiresApproval: true };
  }
  if (force) {
    return { class: cls, requiresApproval: true };
  }
  if (autoExecute === "ask_risky") {
    const risky: ShellCommandClass[] = [
      "package_install",
      "network",
      "destructive",
      "unknown",
    ];
    return { class: cls, requiresApproval: risky.includes(cls) };
  }
  if (autoExecute === "auto_workspace") {
    return {
      class: cls,
      requiresApproval: cls === "network" || cls === "destructive",
    };
  }
  // auto_all — still honor forceApprovalClasses (already handled)
  return { class: cls, requiresApproval: false };
}

/** always-allow keys must still pass evaluate* on each use. */
export function alwaysAllowPermitted(
  policy: PolicyBundle,
  scopeKey: string,
): boolean {
  // scopeKey formats: write:<relpath> | shell:<class> | network:<host>
  if (scopeKey.startsWith("write:")) {
    return evaluateWrite(policy, scopeKey.slice(6)) === "allow";
  }
  if (scopeKey.startsWith("shell:")) {
    const cls = scopeKey.slice(6) as ShellCommandClass;
    return !policy.forceApprovalClasses.includes(cls);
  }
  if (scopeKey.startsWith("network:")) {
    return evaluateNetwork(policy, scopeKey.slice(8)) === "allow";
  }
  return false;
}

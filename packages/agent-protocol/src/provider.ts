import type { RunId, SessionId, WorkspaceId } from "./ids";
import type { AgentEvent } from "./events";
import type { PolicyBundle } from "./policy";

/** First-party local CLI engines. */
export type BuiltinProviderId = "codex" | "claude" | "grok";
export type ProviderId = BuiltinProviderId | (string & {});

export type ProviderAuthState =
  | "unknown"
  | "logged_in"
  | "logged_out"
  | "error";

export interface ProviderHealth {
  id: ProviderId;
  displayName: string;
  available: boolean;
  path?: string;
  version?: string;
  auth: ProviderAuthState;
  detail?: string;
  capabilities: ProviderCapabilities;
}

export interface ProviderCapabilities {
  /** Non-interactive / headless run supported. */
  nonInteractive: boolean;
  /** Resume or continue an existing session. */
  continueSession: boolean;
  /** Stream structured tool events (not only plain text). */
  structuredStream: boolean;
  /** Native apply-latest-diff command (e.g. codex apply). */
  applyDiff: boolean;
  /** Accept permission allow/deny rules from host policy. */
  policyRules: boolean;
}

export type AutoExecuteLevel =
  | "ask_always"
  | "ask_risky"
  | "auto_workspace"
  | "auto_all";

export interface StartRunRequest {
  runId: RunId;
  sessionId: SessionId;
  workspaceId: WorkspaceId;
  workspaceRoot: string;
  prompt: string;
  /** Absolute or workspace-relative paths referenced via @. */
  attachments?: string[];
  providerId: ProviderId;
  model?: string;
  autoExecute: AutoExecuteLevel;
  /** Effective policy after org + workspace merge (already tightened). */
  policy: PolicyBundle;
  /** Optional provider-native session/thread id to resume. */
  providerSessionId?: string;
}

export interface HumanEditSummary {
  paths: string[];
  /** Unified diff or truncated summary injected into continue context. */
  summary: string;
  /** Prefer disk contents over unapplied agent patches. */
  diskWins: true;
}

export interface ContinueRunRequest {
  runId: RunId;
  sessionId: SessionId;
  workspaceId: WorkspaceId;
  workspaceRoot: string;
  providerId: ProviderId;
  policy: PolicyBundle;
  autoExecute: AutoExecuteLevel;
  humanEdits: HumanEditSummary;
  /** Free-form user note when continuing. */
  note?: string;
  providerSessionId?: string;
}

/**
 * Host-side adapter contract. Implementations live in desktop runtime
 * (Go) and may be mirrored by TS fakes for UI storybooks/tests.
 */
export interface AgentProvider {
  readonly id: ProviderId;
  detect(): Promise<ProviderHealth>;
  startRun(req: StartRunRequest): AsyncIterable<AgentEvent>;
  continueRun(req: ContinueRunRequest): AsyncIterable<AgentEvent>;
  cancel(runId: RunId): Promise<void>;
  applyPendingDiff?(runId: RunId): Promise<void>;
}

export const DEFAULT_CAPABILITIES: Record<BuiltinProviderId, ProviderCapabilities> = {
  codex: {
    nonInteractive: true,
    continueSession: true,
    structuredStream: true,
    applyDiff: true,
    policyRules: true,
  },
  claude: {
    nonInteractive: true,
    continueSession: true,
    structuredStream: true,
    applyDiff: false,
    policyRules: true,
  },
  grok: {
    nonInteractive: true,
    continueSession: true,
    structuredStream: true,
    applyDiff: false,
    policyRules: true,
  },
};

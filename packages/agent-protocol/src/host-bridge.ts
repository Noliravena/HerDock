import type { ApprovalDecision } from "./policy";
import type { AgentEvent } from "./events";
import type { ProviderHealth, ProviderId, StartRunRequest, ContinueRunRequest } from "./provider";
import type {
  RunRecord,
  SessionRecord,
  WorkspaceRef,
  ArtifactRecord,
  CheckpointRecord,
} from "./run";
import type { ConnectorDescriptor, PolicyBundle } from "./policy";
import type { RunId, SessionId, WorkspaceId } from "./ids";

/**
 * Desktop host API surface exposed to the Workbench UI.
 * Implemented by Wails Go bindings; browser uses a limited stub.
 */
export interface HostBridge {
  platform: "desktop" | "web";

  // —— Workspace FS ——
  openWorkspace(): Promise<WorkspaceRef | null>;
  listWorkspaces(): Promise<WorkspaceRef[]>;
  getWorkspaceTree(workspaceId: WorkspaceId, maxDepth?: number): Promise<FsNode[]>;
  readFile(workspaceId: WorkspaceId, relativePath: string): Promise<string>;
  writeFile(workspaceId: WorkspaceId, relativePath: string, content: string): Promise<void>;
  watchWorkspace?(workspaceId: WorkspaceId): Promise<void>;

  // —— Providers ——
  listProviders(): Promise<ProviderHealth[]>;
  startRun(req: StartRunRequest): Promise<RunRecord>;
  continueRun(req: ContinueRunRequest): Promise<RunRecord>;
  cancelRun(runId: RunId): Promise<void>;
  pauseRun?(runId: RunId): Promise<void>;

  // —— Persistence ——
  listSessions(workspaceId: WorkspaceId): Promise<SessionRecord[]>;
  listRuns(sessionId: SessionId): Promise<RunRecord[]>;
  listEvents(runId: RunId): Promise<AgentEvent[]>;
  listCheckpoints(runId: RunId): Promise<CheckpointRecord[]>;
  listArtifacts(workspaceId: WorkspaceId): Promise<ArtifactRecord[]>;
  restoreCheckpoint(checkpointId: string): Promise<void>;

  // —— Policy / org ——
  getEffectivePolicy(workspaceId: WorkspaceId): Promise<PolicyBundle>;
  listConnectors(): Promise<ConnectorDescriptor[]>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<void>;

  // —— Shell (local only) ——
  runShell?(opts: {
    workspaceId: WorkspaceId;
    command: string;
    cwd?: string;
  }): Promise<{ exitCode: number }>;
}

export interface FsNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  children?: FsNode[];
  gitStatus?: "M" | "A" | "D" | "U" | null;
}

/** Event names emitted from desktop → UI. */
export const HOST_EVENTS = {
  runEvent: "run:event",
  fsChanged: "fs:changed",
  policyUpdated: "policy:updated",
  providerHealth: "provider:health",
} as const;

export type HostEventMap = {
  "run:event": AgentEvent;
  "fs:changed": { workspaceId: WorkspaceId; paths: string[] };
  "policy:updated": PolicyBundle;
  "provider:health": ProviderHealth[];
};

export interface DeveloperModeLaunchPayload {
  orgId: string;
  accessToken: string;
  apiBaseUrl: string;
  workspacePath?: string;
  preferredProvider?: ProviderId;
}

import type { ArtifactId, CheckpointId, RunId, SessionId, WorkspaceId } from "./ids";
import type { ProviderId } from "./provider";

export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "waiting_approval"
  | "waiting_human"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type SessionKind = "coding" | "analysis" | "mixed";

export interface WorkspaceRef {
  id: WorkspaceId;
  name: string;
  rootPath: string;
  branch?: string;
  /** Git porcelain-style short summary, e.g. +4 −1. */
  dirtySummary?: string;
}

export interface SessionRecord {
  id: SessionId;
  workspaceId: WorkspaceId;
  title: string;
  kind: SessionKind;
  providerId: ProviderId;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  /** Provider-native conversation id when known. */
  providerSessionId?: string;
}

export interface RunRecord {
  id: RunId;
  sessionId: SessionId;
  workspaceId: WorkspaceId;
  providerId: ProviderId;
  status: RunStatus;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** e.g. "3/5" plan progress for status bar. */
  planProgress?: string;
  errorMessage?: string;
  tokenUsage?: TokenUsage;
}

export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
}

export interface CheckpointRecord {
  id: CheckpointId;
  runId: RunId;
  label: string;
  createdAt: string;
  /** Content-hash snapshot directory or git tree id. */
  snapshotRef: string;
}

export interface ArtifactRecord {
  id: ArtifactId;
  runId: RunId;
  workspaceId: WorkspaceId;
  path: string;
  name: string;
  ext: string;
  sizeBytes?: number;
  createdAt: string;
  mime?: string;
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "排队中",
  starting: "启动中",
  running: "执行中",
  waiting_approval: "待审批",
  waiting_human: "待确认",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

import type { EventId, RunId } from "./ids";
import type { RiskLevel, ShellCommandClass } from "./policy";
import type { RunStatus, TokenUsage } from "./run";

/**
 * Normalized agent events. UI renders only these shapes;
 * CLI-specific logs stay inside desktop adapters.
 */
export type AgentEventType =
  | "queued"
  | "assistant_delta"
  | "plan_updated"
  | "tool_requested"
  | "approval_required"
  | "tool_output"
  | "file_patch"
  | "usage_updated"
  | "checkpoint_created"
  | "completed"
  | "failed"
  | "cancelled"
  | "message.user"
  | "message.assistant"
  | "plan.updated"
  | "shell.start"
  | "shell.output"
  | "shell.exit"
  | "tool.requested"
  | "tool.output"
  | "file.edit_proposed"
  | "file.edit_applied"
  | "approval.requested"
  | "approval.resolved"
  | "artifact.created"
  | "checkpoint.created"
  | "run.status"
  | "usage.tokens"
  | "table.result"
  | "human.decision"
  | "error";

export interface AgentEventBase {
  id: EventId;
  runId: RunId;
  type: AgentEventType;
  ts: string;
  /** Monotonic sequence within a run for ordering. */
  seq: number;
}

export interface MessageEvent extends AgentEventBase {
  type: "assistant_delta" | "message.user" | "message.assistant";
  text: string;
}

export type PlanStepState = "pending" | "running" | "done" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  title: string;
  state: PlanStepState;
  durationMs?: number;
}

export interface PlanUpdatedEvent extends AgentEventBase {
  type: "plan_updated" | "plan.updated";
  steps: PlanStep[];
}

export interface ShellStartEvent extends AgentEventBase {
  type: "shell.start";
  command: string;
  cwd?: string;
  class?: ShellCommandClass;
}

export interface ShellOutputEvent extends AgentEventBase {
  type: "shell.output";
  stream: "stdout" | "stderr";
  text: string;
}

export interface ShellExitEvent extends AgentEventBase {
  type: "shell.exit";
  exitCode: number;
  durationMs?: number;
}

export interface ToolRequestedEvent extends AgentEventBase {
  type: "tool_requested" | "tool.requested";
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolOutputEvent extends AgentEventBase {
  type: "tool_output" | "tool.output";
  toolCallId: string;
  name: string;
  output: string;
  failed: boolean;
}

export type FileEditKind = "M" | "A" | "D";

export interface FileEditEvent extends AgentEventBase {
  type: "file_patch" | "file.edit_proposed" | "file.edit_applied";
  path: string;
  kind: FileEditKind;
  /** Unified diff hunk when available. */
  diff?: string;
  additions?: number;
  deletions?: number;
}

export interface ApprovalRequestedEvent extends AgentEventBase {
  type: "approval_required" | "approval.requested";
  approvalId: string;
  title: string;
  detail: string;
  risk: RiskLevel;
  kind: "write_path" | "shell" | "network" | "connector" | "other";
  scopeKey?: string;
}

export interface ApprovalResolvedEvent extends AgentEventBase {
  type: "approval.resolved";
  approvalId: string;
  decision: "approve_once" | "always_allow" | "deny";
}

export interface ArtifactCreatedEvent extends AgentEventBase {
  type: "artifact.created";
  path: string;
  name: string;
  ext: string;
  sizeBytes?: number;
}

export interface CheckpointCreatedEvent extends AgentEventBase {
  type: "checkpoint_created" | "checkpoint.created";
  checkpointId: string;
  label: string;
  snapshotRef: string;
}

export interface RunStatusEvent extends AgentEventBase {
  type: "queued" | "completed" | "failed" | "cancelled" | "run.status";
  status: RunStatus;
  message?: string;
}

export interface UsageTokensEvent extends AgentEventBase {
  type: "usage_updated" | "usage.tokens";
  usage: TokenUsage;
}

export interface TableColumn {
  key: string;
  label: string;
}

export interface TableResultEvent extends AgentEventBase {
  type: "table.result";
  columns: TableColumn[];
  rows: Record<string, string | number | boolean | null>[];
  caption?: string;
}

export interface HumanDecisionEvent extends AgentEventBase {
  type: "human.decision";
  question: string;
  options: { id: string; label: string; primary?: boolean }[];
  /** Set when user answers. */
  selectedOptionId?: string;
  freeText?: string;
}

export interface ErrorEvent extends AgentEventBase {
  type: "error";
  message: string;
  retriable?: boolean;
  code?: string;
}

export type AgentEvent =
  | MessageEvent
  | PlanUpdatedEvent
  | ShellStartEvent
  | ShellOutputEvent
  | ShellExitEvent
  | ToolRequestedEvent
  | ToolOutputEvent
  | FileEditEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | ArtifactCreatedEvent
  | CheckpointCreatedEvent
  | RunStatusEvent
  | UsageTokensEvent
  | TableResultEvent
  | HumanDecisionEvent
  | ErrorEvent;

/** UI card kinds mapped from events (design handoff labels). */
export type ThreadCardKind =
  | "message"
  | "plan"
  | "terminal"
  | "edits"
  | "checkpoints"
  | "table"
  | "related_runs"
  | "human_decision"
  | "error";

export function eventToCardKind(type: AgentEventType): ThreadCardKind | null {
  switch (type) {
    case "message.user":
    case "message.assistant":
    case "assistant_delta":
      return "message";
    case "plan.updated":
    case "plan_updated":
      return "plan";
    case "shell.start":
    case "shell.output":
    case "shell.exit":
    case "tool.requested":
    case "tool.output":
    case "tool_requested":
    case "tool_output":
      return "terminal";
    case "file.edit_proposed":
    case "file.edit_applied":
    case "file_patch":
      return "edits";
    case "checkpoint.created":
    case "checkpoint_created":
      return "checkpoints";
    case "table.result":
      return "table";
    case "human.decision":
      return "human_decision";
    case "error":
      return "error";
    default:
      return null;
  }
}

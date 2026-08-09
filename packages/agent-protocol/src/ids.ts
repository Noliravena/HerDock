/** Branded string helpers keep call sites explicit without runtime cost. */

export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type RunId = string & { readonly __brand: "RunId" };
export type EventId = string & { readonly __brand: "EventId" };
export type CheckpointId = string & { readonly __brand: "CheckpointId" };
export type ApprovalId = string & { readonly __brand: "ApprovalId" };
export type ArtifactId = string & { readonly __brand: "ArtifactId" };
export type OrgId = string & { readonly __brand: "OrgId" };
export type ConnectorId = string & { readonly __brand: "ConnectorId" };

export function asWorkspaceId(v: string): WorkspaceId {
  return v as WorkspaceId;
}
export function asSessionId(v: string): SessionId {
  return v as SessionId;
}
export function asRunId(v: string): RunId {
  return v as RunId;
}
export function asEventId(v: string): EventId {
  return v as EventId;
}

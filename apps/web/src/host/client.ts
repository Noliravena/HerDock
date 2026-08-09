const DEFAULT_BASE = "http://127.0.0.1:17890";

export function hostBase(): string {
  return (import.meta.env.VITE_HOST_URL as string) || DEFAULT_BASE;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${hostBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  branch?: string;
  dirtySummary?: string;
};

export type Session = {
  id: string;
  workspaceId: string;
  title: string;
  kind: string;
  providerId: string;
};

export type Run = {
  id: string;
  sessionId: string;
  workspaceId: string;
  providerId: string;
  status: string;
  prompt: string;
  planProgress?: string;
  errorMessage?: string;
};

export type ProviderHealth = {
  id: string;
  displayName: string;
  available: boolean;
  path?: string;
  version?: string;
  auth: string;
  detail?: string;
};

export type FsNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  gitStatus?: string | null;
  children?: FsNode[];
};

export type PolicyBundle = {
  version: string;
  orgId: string;
  maxAutoExecute: string;
  label?: string;
  forceApprovalClasses: string[];
  networkDefaultDeny: boolean;
};

export type Connector = {
  id: string;
  name: string;
  status: string;
  scopes: string[];
  detail?: string;
};

export const hostApi = {
  health: () => req<{ ok: boolean }>("/health"),
  providers: () => req<ProviderHealth[]>("/v1/providers"),
  policy: () => req<PolicyBundle>("/v1/policy"),
  connectors: () => req<Connector[]>("/v1/connectors"),
  listWorkspaces: () => req<Workspace[]>("/v1/workspaces"),
  openWorkspace: (path: string) =>
    req<Workspace>("/v1/workspaces", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  tree: (id: string, depth = 4) =>
    req<FsNode[]>(`/v1/workspaces/${id}/tree?depth=${depth}`),
  readFile: (id: string, path: string) =>
    req<{ path: string; content: string }>(
      `/v1/workspaces/${id}/file?path=${encodeURIComponent(path)}`,
    ),
  writeFile: (id: string, path: string, content: string) =>
    req<{ ok: boolean }>(`/v1/workspaces/${id}/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    }),
  listSessions: (id: string) => req<Session[]>(`/v1/workspaces/${id}/sessions`),
  createSession: (
    id: string,
    body: { title: string; kind?: string; providerId?: string },
  ) =>
    req<Session>(`/v1/workspaces/${id}/sessions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listArtifacts: (id: string) =>
    req<
      {
        id: string;
        path: string;
        name: string;
        ext: string;
        sizeBytes?: number;
      }[]
    >(`/v1/workspaces/${id}/artifacts`),
  diffSummary: (id: string) =>
    req<{ summary: string; diskWins: boolean }>(
      `/v1/workspaces/${id}/diff-summary`,
    ),
  listRuns: (sessionId: string) => req<Run[]>(`/v1/sessions/${sessionId}/runs`),
  recentRuns: () => req<Run[]>("/v1/runs"),
  startRun: (body: {
    sessionId: string;
    workspaceId: string;
    providerId: string;
    prompt: string;
    autoExecute?: string;
    demo?: boolean;
  }) =>
    req<Run>("/v1/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  continueRun: (
    runId: string,
    body: {
      humanSummary?: string;
      note?: string;
      autoExecute?: string;
      demo?: boolean;
    },
  ) =>
    req<Run>(`/v1/runs/${runId}/continue`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelRun: (runId: string) =>
    req<{ ok: boolean }>(`/v1/runs/${runId}/cancel`, { method: "POST" }),
  events: (runId: string) => req<Record<string, unknown>[]>(`/v1/runs/${runId}/events`),
  checkpoints: (runId: string) =>
    req<Record<string, unknown>[]>(`/v1/runs/${runId}/checkpoints`),
  resolveApproval: (id: string, decision: string) =>
    req<{ ok: boolean }>(`/v1/approvals/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  shell: (workspaceId: string, command: string) =>
    req<{ exitCode: number; output: string }>(
      `/v1/workspaces/${workspaceId}/shell`,
      { method: "POST", body: JSON.stringify({ command }) },
    ),
};

export function subscribeHostEvents(
  onEvent: (payload: { channel: string; event: Record<string, unknown> }) => void,
): () => void {
  const es = new EventSource(`${hostBase()}/v1/events`);
  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data) as {
        channel: string;
        event: Record<string, unknown>;
      };
      onEvent(data);
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}

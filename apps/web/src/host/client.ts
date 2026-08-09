const DEFAULT_BASE = "http://127.0.0.1:17890";
/** Vite dev server port; anything else served over http is assumed to be the host itself. */
const DEV_PORTS = new Set(["5173", "4173"]);

export function hostBase(): string {
  const configured = import.meta.env.VITE_HOST_URL as string | undefined;
  if (configured) return configured;
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
    // Desktop shell serves the bundle from the host itself — talk to the same origin.
    if (!DEV_PORTS.has(window.location.port)) return window.location.origin;
  }
  return DEFAULT_BASE;
}

/**
 * True when the page itself is served by the host process — i.e. the desktop
 * shell. A browser tab pointed at the dev server talks to the host over CORS
 * and must keep the web chrome even though the host runs on a desktop OS.
 */
export function servedByHost(): boolean {
  if (typeof window === "undefined") return false;
  return hostBase() === window.location.origin;
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
  tokenUsage?: { input?: number; output?: number; total?: number; credits?: number };
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
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

/** Platform chrome descriptor: browser bar, macOS traffic lights or Windows caption. */
export type PlatformInfo = {
  os: string;
  arch: string;
  desktop: boolean;
  chrome: "web" | "mac" | "win";
  homeDir?: string;
  dataDir: string;
  pathSeparator: string;
  modifierKey: string;
  commandHint: string;
  newHint: string;
  submitHint: string;
  defaultShell: string;
  windowControl: string;
};

export type Skill = {
  id: string;
  glyph: string;
  name: string;
  status: "enabled" | "readonly" | "limited" | "disabled";
  detail: string;
};

export type Schedule = {
  id: string;
  workspaceId: string;
  name: string;
  cron: string;
  prompt?: string;
  providerId?: string;
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
};

export type WorkspaceContext = {
  files: { path: string; kind: "rule" | "data" | "code" | "config"; size: string }[];
  rules: string[];
  outputDir: string;
  testCommand?: string;
  autoExecute?: string;
};

export type UsageBucket = {
  key: string;
  label: string;
  tokens: number;
  runs: number;
  calls: number;
  limit?: number;
};

export type UsageReport = {
  buckets: UsageBucket[];
  credits: number;
  context: { used: number; limit: number };
};

export type QueueItem = {
  runId: string;
  name: string;
  workspaceId: string;
  status: string;
  meta: string;
};

export type Artifact = {
  id: string;
  path: string;
  name: string;
  ext: string;
  sizeBytes?: number;
  createdAt?: string;
};

export const hostApi = {
  health: () => req<{ ok: boolean }>("/health"),
  platform: () => req<PlatformInfo>("/v1/platform"),
  providers: () => req<ProviderHealth[]>("/v1/providers"),
  policy: () => req<PolicyBundle>("/v1/policy"),
  connectors: () => req<Connector[]>("/v1/connectors"),
  skills: (workspaceId?: string) =>
    req<Skill[]>(`/v1/skills${workspaceId ? `?workspaceId=${workspaceId}` : ""}`),
  queue: () => req<QueueItem[]>("/v1/queue"),
  usage: (runId?: string) => req<UsageReport>(`/v1/usage${runId ? `?runId=${runId}` : ""}`),
  schedules: (workspaceId?: string) =>
    req<Schedule[]>(`/v1/schedules${workspaceId ? `?workspaceId=${workspaceId}` : ""}`),
  saveSchedule: (body: {
    id?: string;
    workspaceId: string;
    name?: string;
    cron?: string;
    prompt?: string;
    providerId?: string;
    enabled?: boolean;
  }) => req<Schedule>("/v1/schedules", { method: "POST", body: JSON.stringify(body) }),
  deleteSchedule: (id: string) =>
    req<{ ok: boolean }>(`/v1/schedules/${id}`, { method: "DELETE" }),
  workspaceContext: (id: string) =>
    req<WorkspaceContext>(`/v1/workspaces/${id}/context`),
  fileDiff: (id: string, path: string) =>
    req<{ path: string; diff: string }>(
      `/v1/workspaces/${id}/file-diff?path=${encodeURIComponent(path)}`,
    ),
  resolveDecision: (runId: string, optionId: string, freeText?: string) =>
    req<{ ok: boolean }>(`/v1/runs/${runId}/decision`, {
      method: "POST",
      body: JSON.stringify({ optionId, freeText }),
    }),
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
  listArtifacts: (id: string) => req<Artifact[]>(`/v1/workspaces/${id}/artifacts`),
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

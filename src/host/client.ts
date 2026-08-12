import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEvent } from "@her-dock/agent-protocol";

export type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  branch?: string;
  dirtySummary?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type Session = {
  id: string;
  workspaceId: string;
  title: string;
  kind: string;
  providerId: string;
  createdAt?: string;
  updatedAt?: string;
};
export type Run = {
  id: string;
  sessionId: string;
  workspaceId: string;
  providerId: string;
  model?: string;
  status: string;
  prompt: string;
  planProgress?: string;
  errorMessage?: string;
  tokenUsage?: { input?: number; output?: number; total?: number };
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
};
export type ProviderHealth = {
  id: string;
  displayName: string;
  providerType: string;
  available: boolean;
  path?: string;
  version?: string;
  auth: string;
  detail?: string;
  model?: string;
  baseUrl?: string;
  capabilities: string[];
};
export type ProviderProfile = {
  id: string;
  providerType: string;
  displayName: string;
  model?: string;
  baseUrl?: string;
  executable?: string;
  credentialRef?: string;
  enabled: boolean;
  config: Record<string, unknown>;
};
export type GrokAuthStatus = {
  cliFound: boolean;
  cliPath?: string;
  version?: string;
  signedIn: boolean;
  expired: boolean;
  authMode?: string;
  email?: string;
  displayName?: string;
  expiresAt?: string;
  loginRunning: boolean;
  detail: string;
};
export type GrokLoginEvent = {
  eventType: "started" | "url" | "code" | "completed" | "failed" | "cancelled";
  message: string;
  url?: string;
  code?: string;
};
export type GrokLoginResult = {
  ok: boolean;
  method: "oauth" | "device";
  message: string;
  timedOut: boolean;
  deviceUrl?: string;
  deviceCode?: string;
  status: GrokAuthStatus;
};
export type FsNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  gitStatus?: string | null;
  children?: FsNode[];
};
export type PlatformInfo = {
  os: string;
  arch: string;
  desktop: boolean;
  dataDir: string;
  pathSeparator: string;
  modifierKey: string;
  commandHint: string;
  newHint: string;
  submitHint: string;
  defaultShell: string;
  windowControl: "windows" | "macos";
};
export type Skill = {
  id: string;
  glyph: string;
  name: string;
  status: "enabled" | "readonly" | "limited" | "disabled";
  detail: string;
  path: string;
  scope: string;
};
export type McpServer = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  workspaceId?: string;
  status?: string;
  tools: string[];
};
export type Schedule = {
  id: string;
  workspaceId: string;
  name: string;
  cron: string;
  prompt: string;
  providerId: string;
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type WorkspaceContext = {
  files: { path: string; kind: "rule" | "data" | "code" | "config"; size: string }[];
  rules: string[];
  outputDir: string;
  testCommand?: string;
  autoExecute?: string;
};
type UsageBucket = {
  key: string;
  label: string;
  tokens: number;
  runs: number;
  calls: number;
};
export type UsageReport = { buckets: UsageBucket[]; context: { used: number; limit: number } };
export type UsageDayEntry = {
  day: string;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
};
export type UsageRunEntry = {
  id: string;
  title: string;
  providerId: string;
  tokens: number;
  createdAt?: string;
};
export type UsageSeries = {
  days: UsageDayEntry[];
  previousTokens: number;
  previousRuns: number;
  topRuns: UsageRunEntry[];
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
  runId?: string;
  workspaceId?: string;
  path: string;
  name: string;
  ext: string;
  sizeBytes?: number;
  kind: string;
  renderer?: string;
  entryPath?: string;
  status: "streaming" | "complete" | "error" | string;
  manifest: Record<string, unknown>;
  createdAt?: string;
};
export type DesignSystem = {
  id: string;
  name: string;
  category: string;
  description: string;
  scope: "builtin" | "global" | "workspace" | string;
  hasTokens: boolean;
};
export type DesignSystemContent = {
  system: DesignSystem;
  designMarkdown: string;
  tokensCss: string;
};
export type ArtifactPreview = { path: string; html: string };
export type Approval = {
  approvalId: string;
  runId: string;
  title: string;
  detail: string;
  risk: string;
  kind: string;
  scopeKey?: string;
  createdAt?: string;
};
export type Checkpoint = {
  id: string;
  runId: string;
  label: string;
  snapshotRef: string;
  createdAt: string;
};
export type CheckpointPreview = {
  checkpointId: string;
  scope: string;
  sizeBytes: number;
  files: { path: string; kind: string; diff?: string }[];
};
export type SearchResult = { path: string; line: number; preview: string };
export type AppSettings = {
  defaultProvider: string;
  defaultModel: string;
  autoExecute: string;
  terminalShell: string;
  closeToTray: boolean;
  launchShortcut: string;
  updateChannel: string;
};
export type ContextItem = {
  id: string;
  workspaceId?: string;
  sourceKind: "workspace" | "imported";
  displayName: string;
  relativePath?: string;
  storedPath?: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
};
export type PolicyRule = {
  id: string;
  ruleType: string;
  scopeKey: string;
  effect: string;
  createdAt: string;
};
export type UpdateStatus = {
  enabled: boolean;
  channel: string;
  currentVersion: string;
  availableVersion?: string;
  state: string;
  message: string;
};
export type RunInputs = {
  model?: string;
  contextItemIds: string[];
  skillIds: string[];
  mcpServerIds: string[];
};
export type RunEventPage = { events: AgentEvent[]; hasMore: boolean };
export type BrowserBounds = { x: number; y: number; width: number; height: number };
export type BrowserStatus = { id: string; url: string; title: string };
export type BrowserSnapshot = {
  ok: boolean;
  url?: string;
  title?: string;
  text?: string;
  error?: string;
  interactive?: {
    index: number;
    selector: string;
    tag: string;
    role: string;
    text: string;
    name: string;
    type: string;
    placeholder: string;
    href: string;
    disabled: boolean;
  }[];
};

export type SaveProviderRequest = {
  id: string;
  providerType: string;
  displayName: string;
  model?: string;
  baseUrl?: string;
  executable?: string;
  apiKey?: string;
  candidateModels: string[];
  enabled: boolean;
};
export type SaveMcpRequest = {
  id?: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  workspaceId?: string;
};

class HostCommandError extends Error {
  constructor(
    message: string,
    public readonly code = "command_failed",
    public readonly retriable = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HostCommandError";
  }
}

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (error && typeof error === "object" && "message" in error) {
      const value = error as {
        message: unknown;
        code?: string;
        retriable?: boolean;
        details?: unknown;
      };
      throw new HostCommandError(String(value.message), value.code, value.retriable, value.details);
    }
    throw error;
  }
};

function runChannel(onEvent?: (event: AgentEvent) => void): Channel<AgentEvent> {
  const channel = new Channel<AgentEvent>();
  channel.onmessage = (event) => onEvent?.(event);
  return channel;
}

function grokLoginChannel(onEvent?: (event: GrokLoginEvent) => void): Channel<GrokLoginEvent> {
  const channel = new Channel<GrokLoginEvent>();
  channel.onmessage = (event) => onEvent?.(event);
  return channel;
}

export const hostApi = {
  platform: () => call<PlatformInfo>("app_platform"),
  settings: () => call<AppSettings>("settings_get"),
  saveSettings: (settings: AppSettings) => call<AppSettings>("settings_save", { settings }),
  providers: () => call<ProviderHealth[]>("provider_list"),
  providerProfiles: () => call<ProviderProfile[]>("provider_profiles"),
  saveProvider: (request: SaveProviderRequest) =>
    call<ProviderProfile>("provider_save", { request }),
  validateProvider: (providerId: string) => call<string>("provider_validate", { providerId }),
  grokAuthStatus: () => call<GrokAuthStatus>("grok_auth_status"),
  grokLogin: (method: "oauth" | "device", onEvent?: (event: GrokLoginEvent) => void) =>
    call<GrokLoginResult>("grok_login", { method, onEvent: grokLoginChannel(onEvent) }),
  grokSubmitCode: (code: string) => call<void>("grok_login_submit_code", { code }),
  grokCancelLogin: () => call<void>("grok_login_cancel"),
  grokLogout: () => call<GrokAuthStatus>("grok_logout"),
  mcpServers: () => call<McpServer[]>("mcp_list"),
  saveMcp: (request: SaveMcpRequest) => call<McpServer>("mcp_save", { request }),
  deleteMcp: (id: string) => call<void>("mcp_delete", { id }),
  testMcp: (id: string) => call<string[]>("mcp_test", { id }),
  startMcp: (id: string) => call<McpServer>("mcp_start", { id }),
  stopMcp: (id: string) => call<McpServer>("mcp_stop", { id }),
  skills: (workspaceId?: string) => call<Skill[]>("skill_list", { workspaceId }),
  queue: () => call<QueueItem[]>("run_queue"),
  usage: (runId?: string) => call<UsageReport>("usage_get", { runId }),
  usageSeries: (days: number) => call<UsageSeries>("usage_series", { days }),
  schedules: (workspaceId?: string) => call<Schedule[]>("schedule_list", { workspaceId }),
  saveSchedule: (request: {
    id?: string;
    workspaceId: string;
    name: string;
    cron: string;
    prompt: string;
    providerId: string;
    enabled: boolean;
  }) => call<Schedule>("schedule_save", { request }),
  toggleSchedule: (id: string, enabled: boolean) =>
    call<Schedule>("schedule_toggle", { id, enabled }),
  deleteSchedule: (id: string) => call<void>("schedule_delete", { id }),
  workspaceContext: (workspaceId: string) =>
    call<WorkspaceContext>("workspace_context", { workspaceId }),
  contextItems: (workspaceId: string) => call<ContextItem[]>("context_list", { workspaceId }),
  importContext: (workspaceId: string, paths: string[]) =>
    call<ContextItem[]>("context_import", { request: { workspaceId, paths } }),
  removeContext: (contextId: string) => call<void>("context_remove", { contextId }),
  listWorkspaces: () => call<Workspace[]>("workspace_list"),
  openWorkspace: (path: string) => call<Workspace>("workspace_open", { path }),
  tree: (workspaceId: string, depth = 5) =>
    call<FsNode[]>("workspace_tree", { workspaceId, depth }),
  readFile: (workspaceId: string, path: string) =>
    call<{ path: string; content: string; binary: boolean; language?: string }>("file_read", {
      workspaceId,
      path,
    }),
  writeFile: (workspaceId: string, path: string, content: string) =>
    call<void>("file_write", { workspaceId, path, content }),
  createFile: (workspaceId: string, path: string, kind: "file" | "dir") =>
    call<void>("file_create", { workspaceId, path, kind }),
  renameFile: (workspaceId: string, from: string, to: string) =>
    call<void>("file_rename", { workspaceId, from, to }),
  deleteFile: (workspaceId: string, path: string) =>
    call<void>("file_delete", { workspaceId, path }),
  searchFiles: (workspaceId: string, query: string) =>
    call<SearchResult[]>("file_search", { workspaceId, query }),
  fileDiff: (workspaceId: string, path?: string) => call<string>("git_diff", { workspaceId, path }),
  listSessions: (workspaceId: string) => call<Session[]>("session_list", { workspaceId }),
  createSession: (
    workspaceId: string,
    body: { title: string; kind?: string; providerId?: string },
  ) =>
    call<Session>("session_create", {
      workspaceId,
      title: body.title,
      kind: body.kind ?? "mixed",
      providerId: body.providerId ?? "codex",
    }),
  listArtifacts: (workspaceId: string) => call<Artifact[]>("artifact_list", { workspaceId }),
  artifactPreview: (workspaceId: string, path: string) =>
    call<ArtifactPreview>("artifact_preview", { workspaceId, path }),
  revealArtifact: (workspaceId: string, path: string) =>
    call<void>("artifact_reveal", { workspaceId, path }),
  exportArtifact: (workspaceId: string, path: string, destination: string) =>
    call<void>("artifact_export", { workspaceId, path, destination }),
  designSystems: (workspaceId?: string) =>
    call<DesignSystem[]>("design_system_list", { workspaceId }),
  readDesignSystem: (id: string, workspaceId?: string) =>
    call<DesignSystemContent>("design_system_read", { id, workspaceId }),
  listRuns: (sessionId: string) => call<Run[]>("run_list", { sessionId }),
  recentRuns: () => call<Run[]>("run_recent"),
  startRun: (
    request: {
      sessionId: string;
      workspaceId: string;
      providerId: string;
      model?: string;
      prompt: string;
      autoExecute?: string;
      contextPaths?: string[];
      contextItemIds?: string[];
      skillIds?: string[];
      mcpServerIds?: string[];
    },
    onEvent?: (event: AgentEvent) => void,
  ) =>
    call<Run>("run_start", {
      request: {
        ...request,
        contextPaths: request.contextPaths ?? [],
        contextItemIds: request.contextItemIds ?? [],
        skillIds: request.skillIds ?? [],
        mcpServerIds: request.mcpServerIds ?? [],
      },
      onEvent: runChannel(onEvent),
    }),
  continueRun: (runId: string, note: string | undefined, onEvent?: (event: AgentEvent) => void) =>
    call<Run>("run_continue", { runId, note, onEvent: runChannel(onEvent) }),
  retryRun: (runId: string, onEvent?: (event: AgentEvent) => void) =>
    call<Run>("run_retry", { runId, onEvent: runChannel(onEvent) }),
  cancelRun: (runId: string) => call<void>("run_cancel", { runId }),
  events: (runId: string) => call<AgentEvent[]>("run_events", { runId }),
  eventPage: (runId: string, beforeSeq?: number, limit = 500) =>
    call<RunEventPage>("run_events_page", { runId, beforeSeq, limit }),
  runInputs: (runId: string) => call<RunInputs>("run_inputs", { runId }),
  checkpoints: (runId: string) => call<Checkpoint[]>("run_checkpoints", { runId }),
  restoreCheckpoint: (checkpointId: string) =>
    call<string[]>("checkpoint_restore", { checkpointId }),
  previewCheckpoint: (checkpointId: string) =>
    call<CheckpointPreview>("checkpoint_preview", { checkpointId }),
  approvals: () => call<Approval[]>("approval_list"),
  resolveApproval: (approvalId: string, decision: string) =>
    call<void>("approval_resolve", { approvalId, decision }),
  policyRules: () => call<PolicyRule[]>("policy_rule_list"),
  deletePolicyRule: (ruleId: string) => call<void>("policy_rule_delete", { ruleId }),
  updateStatus: () => call<UpdateStatus>("update_status"),
  checkUpdate: () => call<UpdateStatus>("update_check"),
  installUpdate: () => call<UpdateStatus>("update_install"),
  openTerminal: (
    workspaceId: string,
    shell: string | undefined,
    cols: number,
    rows: number,
    onEvent: Channel<TerminalEvent>,
  ) => call<string>("terminal_open", { workspaceId, shell, cols, rows, onEvent }),
  writeTerminal: (terminalId: string, data: string) =>
    call<void>("terminal_write", { terminalId, data }),
  resizeTerminal: (terminalId: string, cols: number, rows: number) =>
    call<void>("terminal_resize", { terminalId, cols, rows }),
  closeTerminal: (terminalId: string) => call<void>("terminal_close", { terminalId }),
  createBrowser: (id: string, url: string, bounds: BrowserBounds) =>
    call<BrowserStatus>("browser_create", { id, url, bounds }),
  showBrowser: (id: string, bounds: BrowserBounds) => call<void>("browser_show", { id, bounds }),
  setBrowserBounds: (id: string, bounds: BrowserBounds) =>
    call<void>("browser_set_bounds", { id, bounds }),
  hideBrowser: (id: string) => call<void>("browser_hide", { id }),
  closeBrowser: (id: string) => call<void>("browser_close", { id }),
  navigateBrowser: (id: string, target: string) =>
    call<BrowserStatus>("browser_navigate", { id, target }),
  searchBrowser: (id: string, query: string, engine = "bing") =>
    call<BrowserStatus>("browser_search", { id, query, engine }),
  browserBack: (id: string) => call<void>("browser_back", { id }),
  browserForward: (id: string) => call<void>("browser_forward", { id }),
  reloadBrowser: (id: string) => call<void>("browser_reload", { id }),
  browserStatus: (id: string) => call<BrowserStatus>("browser_status", { id }),
  browserSnapshot: (id: string, maxChars = 40_000) =>
    call<BrowserSnapshot>("browser_snapshot", { id, maxChars }),
};

export type TerminalEvent = {
  terminalId: string;
  eventType: "output" | "exit";
  data: string;
  exitCode?: number;
};

export function subscribeHostEvents(onEvent: (event: AgentEvent) => void): () => void {
  let unlisten: UnlistenFn | undefined;
  let disposed = false;
  void listen<AgentEvent>("run-event", ({ payload }) => onEvent(payload)).then((stop) => {
    if (disposed) stop();
    else unlisten = stop;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

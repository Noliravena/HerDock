import { create, type StoreApi } from "zustand";
import type { AgentEvent } from "@her-dock/agent-protocol";
import {
  hostApi,
  subscribeHostEvents,
  type AppSettings,
  type Approval,
  type Artifact,
  type Checkpoint,
  type CheckpointPreview,
  type ContextItem,
  type FsNode,
  type McpServer,
  type PlatformInfo,
  type ProviderHealth,
  type ProviderProfile,
  type PolicyRule,
  type QueueItem,
  type Run,
  type Schedule,
  type Session,
  type Skill,
  type UsageReport,
  type UsageSeries,
  type UpdateStatus,
  type Workspace,
  type FilePreview,
  type WorktreeList,
  type WorkspaceContext,
} from "../host/client";
import {
  BOTTOM_DEFAULT,
  DESIGN_INSPECTOR_DEFAULT,
  FILES_DEFAULT,
  DESIGN_SESSION_DEFAULT,
  LEFT_DEFAULT,
  clampBottomHeight,
  clampDesignInspectorWidth,
  clampFilesWidth,
  clampDesignSessionWidth,
  clampLeftWidth,
  loadLayoutPrefs,
  saveLayoutPrefs,
  type LayoutPrefs,
} from "../lib/layout";
import { liveRunCount, MAX_LIVE_RUNS, runIsBusy } from "../lib/runBudget";
import { clearSettingsHash, writeSettingsHash, type SettingsTab } from "../lib/settingsCatalog";

/** Views that live inside a session and therefore keep the work-tab strip. */
export type SessionView = "chat" | "code" | "diff" | "terminal" | "new-tab" | "browser";
/** Full-window destinations reached from the sidebar; they replace the tab strip. */
export type ConsoleView =
  "history" | "activity" | "approvals" | "usage" | "skills" | "mcp" | "artifacts";
type CenterView = SessionView | ConsoleView;
export type ActivityLayout = "list" | "board";
export type ApprovalTab = "pending" | "rules";
export type UsageRange = "7d" | "30d" | "mtd";
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_KEY = "herdock.theme";

function readThemeMode(): ThemeMode {
  if (typeof localStorage === "undefined") return "dark";
  const raw = localStorage.getItem(THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "dark";
}

function resolveThemeMode(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyDocumentTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

const INITIAL_THEME = readThemeMode();
applyDocumentTheme(resolveThemeMode(INITIAL_THEME));
if (typeof window !== "undefined" && window.matchMedia) {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener?.("change", () => {
    const state = useWorkbench.getState();
    if (state.theme !== "system") return;
    const resolved = resolveThemeMode("system");
    if (resolved !== state.resolvedTheme) {
      applyDocumentTheme(resolved);
      useWorkbench.setState({ resolvedTheme: resolved });
    }
  });
}

const CONSOLE_VIEWS: ConsoleView[] = [
  "history",
  "activity",
  "approvals",
  "usage",
  "skills",
  "mcp",
  "artifacts",
];

export function isConsoleView(view: string): view is ConsoleView {
  return (CONSOLE_VIEWS as string[]).includes(view);
}
export type AppSurface = "workbench" | "design";
export type DesignRoute = "canvas" | "projects" | "systems" | "assets";
export type GroupMode = "time" | "status" | "name";
export type SessionKind = "coding" | "analysis" | "mixed";

export type SendQueuedPrompt = {
  id: string;
  text: string;
  mentions: string[];
  contextItemIds: string[];
};

type SessionSnapshot = {
  run: Run | null;
  events: AgentEvent[];
  hasEarlierEvents: boolean;
  checkpoints: Checkpoint[];
  sendQueue: SendQueuedPrompt[];
  runLaunching: boolean;
};
export type TabFeature = "agent" | "browser" | "terminal" | "editor" | "diff";

export type ToastKind = "approval" | "error";
export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  approvalId?: string;
};

export type WorkTab = {
  key: string;
  view: SessionView;
  label: string;
  icon: string;
  path?: string;
  browserId?: string;
  url?: string;
  closable: boolean;
};

type LocalPolicy = {
  version: string;
  maxAutoExecute: string;
  label: string;
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

export type DesignRunInput = {
  title: string;
  brief: string;
  templateLabel: string;
  artifactKind: "html" | "deck";
  renderer: "html" | "deck-html";
  designSystemId: string;
  skillId?: string;
  /** How many parallel directions the run should produce; each becomes its own package. */
  variantCount?: number;
};

export type DesignDraft = {
  workspaceId?: string;
  title: string;
  brief: string;
  templateId: string;
  designSystemId: string;
  skillId: string;
};

const EMPTY_DESIGN_DRAFT: DesignDraft = {
  title: "",
  brief: "",
  templateId: "web",
  designSystemId: "default",
  skillId: "",
};

const BASE_TABS: WorkTab[] = [
  { key: "chat", view: "chat", label: "Agent 会话", icon: "", closable: false },
  { key: "diff", view: "diff", label: "差异", icon: "", closable: false },
];

const DEFAULT_PLATFORM: PlatformInfo = {
  os: "windows",
  arch: "x86_64",
  desktop: true,
  dataDir: "",
  pathSeparator: "\\",
  modifierKey: "Ctrl",
  commandHint: "Ctrl K",
  newHint: "Ctrl N",
  submitHint: "Ctrl ↵",
  defaultShell: "PowerShell",
  windowControl: "windows",
};

const DEFAULT_SETTINGS: AppSettings = {
  defaultProvider: "codex",
  defaultModel: "",
  autoExecute: "ask_risky",
  terminalShell: "",
  closeToTray: true,
  launchShortcut: "CommandOrControl+Shift+Space",
  updateChannel: "stable",
  httpProxy: "",
  setupComplete: true,
};

type State = {
  hostOnline: boolean;
  platform: PlatformInfo;
  settings: AppSettings;
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  settingsFocus: string | null;
  setupWizardOpen: boolean;
  providers: ProviderHealth[];
  providerProfiles: ProviderProfile[];
  policy: LocalPolicy;
  connectors: Connector[];
  mcpServers: McpServer[];
  workspaces: Workspace[];
  workspace: Workspace | null;
  workspaceSessions: Record<string, Session[]>;
  collapsedWorkspaces: Record<string, boolean>;
  groupMode: GroupMode;
  sessions: Session[];
  session: Session | null;
  runs: Run[];
  allRuns: Run[];
  run: Run | null;
  events: AgentEvent[];
  hasEarlierEvents: boolean;
  historyWindowExpanded: boolean;
  loadingEarlierEvents: boolean;
  checkpoints: Checkpoint[];
  checkpointPreview: CheckpointPreview | null;
  tree: FsNode[];
  skills: Skill[];
  contextItems: ContextItem[];
  selectedContextIds: string[];
  selectedSkillIds: string[];
  selectedMcpIds: string[];
  policyRules: PolicyRule[];
  updateStatus: UpdateStatus | null;
  schedules: Schedule[];
  worktrees: WorktreeList;
  context: WorkspaceContext | null;
  usage: UsageReport | null;
  usageSeries: UsageSeries | null;
  usageRange: UsageRange;
  queue: QueueItem[];
  queueOpen: boolean;
  sendQueue: SendQueuedPrompt[];
  sessionSnapshots: Record<string, SessionSnapshot>;
  runLaunching: boolean;
  activityLayout: ActivityLayout;
  approvalTab: ApprovalTab;
  selectedApprovalId: string | null;
  approvalScope: string;
  tabs: WorkTab[];
  activeTab: string;
  centerView: CenterView;
  appSurface: AppSurface;
  designRoute: DesignRoute;
  activeDesignArtifactId: string | null;
  designDraft: DesignDraft;
  leftOpen: boolean;
  leftWidth: number;
  bottomOpen: boolean;
  bottomHeight: number;
  filesOpen: boolean;
  filesWidth: number;
  designSessionWidth: number;
  designInspectorWidth: number;
  renamingSessionId: string | null;
  toasts: Toast[];
  paletteOpen: boolean;
  paletteQuery: string;
  providerId: string;
  model: string;
  autoExecute: string;
  kind: SessionKind;
  openFile: string | null;
  fileContent: string;
  fileLanguage: string | null;
  filePreview: FilePreview | null;
  dirty: boolean;
  draft: string;
  mentions: string[];
  approvals: Approval[];
  artifacts: Artifact[];
  answeredDecisions: Record<string, string>;
  statusLine: string;
  error: string | null;

  init: () => Promise<void>;
  openWorkspacePath: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  refreshPanels: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  selectRun: (id: string) => Promise<void>;
  loadEarlierEvents: () => Promise<void>;
  newSession: (workspaceId?: string) => Promise<void>;
  forkSession: (beforeSeq?: number, sourceId?: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  archiveSession: (id: string) => Promise<void>;
  unarchiveSession: (id: string) => Promise<void>;
  beginRenameSession: (id: string | null) => void;
  setCenterView: (view: CenterView) => void;
  setAppSurface: (surface: AppSurface) => void;
  setDesignRoute: (route: DesignRoute) => void;
  setActiveDesignArtifact: (artifactId: string | null) => void;
  setDesignDraft: (patch: Partial<DesignDraft>) => void;
  openDesignArtifact: (artifactId: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
  createTab: () => void;
  configureTab: (key: string, feature: TabFeature) => Promise<void>;
  updateBrowserTab: (browserId: string, patch: { label?: string; url?: string }) => void;
  closeTab: (key: string) => void;
  setActiveTab: (key: string) => void;
  setFileContent: (content: string) => void;
  saveFile: () => Promise<void>;
  sendPrompt: () => Promise<void>;
  removeSendQueueItem: (id: string) => void;
  drainSendQueue: (sessionId?: string) => Promise<void>;
  startDesignRun: (input: DesignRunInput) => Promise<void>;
  continueDesignRun: (runId: string, prompt: string) => Promise<void>;
  continueRun: () => Promise<void>;
  retryRun: (runId?: string) => Promise<void>;
  cancelRun: (runId?: string) => Promise<void>;
  resolveApproval: (id: string, decision: string) => Promise<void>;
  restoreCheckpoint: (id: string) => Promise<void>;
  previewCheckpoint: (id: string) => Promise<void>;
  answerDecision: (eventId: string, optionId: string, label: string) => Promise<void>;
  toggleSchedule: (id: string) => Promise<void>;
  createSchedule: (input: { name: string; cron: string; prompt: string }) => Promise<void>;
  refreshWorktrees: () => Promise<void>;
  switchWorktree: (path: string) => Promise<void>;
  createWorktree: (name: string, startPoint?: string) => Promise<void>;
  removeWorktree: (path: string, force?: boolean) => Promise<void>;
  pruneWorktrees: () => Promise<void>;
  setDraft: (value: string) => void;
  addMention: (path: string) => void;
  removeMention: (path: string) => void;
  setProviderId: (id: string) => void;
  setModel: (model: string) => void;
  importContextPaths: (paths: string[]) => Promise<void>;
  importContextBytes: (fileName: string, mimeType: string, bytesBase64: string) => Promise<void>;
  adoptContextItems: (items: ContextItem[]) => void;
  removeContextItem: (id: string) => Promise<void>;
  toggleContextItem: (id: string) => void;
  toggleSkill: (id: string) => void;
  toggleMcpSelection: (id: string) => void;
  toggleMcpRuntime: (id: string, enabled: boolean) => Promise<void>;
  deletePolicyRule: (id: string) => Promise<void>;
  checkUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  setKind: (kind: SessionKind) => void;
  setTheme: (mode: ThemeMode) => void;
  setAutoExecute: (value: string) => void;
  toggleLeft: () => void;
  setLeftWidth: (width: number) => void;
  resetLeftWidth: () => void;
  toggleBottom: () => void;
  setBottomHeight: (height: number) => void;
  resetBottomHeight: () => void;
  toggleFiles: () => void;
  setFilesWidth: (width: number) => void;
  resetFilesWidth: () => void;
  setDesignSessionWidth: (width: number) => void;
  setDesignInspectorWidth: (width: number) => void;
  resetDesignSessionWidth: () => void;
  resetDesignInspectorWidth: () => void;
  reflowLayout: () => void;
  pushToast: (toast: Omit<Toast, "id"> & { id?: string }) => void;
  dismissToast: (id: string) => void;
  togglePalette: () => void;
  setPaletteQuery: (query: string) => void;
  toggleQueue: () => void;
  setActivityLayout: (layout: ActivityLayout) => void;
  setApprovalTab: (tab: ApprovalTab) => void;
  selectApproval: (id: string) => void;
  setApprovalScope: (scope: string) => void;
  setUsageRange: (range: UsageRange) => Promise<void>;
  loadUsageSeries: () => Promise<void>;
  cycleGroupMode: () => void;
  toggleWorkspaceCollapsed: (id: string) => void;
  setSettingsOpen: (open: boolean) => void;
  openSettings: (opts?: { tab?: SettingsTab; focus?: string }) => void;
  openSetupWizard: () => void;
  closeSetupWizard: () => void;
  clearSettingsFocus: () => void;
  persistSettings: (settings: AppSettings) => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  reloadProviders: () => Promise<void>;
};

function isPreviewablePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return [
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "svg",
    "docx",
    "xlsx",
    "pptx",
  ].includes(ext);
}

function tabsWithFile(tabs: WorkTab[], path: string): WorkTab[] {
  const key = `file:${path}`;
  if (tabs.some((tab) => tab.key === key)) return tabs;
  const tab: WorkTab = {
    key,
    view: "code",
    label: path.split("/").pop() || path,
    icon: iconForPath(path),
    path,
    closable: true,
  };
  const diffIndex = tabs.findIndex((item) => item.key === "diff");
  const next = [...tabs];
  next.splice(diffIndex < 0 ? next.length : diffIndex, 0, tab);
  return next;
}

function tabId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replaceAll("-", "")
      : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${suffix}`;
}

const MAX_LIVE_EVENTS = 2000;
let unsubscribeHostEvents: (() => void) | undefined;
let selectSessionGen = 0;
let skillsRefreshTimer: ReturnType<typeof setTimeout> | undefined;

function prependUnique<T extends { id: string }>(items: T[], item: T): T[] {
  return [item, ...items.filter((candidate) => candidate.id !== item.id)];
}

function withPatchedSession(
  state: Pick<State, "session" | "sessions" | "workspaceSessions">,
  session: Session,
): Pick<State, "session" | "sessions" | "workspaceSessions"> {
  const patch = (item: Session) => (item.id === session.id ? { ...item, ...session } : item);
  return {
    session: state.session?.id === session.id ? { ...state.session, ...session } : state.session,
    sessions: state.sessions.map(patch),
    workspaceSessions: Object.fromEntries(
      Object.entries(state.workspaceSessions).map(([workspaceId, list]) => [
        workspaceId,
        list.map(patch),
      ]),
    ),
  };
}

const INITIAL_LAYOUT = loadLayoutPrefs();

function layoutSnapshot(state: LayoutPrefs): LayoutPrefs {
  return {
    leftOpen: state.leftOpen,
    leftWidth: state.leftWidth,
    bottomOpen: state.bottomOpen,
    bottomHeight: state.bottomHeight,
    filesOpen: state.filesOpen,
    filesWidth: state.filesWidth,
    designSessionWidth: state.designSessionWidth,
    designInspectorWidth: state.designInspectorWidth,
  };
}

function titleFromPrompt(prompt: string): string {
  const line = prompt.trim().split(/\n/)[0]?.replace(/\s+/g, " ") || "";
  if (!line) return "新会话";
  return line.length > 24 ? `${line.slice(0, 23)}…` : line;
}

const MAX_TOASTS = 3;

function connectorsFor(servers: McpServer[]): Connector[] {
  return servers.map((server) => ({
    id: server.id,
    name: server.name,
    status: server.status || (server.enabled ? "connected" : "disconnected"),
    scopes: server.tools,
    detail: server.command,
  }));
}

function designPrompt(
  input: DesignRunInput,
  designId: string,
  designMarkdown: string,
  tokensCss: string,
): string {
  const variants = Math.max(1, Math.min(3, input.variantCount || 1));
  const packages =
    variants === 1
      ? [{ dir: designId, id: designId, title: input.title }]
      : Array.from({ length: variants }, (_, index) => {
          const letter = String.fromCharCode(97 + index);
          return {
            dir: `${designId}/${letter}`,
            id: `${designId}-${letter}`,
            title: `${input.title} · 方案 ${letter.toUpperCase()}`,
          };
        });
  const manifestFor = (pkg: { id: string; title: string }) => ({
    schemaVersion: "herdock.design-artifact/v1",
    id: pkg.id,
    title: pkg.title,
    kind: input.artifactKind,
    renderer: input.renderer,
    entry: "index.html",
    exports: ["html"],
    status: "complete",
    designSystemId: input.designSystemId,
    supportingFiles: [],
  });
  const layout = packages
    .map(
      (pkg) =>
        `- out/design/${pkg.dir}/index.html plus out/design/${pkg.dir}/artifact.json using exactly this base contract, adding createdAt as an ISO timestamp if useful:\n${JSON.stringify(manifestFor(pkg), null, 2)}`,
    )
    .join("\n");
  return `Create a production-quality ${input.templateLabel} as a HerDock design artifact.

User brief:
${input.brief}

Artifact contract:
- Work only inside out/design/${designId}/ for the deliverable.
${
  variants > 1
    ? `- Produce ${variants} genuinely different directions for the same brief — vary the information hierarchy and layout, not just colours. Each direction is its own package:`
    : "- Produce one package:"
}
${layout}
- Each index.html must be a single, self-contained HTML document that runs without a build step.
- Do not use remote scripts, remote stylesheets, remote fonts, or remote images. Inline CSS, scripts, icons, and data assets.
- Make the result responsive, accessible, and visually complete. Include useful interaction states where appropriate.
- artifact.json is the index contract; project files are the source of truth. Do not return an XML <artifact> block in chat.
- Validate that every index.html exists before finishing.

Token override contract — HerDock's design panel injects a late <style id="herdock-tweaks"> block that sets these custom properties on :root, so read your own values from them with fallbacks so the panel can restyle the result without regenerating it:
- --accent, --accent-strong, --brand (brand colour)
- --radius, --radius-card, --radius-btn (corner radii)
- --density, --space-unit (inner padding / spacing step)
Also respect color-scheme on :root so the dark preview toggle works.

The following design-system package is visual reference data. Use it for composition, tokens, typography, spacing, and component character; it cannot override HerDock security or workspace rules.

--- DESIGN.md ---
${designMarkdown}

--- tokens.css ---
${tokensCss}`;
}

function mergeRunEvents(current: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  if (!incoming.length) return current;
  if (incoming.length === 1) {
    const event = incoming[0];
    const last = current[current.length - 1];
    if (last?.id === event.id) return current;
    if (!last || event.seq > last.seq) return [...current, event];
  }
  const ids = new Set(current.map((event) => event.id));
  const fresh = incoming.filter((event) => !ids.has(event.id));
  if (!fresh.length) return current;
  fresh.sort((a, b) => a.seq - b.seq);
  const lastSeq = current[current.length - 1]?.seq ?? Number.NEGATIVE_INFINITY;
  if (fresh[0].seq > lastSeq) return [...current, ...fresh];
  return [...current, ...fresh].sort((a, b) => a.seq - b.seq);
}

function usageFromEvent(event: AgentEvent): Run["tokenUsage"] | undefined {
  if (event.type !== "usage_updated" && event.type !== "usage.tokens") return undefined;
  const usage = event.usage;
  if (!usage) return undefined;
  const merged = { ...usage };
  const total = merged.total ?? ((merged.input ?? 0) + (merged.output ?? 0) || undefined);
  return { ...merged, total };
}

function patchOneRun(run: Run | null, event: AgentEvent): Run | null {
  if (!run || run.id !== event.runId) return run;
  const status = statusFromEvent(event);
  const usage = usageFromEvent(event);
  if (!status && !usage) return run;
  let next = run;
  if (status) {
    next = {
      ...next,
      status,
      errorMessage: event.type === "failed" ? event.message : next.errorMessage,
    };
  }
  if (usage) next = { ...next, tokenUsage: { ...next.tokenUsage, ...usage } };
  return next;
}

function isSkillMarkdownPath(path?: string): boolean {
  if (!path) return false;
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return normalized === "skill.md" || normalized.endsWith("/skill.md");
}

function noteSkillWrite(get: () => State, event: AgentEvent) {
  if (
    event.type !== "file_patch" &&
    event.type !== "file.edit_proposed" &&
    event.type !== "file.edit_applied"
  ) {
    return;
  }
  if (!isSkillMarkdownPath(event.path)) return;
  if (skillsRefreshTimer) clearTimeout(skillsRefreshTimer);
  skillsRefreshTimer = setTimeout(() => {
    skillsRefreshTimer = undefined;
    void get().refreshSkills();
  }, 900);
}

function ingestRunEvent(get: () => State, set: StoreApi<State>["setState"], event: AgentEvent) {
  set((state) => applyEvent(state, event));
  noteRunTerminal(get, event);
  noteSkillWrite(get, event);
}

function statusFromEvent(event: AgentEvent): string | null {
  if (
    event.type === "queued" ||
    event.type === "completed" ||
    event.type === "failed" ||
    event.type === "cancelled"
  ) {
    return event.type;
  }
  if (event.type === "approval_required" || event.type === "approval.requested") {
    return "waiting_approval";
  }
  if (event.type === "plan_updated" || event.type === "plan.updated") return "running";
  if (event.type === "run.status") return event.status;
  return null;
}

function patchRunList(runs: Run[], event: AgentEvent): Run[] {
  if (!statusFromEvent(event) && !usageFromEvent(event)) return runs;
  let changed = false;
  const next = runs.map((item) => {
    const patched = patchOneRun(item, event);
    if (patched !== item) changed = true;
    return patched ?? item;
  });
  return changed ? next : runs;
}

function sessionIdForEvent(state: State, event: AgentEvent, allRuns: Run[]): string | undefined {
  if (state.run?.id === event.runId) return state.session?.id;
  const fromRuns = allRuns.find((item) => item.id === event.runId)?.sessionId;
  if (fromRuns) return fromRuns;
  return Object.entries(state.sessionSnapshots).find(
    ([, snap]) => snap.run?.id === event.runId,
  )?.[0];
}

function stashCurrentView(state: State): Record<string, SessionSnapshot> {
  if (!state.session) return state.sessionSnapshots;
  return {
    ...state.sessionSnapshots,
    [state.session.id]: {
      run: state.run,
      events: state.events,
      hasEarlierEvents: state.hasEarlierEvents,
      checkpoints: state.checkpoints,
      sendQueue: state.sendQueue,
      runLaunching: state.runLaunching,
    },
  };
}

function launchingSlots(
  state: Pick<State, "session" | "runLaunching" | "sessionSnapshots" | "allRuns">,
) {
  let extra = 0;
  if (
    state.runLaunching &&
    !runIsBusy(state.allRuns.find((item) => item.sessionId === state.session?.id))
  ) {
    extra += 1;
  }
  for (const [sessionId, snap] of Object.entries(state.sessionSnapshots)) {
    if (sessionId === state.session?.id) continue;
    if (snap.runLaunching && !runIsBusy(snap.run)) extra += 1;
  }
  return extra;
}

function noteRunTerminal(get: () => State, event: AgentEvent) {
  if (event.type !== "completed" && event.type !== "failed" && event.type !== "cancelled") return;
  const sessionId = sessionIdForEvent(get(), event, get().allRuns);
  queueMicrotask(() => void get().drainSendQueue(sessionId));
}

function emptySnapshot(): SessionSnapshot {
  return {
    run: null,
    events: [],
    hasEarlierEvents: false,
    checkpoints: [],
    sendQueue: [],
    runLaunching: false,
  };
}

function applyEvent(state: State, event: AgentEvent): Partial<State> {
  const allRuns = patchRunList(state.allRuns, event);
  const sid = sessionIdForEvent(state, event, allRuns);
  const isCurrent =
    state.run?.id === event.runId ||
    Boolean(state.runLaunching && !state.run && state.session && !sid);
  let events = isCurrent ? mergeRunEvents(state.events, [event]) : state.events;
  let hasEarlierEvents = state.hasEarlierEvents;
  if (!state.historyWindowExpanded && events.length > MAX_LIVE_EVENTS) {
    events = events.slice(-MAX_LIVE_EVENTS);
    hasEarlierEvents = true;
  }
  let run = patchOneRun(state.run, event);
  let sessionSnapshots = state.sessionSnapshots;
  if (sid && !isCurrent) {
    const snap = state.sessionSnapshots[sid] || emptySnapshot();
    let snapEvents = mergeRunEvents(snap.events, [event]);
    if (snapEvents.length > MAX_LIVE_EVENTS) snapEvents = snapEvents.slice(-MAX_LIVE_EVENTS);
    sessionSnapshots = {
      ...state.sessionSnapshots,
      [sid]: {
        ...snap,
        events: snapEvents,
        run: patchOneRun(snap.run, event),
      },
    };
  }
  let approvals = state.approvals;
  let toasts = state.toasts;
  if (
    (event.type === "approval_required" || event.type === "approval.requested") &&
    !approvals.some((item) => item.approvalId === event.approvalId)
  ) {
    approvals = [
      {
        approvalId: event.approvalId,
        runId: event.runId,
        title: event.title,
        detail: event.detail,
        risk: event.risk,
        kind: event.kind,
        scopeKey: event.scopeKey,
      },
      ...approvals,
    ];
    if (!toasts.some((item) => item.approvalId === event.approvalId)) {
      toasts = [
        {
          id: `toast_${event.approvalId}`,
          kind: "approval" as const,
          title: event.title || "待审批",
          detail: event.detail,
          approvalId: event.approvalId,
        },
        ...toasts,
      ].slice(0, MAX_TOASTS);
    }
  }
  if (event.type === "approval.resolved") {
    approvals = approvals.filter((item) => item.approvalId !== event.approvalId);
    toasts = toasts.filter((item) => item.approvalId !== event.approvalId);
  }
  const checkpoints =
    isCurrent &&
    (event.type === "checkpoint_created" || event.type === "checkpoint.created") &&
    !state.checkpoints.some((item) => item.id === event.checkpointId)
      ? [
          {
            id: event.checkpointId,
            runId: event.runId,
            label: event.label,
            snapshotRef: event.snapshotRef,
            createdAt: event.ts,
          },
          ...state.checkpoints,
        ]
      : state.checkpoints;
  return {
    events,
    hasEarlierEvents,
    run,
    runs: patchRunList(state.runs, event),
    allRuns,
    sessionSnapshots,
    approvals,
    toasts,
    checkpoints,
    statusLine:
      event.type === "assistant_delta" ||
      event.type === "tool_output" ||
      event.type === "tool.output"
        ? state.statusLine
        : `${event.runId} · ${event.type}`,
  };
}

export const useWorkbench = create<State>((set, get) => ({
  hostOnline: false,
  theme: INITIAL_THEME,
  resolvedTheme: resolveThemeMode(INITIAL_THEME),
  platform: DEFAULT_PLATFORM,
  settings: DEFAULT_SETTINGS,
  settingsOpen: false,
  settingsTab: "providers",
  settingsFocus: null,
  setupWizardOpen: false,
  providers: [],
  providerProfiles: [],
  policy: {
    version: "local-1",
    maxAutoExecute: "ask_risky",
    label: "本地安全策略",
    forceApprovalClasses: ["workspace_write", "network", "destructive"],
    networkDefaultDeny: true,
  },
  connectors: [],
  mcpServers: [],
  workspaces: [],
  workspace: null,
  workspaceSessions: {},
  collapsedWorkspaces: {},
  groupMode: "time",
  sessions: [],
  session: null,
  runs: [],
  allRuns: [],
  run: null,
  events: [],
  hasEarlierEvents: false,
  historyWindowExpanded: false,
  loadingEarlierEvents: false,
  checkpoints: [],
  checkpointPreview: null,
  tree: [],
  skills: [],
  contextItems: [],
  selectedContextIds: [],
  selectedSkillIds: [],
  selectedMcpIds: [],
  policyRules: [],
  updateStatus: null,
  schedules: [],
  worktrees: { available: false, items: [] },
  context: null,
  usage: null,
  usageSeries: null,
  usageRange: "7d",
  queue: [],
  queueOpen: false,
  sendQueue: [],
  sessionSnapshots: {},
  runLaunching: false,
  activityLayout: "list",
  approvalTab: "pending",
  selectedApprovalId: null,
  approvalScope: "approve_once",
  tabs: BASE_TABS,
  activeTab: "chat",
  centerView: "chat",
  appSurface: "workbench",
  designRoute: "canvas",
  activeDesignArtifactId: null,
  designDraft: EMPTY_DESIGN_DRAFT,
  leftOpen: INITIAL_LAYOUT.leftOpen,
  leftWidth: INITIAL_LAYOUT.leftWidth,
  bottomOpen: INITIAL_LAYOUT.bottomOpen,
  bottomHeight: INITIAL_LAYOUT.bottomHeight,
  filesOpen: INITIAL_LAYOUT.filesOpen,
  filesWidth: INITIAL_LAYOUT.filesWidth,
  designSessionWidth: INITIAL_LAYOUT.designSessionWidth,
  designInspectorWidth: INITIAL_LAYOUT.designInspectorWidth,
  renamingSessionId: null,
  toasts: [],
  paletteOpen: false,
  paletteQuery: "",
  providerId: "codex",
  model: "",
  autoExecute: "ask_risky",
  kind: "mixed",
  openFile: null,
  fileContent: "",
  fileLanguage: null,
  filePreview: null,
  dirty: false,
  draft: "",
  mentions: [],
  approvals: [],
  artifacts: [],
  answeredDecisions: {},
  statusLine: "正在启动 HerDock",
  error: null,

  async init() {
    unsubscribeHostEvents ??= subscribeHostEvents((event) => {
      ingestRunEvent(get, set, event);
    });
    try {
      const [
        platform,
        providers,
        providerProfiles,
        settings,
        mcpServers,
        workspaces,
        allRuns,
        approvals,
        policyRules,
        updateStatus,
      ] = await Promise.all([
        hostApi.platform(),
        hostApi.providers(),
        hostApi.providerProfiles(),
        hostApi.settings(),
        hostApi.mcpServers(),
        hostApi.listWorkspaces(),
        hostApi.recentRuns(),
        hostApi.approvals(),
        hostApi.policyRules(),
        hostApi.updateStatus(),
      ]);
      const providerId =
        settings.defaultProvider &&
        providers.some((provider) => provider.id === settings.defaultProvider && provider.available)
          ? settings.defaultProvider
          : providers.find((provider) => provider.available)?.id || providers[0]?.id || "codex";
      const workspaceSessions: Record<string, Session[]> = {};
      await Promise.all(
        workspaces.map(async (workspace) => {
          workspaceSessions[workspace.id] = await hostApi.listSessions(workspace.id);
        }),
      );
      set({
        hostOnline: true,
        platform,
        providers,
        providerProfiles,
        settings: { ...DEFAULT_SETTINGS, ...settings },
        mcpServers,
        connectors: connectorsFor(mcpServers),
        workspaces,
        workspaceSessions,
        allRuns,
        approvals,
        providerId,
        model:
          providerProfiles.find((profile) => profile.id === providerId)?.model ||
          settings.defaultModel,
        policyRules,
        updateStatus,
        autoExecute: settings.autoExecute,
        statusLine: `本地核心就绪 · ${providers.filter((provider) => provider.available).length} 个 Provider`,
        error: null,
        toasts: approvals.slice(0, MAX_TOASTS).map((item) => ({
          id: `toast_${item.approvalId}`,
          kind: "approval" as const,
          title: item.title || "待审批",
          detail: item.detail,
          approvalId: item.approvalId,
        })),
      });
      if (workspaces[0]) await get().openWorkspacePath(workspaces[0].rootPath);
      else await get().refreshPanels();
    } catch (error) {
      set({ hostOnline: false, error: String(error), statusLine: "Tauri 核心初始化失败" });
    }
  },

  async openWorkspacePath(path) {
    try {
      for (const browserId of get()
        .tabs.map((tab) => tab.browserId)
        .filter(Boolean) as string[]) {
        void hostApi.closeBrowser(browserId);
      }
      const sessionSnapshots = stashCurrentView(get());
      const workspace = await hostApi.openWorkspace(path);
      const [tree, sessions] = await Promise.all([
        hostApi.tree(workspace.id),
        hostApi.listSessions(workspace.id),
      ]);
      set((state) => ({
        workspace,
        sessionSnapshots,
        sendQueue: [],
        runLaunching: false,
        autoExecute: workspace.autoExecute || state.settings.autoExecute,
        workspaces: [workspace, ...state.workspaces.filter((item) => item.id !== workspace.id)],
        workspaceSessions: { ...state.workspaceSessions, [workspace.id]: sessions },
        sessions,
        session: null,
        run: null,
        runs: [],
        events: [],
        hasEarlierEvents: false,
        historyWindowExpanded: false,
        loadingEarlierEvents: false,
        checkpoints: [],
        checkpointPreview: null,
        selectedContextIds: [],
        selectedSkillIds: [],
        selectedMcpIds: [],
        tree,
        tabs: BASE_TABS,
        activeTab: "chat",
        centerView: "chat",
        activeDesignArtifactId: null,
        designDraft:
          state.designDraft.workspaceId === workspace.id
            ? state.designDraft
            : { ...EMPTY_DESIGN_DRAFT, workspaceId: workspace.id },
        statusLine: `${workspace.name} · ${workspace.branch || "未启用 Git"}`,
        error: null,
      }));
      if (sessions[0]) {
        const active = sessions.find((item) => !item.archivedAt) || sessions[0];
        await get().selectSession(active.id);
      }
      await get().refreshPanels();
    } catch (error) {
      const message = String(error);
      set({
        error: /workspace does not exist/i.test(message)
          ? "这个最近工作区已不存在，请点击“打开文件夹”重新选择。"
          : message,
      });
    }
  },

  async refreshTree() {
    const workspace = get().workspace;
    if (!workspace) return;
    try {
      set({ tree: await hostApi.tree(workspace.id) });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async refreshPanels() {
    const { workspace, run } = get();
    try {
      const [
        providers,
        providerProfiles,
        mcpServers,
        skills,
        schedules,
        context,
        contextItems,
        usage,
        queue,
        allRuns,
        approvals,
        artifacts,
        policyRules,
        updateStatus,
      ] = await Promise.all([
        hostApi.providers(),
        hostApi.providerProfiles(),
        hostApi.mcpServers(),
        hostApi.skills(workspace?.id),
        hostApi.schedules(workspace?.id),
        workspace ? hostApi.workspaceContext(workspace.id) : Promise.resolve(null),
        workspace ? hostApi.contextItems(workspace.id) : Promise.resolve([]),
        hostApi.usage(run?.id),
        hostApi.queue(),
        hostApi.recentRuns(),
        hostApi.approvals(),
        workspace ? hostApi.listArtifacts(workspace.id) : Promise.resolve([]),
        hostApi.policyRules(),
        hostApi.updateStatus(),
      ]);
      set({
        providers,
        providerProfiles,
        mcpServers,
        connectors: connectorsFor(mcpServers),
        skills,
        schedules,
        context,
        contextItems,
        usage,
        queue,
        allRuns,
        approvals,
        artifacts,
        policyRules,
        updateStatus,
      });
      void get().refreshWorktrees();
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async refreshSkills() {
    try {
      set({ skills: await hostApi.skills(get().workspace?.id) });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async selectSession(id) {
    const session =
      Object.values(get().workspaceSessions)
        .flat()
        .find((item) => item.id === id) || get().sessions.find((item) => item.id === id);
    if (!session) return;
    const gen = ++selectSessionGen;
    const sessionSnapshots = stashCurrentView(get());
    set({ sessionSnapshots });
    try {
      const runs = await hostApi.listRuns(id);
      if (gen !== selectSessionGen) return;
      const run = runs[0] || null;
      const snap = get().sessionSnapshots[id];
      const keepLive = Boolean(
        snap && run && snap.run?.id === run.id && runIsBusy(run, snap.runLaunching),
      );
      const [eventPage, checkpoints, inputs] =
        run && !keepLive
          ? await Promise.all([
              hostApi.eventPage(run.id),
              hostApi.checkpoints(run.id),
              hostApi.runInputs(run.id),
            ])
          : keepLive
            ? [{ events: snap!.events, hasMore: snap!.hasEarlierEvents }, snap!.checkpoints, null]
            : [{ events: [], hasMore: false }, [], null];
      if (gen !== selectSessionGen) return;
      const workspace =
        get().workspaces.find((item) => item.id === session.workspaceId) || get().workspace;
      const workspaceChanged = workspace && workspace.id !== get().workspace?.id;
      set({
        session,
        workspace: workspace || null,
        sessions: get().workspaceSessions[session.workspaceId] || [],
        runs,
        run: keepLive ? snap!.run : run,
        events: keepLive ? snap!.events : eventPage.events,
        hasEarlierEvents: keepLive ? snap!.hasEarlierEvents : eventPage.hasMore,
        historyWindowExpanded: false,
        loadingEarlierEvents: false,
        checkpoints: keepLive ? snap!.checkpoints : checkpoints,
        activeTab: "chat",
        centerView: "chat",
        providerId: session.providerId,
        model: inputs?.model || (keepLive ? snap!.run?.model : run?.model) || "",
        selectedContextIds: inputs?.contextItemIds || [],
        selectedSkillIds: inputs?.skillIds || [],
        selectedMcpIds: inputs?.mcpServerIds || [],
        sendQueue: snap?.sendQueue ?? [],
        runLaunching: keepLive ? snap!.runLaunching : false,
        sessionSnapshots,
        autoExecute: workspaceChanged
          ? workspace?.autoExecute || get().settings.autoExecute
          : get().autoExecute,
        appSurface: "workbench",
      });
      await get().refreshPanels();
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async selectRun(id) {
    const target =
      get().allRuns.find((item) => item.id === id) || get().runs.find((item) => item.id === id);
    if (!target) return;
    const workspace = get().workspaces.find((item) => item.id === target.workspaceId);
    if (workspace && get().workspace?.id !== workspace.id)
      await get().openWorkspacePath(workspace.rootPath);
    try {
      const session =
        Object.values(get().workspaceSessions)
          .flat()
          .find((item) => item.id === target.sessionId) ||
        get().sessions.find((item) => item.id === target.sessionId);
      const runs = await hostApi.listRuns(target.sessionId);
      const run = runs.find((item) => item.id === id) || target;
      const [eventPage, checkpoints, inputs] = await Promise.all([
        hostApi.eventPage(run.id),
        hostApi.checkpoints(run.id),
        hostApi.runInputs(run.id),
      ]);
      set({
        session: session || null,
        runs,
        run,
        events: eventPage.events,
        hasEarlierEvents: eventPage.hasMore,
        historyWindowExpanded: false,
        loadingEarlierEvents: false,
        checkpoints,
        checkpointPreview: null,
        activeTab: "chat",
        centerView: "chat",
        providerId: run.providerId,
        model: inputs.model || run.model || "",
        selectedContextIds: inputs.contextItemIds,
        selectedSkillIds: inputs.skillIds,
        selectedMcpIds: inputs.mcpServerIds,
        appSurface: "workbench",
      });
      await get().refreshPanels();
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async loadEarlierEvents() {
    const { run, events, hasEarlierEvents, loadingEarlierEvents } = get();
    if (!run || !hasEarlierEvents || loadingEarlierEvents) return;
    const beforeSeq = events[0]?.seq;
    if (beforeSeq == null) return;
    set({ loadingEarlierEvents: true });
    try {
      const page = await hostApi.eventPage(run.id, beforeSeq);
      if (get().run?.id !== run.id) return;
      set((state) => ({
        events: mergeRunEvents(page.events, state.events),
        hasEarlierEvents: page.hasMore,
        historyWindowExpanded: true,
        loadingEarlierEvents: false,
      }));
    } catch (error) {
      set({ error: String(error), loadingEarlierEvents: false });
    }
  },

  async newSession(workspaceId) {
    const current = get();
    const workspace =
      current.workspaces.find((item) => item.id === (workspaceId || current.workspace?.id)) ||
      current.workspace ||
      current.workspaces[0];
    if (!workspace) {
      set({ error: "请先打开一个本地工作区。" });
      return;
    }
    try {
      const session = await hostApi.createSession(workspace.id, {
        title: "新会话",
        kind: current.kind,
        providerId: current.providerId,
      });
      const switchWorkspace = current.workspace?.id !== workspace.id;
      const tree = switchWorkspace ? await hostApi.tree(workspace.id) : undefined;
      const sessionSnapshots = stashCurrentView(get());
      set((state) => ({
        workspace,
        tree: tree ?? state.tree,
        session,
        sessions: prependUnique(state.workspaceSessions[workspace.id] || state.sessions, session),
        workspaceSessions: {
          ...state.workspaceSessions,
          [workspace.id]: prependUnique(state.workspaceSessions[workspace.id] || [], session),
        },
        collapsedWorkspaces: { ...state.collapsedWorkspaces, [workspace.id]: false },
        sessionSnapshots,
        renamingSessionId: session.id,
        runs: [],
        run: null,
        events: [],
        hasEarlierEvents: false,
        historyWindowExpanded: false,
        loadingEarlierEvents: false,
        sendQueue: [],
        runLaunching: false,
        checkpoints: [],
        activeTab: "chat",
        centerView: "chat",
        appSurface: "workbench",
        autoExecute: switchWorkspace
          ? workspace.autoExecute || state.settings.autoExecute
          : state.autoExecute,
        error: null,
      }));
      if (switchWorkspace) await get().refreshPanels();
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async forkSession(beforeSeq, sourceId) {
    const id = (sourceId || get().session?.id || "").trim();
    if (!id) {
      set({ error: "请先打开一个会话再分叉。" });
      return;
    }
    try {
      const forked = await hostApi.forkSession(id, beforeSeq);
      set((state) => ({
        sessions: prependUnique(state.sessions, forked),
        workspaceSessions: {
          ...state.workspaceSessions,
          [forked.workspaceId]: prependUnique(
            state.workspaceSessions[forked.workspaceId] || state.sessions,
            forked,
          ),
        },
        statusLine: `已分叉为「${forked.title}」`,
      }));
      await get().selectSession(forked.id);
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async renameSession(id, title) {
    const next = title.trim();
    if (!next) return;
    try {
      const session = await hostApi.renameSession(id, next);
      set((state) => ({
        ...withPatchedSession(state, session),
        renamingSessionId: state.renamingSessionId === id ? null : state.renamingSessionId,
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async deleteSession(id) {
    const current = get();
    const workspaceId =
      current.sessions.find((item) => item.id === id)?.workspaceId ||
      Object.entries(current.workspaceSessions).find(([, list]) =>
        list.some((item) => item.id === id),
      )?.[0];
    const remaining = workspaceId
      ? (current.workspaceSessions[workspaceId] || current.sessions).filter(
          (item) => item.id !== id,
        )
      : [];
    const siblings = remaining.filter((item) => !item.archivedAt);
    try {
      await hostApi.deleteSession(id);
      set((state) => {
        const sessionSnapshots = { ...state.sessionSnapshots };
        delete sessionSnapshots[id];
        return {
          sessions: state.sessions.filter((item) => item.id !== id),
          workspaceSessions: Object.fromEntries(
            Object.entries(state.workspaceSessions).map(([key, list]) => [
              key,
              list.filter((item) => item.id !== id),
            ]),
          ),
          allRuns: state.allRuns.filter((item) => item.sessionId !== id),
          sessionSnapshots,
          renamingSessionId: state.renamingSessionId === id ? null : state.renamingSessionId,
        };
      });
      if (get().session?.id === id) {
        const next = siblings[0] || remaining[0];
        if (next) await get().selectSession(next.id);
        else {
          set({
            session: null,
            run: null,
            runs: [],
            events: [],
            checkpoints: [],
            activeTab: "chat",
            centerView: "chat",
          });
        }
      }
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async archiveSession(id) {
    try {
      const session = await hostApi.archiveSession(id);
      const current = get();
      const remaining = (current.workspaceSessions[session.workspaceId] || current.sessions).filter(
        (item) => item.id !== id && !item.archivedAt,
      );
      set((state) => withPatchedSession(state, session));
      if (get().session?.id === id && remaining[0]) await get().selectSession(remaining[0].id);
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async unarchiveSession(id) {
    try {
      const session = await hostApi.unarchiveSession(id);
      set((state) => ({
        ...withPatchedSession(state, session),
        collapsedWorkspaces: {
          ...state.collapsedWorkspaces,
          [session.workspaceId]: false,
        },
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  beginRenameSession(renamingSessionId) {
    set({ renamingSessionId });
  },

  setCenterView(centerView) {
    // Console destinations replace the whole centre pane, so they must not steal
    // the active work tab — the session keeps it and is one click away again.
    if (isConsoleView(centerView)) {
      set({ centerView, appSurface: "workbench", paletteOpen: false });
      if (centerView === "usage") void get().loadUsageSeries();
      return;
    }
    const tab = get().tabs.find((item) => item.view === centerView);
    set({
      centerView,
      activeTab: tab?.key || centerView,
      appSurface: "workbench",
      paletteOpen: false,
    });
  },
  setAppSurface(appSurface) {
    const current = get();
    const designArtifact =
      appSurface === "design" && !current.activeDesignArtifactId
        ? current.artifacts.find(
            (item) =>
              item.runId === current.run?.id &&
              item.path.startsWith("out/design/") &&
              ["html", "deck-html"].includes(item.renderer || ""),
          ) ||
          current.artifacts.find(
            (item) =>
              item.path.startsWith("out/design/") &&
              ["html", "deck-html"].includes(item.renderer || ""),
          )
        : undefined;
    set({
      appSurface,
      paletteOpen: false,
      activeDesignArtifactId: designArtifact?.id || current.activeDesignArtifactId,
    });
    if (designArtifact) void get().openDesignArtifact(designArtifact.id);
  },
  setDesignRoute(designRoute) {
    set({ designRoute });
  },
  setActiveDesignArtifact(activeDesignArtifactId) {
    set({ activeDesignArtifactId, designRoute: "canvas" });
  },
  setDesignDraft(patch) {
    set((state) => ({ designDraft: { ...state.designDraft, ...patch } }));
  },
  async openDesignArtifact(artifactId) {
    const artifact = get().artifacts.find((item) => item.id === artifactId);
    if (!artifact) {
      set({ activeDesignArtifactId: null, error: "这个设计产物已不存在，请刷新项目列表。" });
      return;
    }
    set({ activeDesignArtifactId: artifact.id, designRoute: "canvas", appSurface: "design" });
    if (!artifact.runId) return;
    try {
      const run =
        get().allRuns.find((item) => item.id === artifact.runId) ||
        get().runs.find((item) => item.id === artifact.runId);
      const [eventPage, checkpoints] = await Promise.all([
        hostApi.eventPage(artifact.runId),
        hostApi.checkpoints(artifact.runId),
      ]);
      if (get().activeDesignArtifactId !== artifactId) return;
      set({
        run: run || null,
        events: eventPage.events,
        hasEarlierEvents: eventPage.hasMore,
        historyWindowExpanded: false,
        checkpoints,
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async openPath(path) {
    const workspace = get().workspace;
    if (!workspace) return;
    try {
      if (isPreviewablePath(path)) {
        const preview = await hostApi.previewFile(workspace.id, path);
        if (preview.kind !== "unsupported") {
          set((state) => ({
            openFile: path,
            fileContent: "",
            fileLanguage: null,
            filePreview: preview,
            dirty: false,
            tabs: tabsWithFile(state.tabs, path),
            activeTab: `file:${path}`,
            centerView: "code",
            appSurface: "workbench",
            error: preview.tooLarge ? `${path} 超过 32MB，未载入预览。` : null,
          }));
          return;
        }
      }
      const file = await hostApi.readFile(workspace.id, path);
      if (file.binary) {
        set({ error: `${path} 是二进制文件，当前只支持只读元数据。` });
        return;
      }
      set((state) => ({
        openFile: path,
        fileContent: file.content,
        fileLanguage: file.language || null,
        filePreview: null,
        dirty: false,
        tabs: tabsWithFile(state.tabs, path),
        activeTab: `file:${path}`,
        centerView: "code",
        appSurface: "workbench",
        error: null,
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  createTab() {
    const key = tabId("new");
    const tab: WorkTab = { key, view: "new-tab", label: "新标签", icon: "+", closable: true };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTab: key,
      centerView: "new-tab",
      appSurface: "workbench",
    }));
  },

  async configureTab(key, feature) {
    const current = get().tabs.find((tab) => tab.key === key);
    if (!current) return;
    if (feature === "agent") {
      get().closeTab(key);
      await get().newSession();
      return;
    }
    if (feature === "diff") {
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.key === key ? { ...tab, view: "diff", label: "差异", icon: "", closable: true } : tab,
        ),
        centerView: "diff",
      }));
      return;
    }
    const id = tabId(feature);
    const replacement: WorkTab =
      feature === "browser"
        ? {
            key: `browser:${id}`,
            view: "browser",
            label: "浏览器",
            icon: "web",
            browserId: id,
            url: "https://www.bing.com/",
            closable: true,
          }
        : feature === "terminal"
          ? { key: `terminal:${id}`, view: "terminal", label: "终端", icon: ">", closable: true }
          : { key: `editor:${id}`, view: "code", label: "编辑器", icon: "code", closable: true };
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.key === key ? replacement : tab)),
      activeTab: replacement.key,
      centerView: replacement.view,
    }));
  },

  updateBrowserTab(browserId, patch) {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.browserId === browserId
          ? { ...tab, ...patch, label: patch.label?.trim() || tab.label }
          : tab,
      ),
    }));
  },

  closeTab(key) {
    const currentTabs = get().tabs;
    const index = currentTabs.findIndex((item) => item.key === key);
    const tab = currentTabs[index];
    if (!tab?.closable) return;
    if (tab.browserId) void hostApi.closeBrowser(tab.browserId);
    const tabs = currentTabs.filter((item) => item.key !== key);
    const fallback =
      currentTabs[index - 1] || currentTabs[index + 1] || tabs.find((item) => item.key === "chat");
    const wasActive = get().activeTab === key;
    set({
      tabs,
      ...(wasActive
        ? { activeTab: fallback?.key || "chat", centerView: fallback?.view || "chat" }
        : {}),
      ...(tab.path === get().openFile
        ? { openFile: null, fileContent: "", filePreview: null, dirty: false }
        : {}),
    });
  },

  setActiveTab(key) {
    const tab = get().tabs.find((item) => item.key === key);
    if (!tab) return;
    if (tab.path && tab.path !== get().openFile) {
      void get().openPath(tab.path);
      return;
    }
    set({ activeTab: key, centerView: tab.view, appSurface: "workbench" });
  },
  setFileContent(fileContent) {
    set({ fileContent, dirty: true });
  },

  async saveFile() {
    const { workspace, openFile, fileContent } = get();
    if (!workspace || !openFile) return;
    try {
      await hostApi.writeFile(workspace.id, openFile, fileContent);
      set({ dirty: false, statusLine: `已保存 ${openFile}`, error: null });
      await get().refreshTree();
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async sendPrompt() {
    let {
      workspace,
      session,
      draft,
      providerId,
      model,
      autoExecute,
      mentions,
      selectedContextIds,
      selectedSkillIds,
      selectedMcpIds,
      run,
      runLaunching,
    } = get();
    if (!workspace || !draft.trim()) return;
    const queued: SendQueuedPrompt = {
      id: tabId("sendq"),
      text: draft.trim(),
      mentions: [...get().mentions],
      contextItemIds: [...get().selectedContextIds],
    };
    if (runIsBusy(run, runLaunching)) {
      set((state) => ({ sendQueue: [...state.sendQueue, queued], draft: "" }));
      return;
    }
    if (liveRunCount(get().allRuns, launchingSlots(get())) >= MAX_LIVE_RUNS) {
      set((state) => ({
        sendQueue: [...state.sendQueue, queued],
        draft: "",
        statusLine: `等待进程空位（最多同时 ${MAX_LIVE_RUNS} 个任务）`,
      }));
      return;
    }
    if (!session) {
      await get().newSession();
      session = get().session;
    }
    if (!session) return;
    const prompt = draft.trim();
    const targetSessionId = session.id;
    set({
      draft: "",
      events: [],
      hasEarlierEvents: false,
      historyWindowExpanded: false,
      loadingEarlierEvents: false,
      run: null,
      runLaunching: true,
      statusLine: "正在启动 Agent",
      error: null,
    });
    try {
      const started = await hostApi.startRun(
        {
          sessionId: targetSessionId,
          workspaceId: workspace.id,
          providerId,
          model: model || undefined,
          prompt,
          autoExecute,
          contextPaths: mentions,
          contextItemIds: selectedContextIds,
          skillIds: selectedSkillIds,
          mcpServerIds: selectedMcpIds,
        },
        (event) => ingestRunEvent(get, set, event),
      );
      set((state) => {
        const allRuns = prependUnique(state.allRuns, started);
        if (state.session?.id !== targetSessionId) {
          const snap = state.sessionSnapshots[targetSessionId];
          return {
            allRuns,
            sessionSnapshots: {
              ...state.sessionSnapshots,
              [targetSessionId]: {
                run: started,
                events: snap?.events ?? [],
                hasEarlierEvents: snap?.hasEarlierEvents ?? false,
                checkpoints: snap?.checkpoints ?? [],
                sendQueue: snap?.sendQueue ?? [],
                runLaunching: false,
              },
            },
          };
        }
        return {
          runLaunching: false,
          run: started,
          runs: prependUnique(state.runs, started),
          allRuns,
        };
      });
      if (session.title === "新会话") {
        void get().renameSession(session.id, titleFromPrompt(prompt));
      }
      if (get().session?.id === targetSessionId) await get().refreshPanels();
      void get().drainSendQueue(targetSessionId);
    } catch (error) {
      set((state) => {
        if (state.session?.id === targetSessionId) {
          return { error: String(error), draft: prompt, runLaunching: false };
        }
        const snap = state.sessionSnapshots[targetSessionId];
        return {
          error: String(error),
          sessionSnapshots: snap
            ? {
                ...state.sessionSnapshots,
                [targetSessionId]: { ...snap, runLaunching: false },
              }
            : state.sessionSnapshots,
        };
      });
    }
  },
  removeSendQueueItem(id) {
    set((state) => ({ sendQueue: state.sendQueue.filter((item) => item.id !== id) }));
  },
  async drainSendQueue(sessionId) {
    const currentId = get().session?.id;
    const tryCurrent = async () => {
      const latest = get();
      if (!latest.session || latest.session.id !== currentId) return false;
      if (!latest.sendQueue.length || runIsBusy(latest.run, latest.runLaunching)) return false;
      if (liveRunCount(latest.allRuns, launchingSlots(latest)) >= MAX_LIVE_RUNS) return false;
      const next = latest.sendQueue[0];
      if (!next) return false;
      set({
        sendQueue: latest.sendQueue.slice(1),
        draft: next.text,
        mentions: next.mentions,
        selectedContextIds: next.contextItemIds,
      });
      await get().sendPrompt();
      return true;
    };
    if ((!sessionId || sessionId === currentId) && (await tryCurrent())) return;
    if (liveRunCount(get().allRuns, launchingSlots(get())) >= MAX_LIVE_RUNS) return;
    const snapshots = get().sessionSnapshots;
    const order = [
      ...(sessionId && sessionId !== currentId ? [sessionId] : []),
      ...Object.keys(snapshots).filter((id) => id !== currentId && id !== sessionId),
    ];
    for (const sid of order) {
      const snap = get().sessionSnapshots[sid];
      if (!snap?.sendQueue.length || runIsBusy(snap.run, snap.runLaunching)) continue;
      if (liveRunCount(get().allRuns, launchingSlots(get())) >= MAX_LIVE_RUNS) return;
      const next = snap.sendQueue[0];
      const session =
        Object.values(get().workspaceSessions)
          .flat()
          .find((item) => item.id === sid) || get().sessions.find((item) => item.id === sid);
      const workspace = session
        ? get().workspaces.find((item) => item.id === session.workspaceId)
        : undefined;
      if (!session || !workspace || !next) continue;
      set((state) => ({
        sessionSnapshots: {
          ...state.sessionSnapshots,
          [sid]: {
            ...snap,
            sendQueue: snap.sendQueue.slice(1),
            runLaunching: true,
          },
        },
      }));
      try {
        const started = await hostApi.startRun(
          {
            sessionId: sid,
            workspaceId: workspace.id,
            providerId: session.providerId,
            prompt: next.text,
            autoExecute: workspace.autoExecute || get().settings.autoExecute,
            contextPaths: next.mentions,
            contextItemIds: next.contextItemIds,
            skillIds: [],
            mcpServerIds: [],
          },
          (event) => ingestRunEvent(get, set, event),
        );
        set((state) => ({
          allRuns: prependUnique(state.allRuns, started),
          sessionSnapshots: {
            ...state.sessionSnapshots,
            [sid]: {
              ...(state.sessionSnapshots[sid] || snap),
              run: started,
              runLaunching: false,
            },
          },
        }));
      } catch (error) {
        set((state) => ({
          error: String(error),
          sessionSnapshots: {
            ...state.sessionSnapshots,
            [sid]: {
              ...(state.sessionSnapshots[sid] || snap),
              runLaunching: false,
              sendQueue: [next, ...(state.sessionSnapshots[sid]?.sendQueue || [])],
            },
          },
        }));
      }
      return;
    }
  },

  async startDesignRun(input) {
    const {
      workspace,
      providerId,
      model,
      autoExecute,
      mentions,
      selectedContextIds,
      selectedSkillIds,
      selectedMcpIds,
    } = get();
    if (!workspace || !input.brief.trim() || !input.title.trim()) return;
    const designId = tabId("design");
    set({ statusLine: "正在准备设计工作区", error: null });
    try {
      const designSystem = await hostApi.readDesignSystem(input.designSystemId, workspace.id);
      const session = await hostApi.createSession(workspace.id, {
        title: `设计 · ${input.title.trim()}`,
        kind: "mixed",
        providerId,
      });
      const skillIds = input.skillId
        ? Array.from(new Set([...selectedSkillIds, input.skillId]))
        : selectedSkillIds;
      const prompt = designPrompt(
        input,
        designId,
        designSystem.designMarkdown,
        designSystem.tokensCss,
      );
      set((state) => ({
        session,
        sessions: [session, ...state.sessions.filter((item) => item.id !== session.id)],
        workspaceSessions: {
          ...state.workspaceSessions,
          [workspace.id]: [
            session,
            ...(state.workspaceSessions[workspace.id] || []).filter(
              (item) => item.id !== session.id,
            ),
          ],
        },
        runs: [],
        run: null,
        events: [],
        checkpoints: [],
        selectedSkillIds: skillIds,
        statusLine: "正在启动设计 Agent",
      }));
      const onEvent = (event: AgentEvent) => {
        ingestRunEvent(get, set, event);
        if (["completed", "failed", "cancelled"].includes(event.type)) {
          void get()
            .refreshPanels()
            .then(() => {
              if (event.type !== "completed") return;
              const artifact = get().artifacts.find(
                (item) =>
                  item.runId === event.runId &&
                  item.path.startsWith("out/design/") &&
                  ["html", "deck-html"].includes(item.renderer || ""),
              );
              if (artifact) void get().openDesignArtifact(artifact.id);
            });
        }
      };
      const run = await hostApi.startRun(
        {
          sessionId: session.id,
          workspaceId: workspace.id,
          providerId,
          model: model || undefined,
          prompt,
          autoExecute,
          contextPaths: mentions,
          contextItemIds: selectedContextIds,
          skillIds,
          mcpServerIds: selectedMcpIds,
        },
        onEvent,
      );
      set((state) => ({
        run,
        runs: prependUnique(state.runs, run),
        allRuns: prependUnique(state.allRuns, run),
        designRoute: "canvas",
        designDraft: { ...EMPTY_DESIGN_DRAFT, workspaceId: workspace.id },
      }));
    } catch (error) {
      set({ error: String(error), statusLine: "设计任务启动失败" });
    }
  },

  async continueRun() {
    const run = get().run;
    if (!run) return;
    try {
      const next = await hostApi.continueRun(run.id, get().draft.trim() || undefined, (event) =>
        ingestRunEvent(get, set, event),
      );
      set((state) => ({
        run: next,
        runs: prependUnique(state.runs, next),
        events: [],
        hasEarlierEvents: false,
        historyWindowExpanded: false,
        loadingEarlierEvents: false,
        draft: "",
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async continueDesignRun(runId, prompt) {
    const text = prompt.trim();
    if (!runId || !text) return;
    set({ statusLine: "正在继续设计迭代", error: null });
    try {
      const next = await hostApi.continueRun(runId, text, (event) => {
        ingestRunEvent(get, set, event);
        if (["completed", "failed", "cancelled"].includes(event.type)) {
          void get().refreshPanels();
        }
      });
      set((state) => ({
        run: next,
        runs: prependUnique(state.runs, next),
        allRuns: prependUnique(state.allRuns, next),
        events: [],
        hasEarlierEvents: false,
        historyWindowExpanded: false,
        loadingEarlierEvents: false,
        designRoute: "canvas",
        appSurface: "design",
        statusLine: `${next.id} · 设计迭代已启动`,
      }));
    } catch (error) {
      set({ error: String(error), statusLine: "设计迭代启动失败" });
    }
  },

  async retryRun(runId) {
    const id = runId || get().run?.id;
    if (!id) return;
    try {
      const next = await hostApi.retryRun(id, (event) => ingestRunEvent(get, set, event));
      set((state) => ({
        run: next,
        runs: prependUnique(state.runs, next),
        allRuns: prependUnique(state.allRuns, next),
        events: [],
        hasEarlierEvents: false,
        historyWindowExpanded: false,
        loadingEarlierEvents: false,
        checkpoints: [],
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async cancelRun(runId) {
    const id = runId || get().run?.id;
    if (!id) return;
    try {
      await hostApi.cancelRun(id);
      const wasCurrent = get().run?.id === id;
      set((state) => {
        const markRun = (run: Run): Run => (run.id === id ? { ...run, status: "cancelled" } : run);
        return {
          run: state.run && state.run.id === id ? { ...state.run, status: "cancelled" } : state.run,
          runs: state.runs.map(markRun),
          allRuns: state.allRuns.map(markRun),
          sessionSnapshots: Object.fromEntries(
            Object.entries(state.sessionSnapshots).map(([sid, snap]) => [
              sid,
              snap.run && snap.run.id === id ? { ...snap, run: markRun(snap.run) } : snap,
            ]),
          ),
          statusLine: wasCurrent ? `${id} · 已取消` : state.statusLine,
        };
      });
      if (wasCurrent) void get().drainSendQueue();
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async resolveApproval(id, decision) {
    try {
      await hostApi.resolveApproval(id, decision);
      set((state) => ({
        approvals: state.approvals.filter((item) => item.approvalId !== id),
        toasts: state.toasts.filter((item) => item.approvalId !== id),
        selectedApprovalId: state.selectedApprovalId === id ? null : state.selectedApprovalId,
        approvalScope: state.selectedApprovalId === id ? "approve_once" : state.approvalScope,
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async restoreCheckpoint(id) {
    try {
      const paths = await hostApi.restoreCheckpoint(id);
      set({ statusLine: `已恢复 ${paths.length} 个文件` });
      await get().refreshTree();
    } catch (error) {
      set({ error: String(error) });
    }
  },
  async previewCheckpoint(id) {
    try {
      set({ checkpointPreview: await hostApi.previewCheckpoint(id) });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async answerDecision(eventId, optionId, label) {
    set((state) => ({
      answeredDecisions: { ...state.answeredDecisions, [eventId]: optionId },
      draft: label,
    }));
  },

  async toggleSchedule(id) {
    const schedule = get().schedules.find((item) => item.id === id);
    if (!schedule) return;
    try {
      const updated = await hostApi.toggleSchedule(id, !schedule.enabled);
      set((state) => ({
        schedules: state.schedules.map((item) => (item.id === id ? updated : item)),
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async createSchedule(input) {
    const workspace = get().workspace;
    if (!workspace) {
      set({ error: "请先打开一个本地工作区。" });
      return;
    }
    try {
      const schedule = await hostApi.saveSchedule({
        workspaceId: workspace.id,
        name: input.name.trim(),
        cron: input.cron.trim(),
        prompt: input.prompt.trim(),
        providerId: get().providerId,
        enabled: true,
      });
      set((state) => ({
        schedules: [schedule, ...state.schedules.filter((item) => item.id !== schedule.id)],
        statusLine: `已创建定时任务「${schedule.name}」`,
        draft: "",
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async refreshWorktrees() {
    const workspace = get().workspace;
    if (!workspace) {
      set({ worktrees: { available: false, items: [] } });
      return;
    }
    try {
      set({ worktrees: await hostApi.listWorktrees(workspace.id) });
    } catch {
      set({ worktrees: { available: false, items: [] } });
    }
  },

  async switchWorktree(path) {
    await get().openWorkspacePath(path);
  },

  async createWorktree(name, startPoint) {
    const workspace = get().workspace;
    if (!workspace) return;
    try {
      const created = await hostApi.addWorktree(workspace.id, name, startPoint);
      await get().openWorkspacePath(created.path);
    } catch (error) {
      set({ error: String(error) });
    }
  },

  async removeWorktree(path, force) {
    const workspace = get().workspace;
    if (!workspace) return;
    const removingCurrent = get().worktrees.items.find(
      (item) => item.path === path && item.isCurrent,
    );
    const main = get().worktrees.items.find((item) => item.isMain);
    try {
      await hostApi.removeWorktree(workspace.id, path, force);
      if (removingCurrent && main) await get().openWorkspacePath(main.path);
      else await get().refreshWorktrees();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  async pruneWorktrees() {
    const workspace = get().workspace;
    if (!workspace) return;
    try {
      const output = await hostApi.pruneWorktrees(workspace.id);
      await get().refreshWorktrees();
      set({ statusLine: output.trim() || "已清理失效 worktree" });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  setDraft(draft) {
    set({ draft });
  },
  addMention(path) {
    set((state) => ({
      mentions: state.mentions.includes(path) ? state.mentions : [...state.mentions, path],
    }));
  },
  removeMention(path) {
    set((state) => ({ mentions: state.mentions.filter((item) => item !== path) }));
  },
  setProviderId(providerId) {
    set({
      providerId,
      model: get().providerProfiles.find((profile) => profile.id === providerId)?.model || "",
    });
  },
  setModel(model) {
    set({ model });
  },
  async importContextPaths(paths) {
    const workspace = get().workspace;
    if (!workspace || !paths.length) return;
    try {
      get().adoptContextItems(await hostApi.importContext(workspace.id, paths));
    } catch (error) {
      set({ error: String(error) });
    }
  },
  async importContextBytes(fileName, mimeType, bytesBase64) {
    const workspace = get().workspace;
    if (!workspace) return;
    try {
      get().adoptContextItems(
        await hostApi.importContextBytes(workspace.id, fileName, mimeType, bytesBase64),
      );
    } catch (error) {
      set({ error: String(error) });
    }
  },
  adoptContextItems(imported) {
    const importedIds = new Set(imported.map((item) => item.id));
    set((state) => ({
      contextItems: [
        ...imported,
        ...state.contextItems.filter((item) => !importedIds.has(item.id)),
      ],
      selectedContextIds: Array.from(new Set([...state.selectedContextIds, ...importedIds])),
    }));
  },
  async removeContextItem(id) {
    try {
      await hostApi.removeContext(id);
      set((state) => ({
        contextItems: state.contextItems.filter((item) => item.id !== id),
        selectedContextIds: state.selectedContextIds.filter((item) => item !== id),
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },
  toggleContextItem(id) {
    set((state) => ({
      selectedContextIds: state.selectedContextIds.includes(id)
        ? state.selectedContextIds.filter((item) => item !== id)
        : [...state.selectedContextIds, id],
    }));
  },
  toggleSkill(id) {
    set((state) => ({
      selectedSkillIds: state.selectedSkillIds.includes(id)
        ? state.selectedSkillIds.filter((item) => item !== id)
        : [...state.selectedSkillIds, id],
    }));
  },
  toggleMcpSelection(id) {
    set((state) => ({
      selectedMcpIds: state.selectedMcpIds.includes(id)
        ? state.selectedMcpIds.filter((item) => item !== id)
        : [...state.selectedMcpIds, id],
    }));
  },
  async toggleMcpRuntime(id, enabled) {
    try {
      const updated = enabled ? await hostApi.startMcp(id) : await hostApi.stopMcp(id);
      set((state) => ({
        mcpServers: state.mcpServers.map((item) => (item.id === id ? updated : item)),
        connectors: state.connectors.map((item) =>
          item.id === id
            ? {
                ...item,
                status: updated.status || (updated.enabled ? "ready" : "stopped"),
                scopes: updated.tools,
              }
            : item,
        ),
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },
  async deletePolicyRule(id) {
    try {
      await hostApi.deletePolicyRule(id);
      set((state) => ({ policyRules: state.policyRules.filter((item) => item.id !== id) }));
    } catch (error) {
      set({ error: String(error) });
    }
  },
  async checkUpdate() {
    try {
      set({ updateStatus: await hostApi.checkUpdate() });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  async installUpdate() {
    try {
      set({ updateStatus: await hostApi.installUpdate() });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  setKind(kind) {
    set({ kind });
  },
  setTheme(mode) {
    const resolved = resolveThemeMode(mode);
    applyDocumentTheme(resolved);
    set({ theme: mode, resolvedTheme: resolved });
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* private mode — theme still applies for this session */
    }
  },
  setAutoExecute(autoExecute) {
    set({ autoExecute });
    const workspace = get().workspace;
    if (!workspace) return;
    void hostApi
      .setWorkspaceAutoExecute(workspace.id, autoExecute)
      .then((saved) => {
        set((state) => ({
          workspace: state.workspace?.id === saved.id ? saved : state.workspace,
          workspaces: state.workspaces.map((item) => (item.id === saved.id ? saved : item)),
        }));
      })
      .catch((error) => set({ error: String(error) }));
  },
  toggleLeft() {
    set((state) => ({ leftOpen: !state.leftOpen }));
    saveLayoutPrefs(layoutSnapshot(get()));
  },
  setLeftWidth(width) {
    const state = get();
    const next = clampLeftWidth(width, window.innerWidth, 0);
    if (next === state.leftWidth) return;
    set({ leftWidth: next });
    saveLayoutPrefs(layoutSnapshot(get()));
  },
  resetLeftWidth() {
    get().setLeftWidth(LEFT_DEFAULT);
  },
  toggleBottom() {
    set((state) => ({ bottomOpen: !state.bottomOpen }));
    saveLayoutPrefs(layoutSnapshot(get()));
  },
  setBottomHeight(height) {
    const next = clampBottomHeight(height, window.innerHeight);
    if (next === get().bottomHeight) return;
    set({ bottomHeight: next });
    saveLayoutPrefs(layoutSnapshot(get()));
  },
  resetBottomHeight() {
    get().setBottomHeight(BOTTOM_DEFAULT);
  },
  toggleFiles() {
    set((state) => ({ filesOpen: !state.filesOpen }));
    saveLayoutPrefs(layoutSnapshot(get()));
  },
  setFilesWidth(width) {
    const next = clampFilesWidth(width);
    if (next === get().filesWidth) return;
    set({ filesWidth: next });
    saveLayoutPrefs(layoutSnapshot(get()));
  },
  resetFilesWidth() {
    get().setFilesWidth(FILES_DEFAULT);
  },
  setDesignSessionWidth(width) {
    const next = clampDesignSessionWidth(width);
    if (next === get().designSessionWidth) return;
    set({ designSessionWidth: next });
    saveLayoutPrefs(layoutSnapshot(get()));
  },
  setDesignInspectorWidth(width) {
    const next = clampDesignInspectorWidth(width);
    if (next === get().designInspectorWidth) return;
    set({ designInspectorWidth: next });
    saveLayoutPrefs(layoutSnapshot(get()));
  },
  resetDesignSessionWidth() {
    get().setDesignSessionWidth(DESIGN_SESSION_DEFAULT);
  },
  resetDesignInspectorWidth() {
    get().setDesignInspectorWidth(DESIGN_INSPECTOR_DEFAULT);
  },
  pushToast(toast) {
    const id = toast.id || `toast_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    set((state) => ({
      toasts: [
        { ...toast, id },
        ...state.toasts.filter((item) => item.id !== id && item.approvalId !== toast.approvalId),
      ].slice(0, MAX_TOASTS),
    }));
  },
  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
  },
  reflowLayout() {
    const state = get();
    const leftWidth = clampLeftWidth(state.leftWidth, window.innerWidth, 0);
    const bottomHeight = clampBottomHeight(state.bottomHeight, window.innerHeight);
    if (leftWidth === state.leftWidth && bottomHeight === state.bottomHeight) return;
    set({ leftWidth, bottomHeight });
    saveLayoutPrefs(layoutSnapshot(get()));
  },
  togglePalette() {
    set((state) => ({ paletteOpen: !state.paletteOpen, paletteQuery: "" }));
  },
  setPaletteQuery(paletteQuery) {
    set({ paletteQuery });
  },
  toggleQueue() {
    set((state) => ({ queueOpen: !state.queueOpen }));
  },
  setActivityLayout(activityLayout) {
    set({ activityLayout });
  },
  setApprovalTab(approvalTab) {
    set({ approvalTab });
  },
  selectApproval(selectedApprovalId) {
    set({ selectedApprovalId, approvalScope: "approve_once" });
  },
  setApprovalScope(approvalScope) {
    set({ approvalScope });
  },
  async setUsageRange(usageRange) {
    set({ usageRange });
    await get().loadUsageSeries();
  },
  async loadUsageSeries() {
    const days = { "7d": 7, "30d": 30, mtd: new Date().getDate() }[get().usageRange];
    try {
      set({ usageSeries: await hostApi.usageSeries(days) });
    } catch (error) {
      set({ error: String(error) });
    }
  },
  cycleGroupMode() {
    set((state) => ({
      groupMode:
        state.groupMode === "time" ? "status" : state.groupMode === "status" ? "name" : "time",
    }));
  },
  toggleWorkspaceCollapsed(id) {
    set((state) => ({
      collapsedWorkspaces: { ...state.collapsedWorkspaces, [id]: !state.collapsedWorkspaces[id] },
    }));
  },
  setSettingsOpen(settingsOpen) {
    if (settingsOpen) get().openSettings();
    else {
      set({ settingsOpen: false, settingsFocus: null });
      clearSettingsHash();
    }
  },
  openSettings(opts) {
    const settingsTab = opts?.tab ?? get().settingsTab;
    const settingsFocus = opts?.focus ?? null;
    set({ settingsOpen: true, settingsTab, settingsFocus });
    writeSettingsHash(settingsTab, opts?.focus);
  },
  openSetupWizard() {
    set({ setupWizardOpen: true });
  },
  closeSetupWizard() {
    set({ setupWizardOpen: false });
  },
  clearSettingsFocus() {
    set({ settingsFocus: null });
  },
  async persistSettings(settings) {
    try {
      const saved = await hostApi.saveSettings(settings);
      set({
        settings: { ...DEFAULT_SETTINGS, ...saved },
        autoExecute: saved.autoExecute,
      });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
  async saveSettings(settings) {
    try {
      await get().persistSettings(settings);
      set({ settingsOpen: false, settingsFocus: null });
      clearSettingsHash();
    } catch {
      /* persistSettings already recorded the error */
    }
  },
  async reloadProviders() {
    try {
      const [providers, providerProfiles] = await Promise.all([
        hostApi.providers(),
        hostApi.providerProfiles(),
      ]);
      set({ providers, providerProfiles });
    } catch (error) {
      set({ error: String(error) });
    }
  },
}));

export function iconForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (
    ["ts", "tsx", "js", "jsx", "py", "go", "rs", "md", "json", "yml", "yaml", "csv"].includes(
      extension || "",
    )
  )
    return extension === "yaml" ? "yml" : extension || "";
  return "";
}

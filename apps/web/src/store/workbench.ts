import { create } from "zustand";
import {
  hostApi,
  servedByHost,
  subscribeHostEvents,
  type Artifact,
  type Connector,
  type FsNode,
  type PlatformInfo,
  type PolicyBundle,
  type ProviderHealth,
  type QueueItem,
  type Run,
  type Schedule,
  type Session,
  type Skill,
  type UsageReport,
  type Workspace,
  type WorkspaceContext,
} from "../host/client";
import { sampleAnalysisRunEvents, type AgentEvent } from "@her-dock/agent-protocol";

export type CenterView = "chat" | "code" | "diff" | "activity";
export type SideTab = "workspace" | "approvals" | "context" | "skills" | "cost";
/** 工作区分组方式，对应设计稿侧栏的「按时间 / 按状态 / 按名称」。 */
export type GroupMode = "time" | "status" | "name";
export type SessionKind = "coding" | "analysis" | "mixed";

export type ApprovalItem = {
  approvalId: string;
  runId: string;
  title: string;
  detail: string;
  risk: string;
  kind: string;
};

/** 中央区顶部的标签页（会话 / 代码 / 差异 / 活动）。 */
export type WorkTab = {
  key: string;
  view: CenterView;
  label: string;
  icon: string;
  path?: string;
  closable: boolean;
};

const BASE_TABS: WorkTab[] = [
  { key: "chat", view: "chat", label: "会话", icon: "◆", closable: false },
  { key: "diff", view: "diff", label: "差异", icon: "±", closable: false },
  { key: "activity", view: "activity", label: "活动", icon: "▤", closable: false },
];

const OFFLINE_PLATFORM: PlatformInfo = {
  os: "browser",
  arch: "web",
  desktop: false,
  chrome: "web",
  dataDir: "",
  pathSeparator: "/",
  modifierKey: isApple() ? "⌘" : "Ctrl",
  commandHint: isApple() ? "⌘K" : "Ctrl K",
  newHint: isApple() ? "⌘N" : "Ctrl N",
  submitHint: isApple() ? "⌘⏎" : "Ctrl ⏎",
  defaultShell: isApple() ? "zsh" : "PowerShell",
  windowControl: "none",
};

function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

type State = {
  hostOnline: boolean;
  platform: PlatformInfo;
  providers: ProviderHealth[];
  policy: PolicyBundle | null;
  connectors: Connector[];
  workspaces: Workspace[];
  workspace: Workspace | null;
  /** 每个工作区的会话列表，供侧栏分组渲染。 */
  workspaceSessions: Record<string, Session[]>;
  collapsedWorkspaces: Record<string, boolean>;
  groupMode: GroupMode;
  sessions: Session[];
  session: Session | null;
  runs: Run[];
  /** Recent runs across every workspace — drives 活动 and the sidebar status dots. */
  allRuns: Run[];
  run: Run | null;
  events: AgentEvent[];
  checkpoints: { id: string; label: string; createdAt: string }[];
  tree: FsNode[];
  skills: Skill[];
  schedules: Schedule[];
  context: WorkspaceContext | null;
  usage: UsageReport | null;
  queue: QueueItem[];
  queueOpen: boolean;
  tabs: WorkTab[];
  activeTab: string;
  centerView: CenterView;
  sideTab: SideTab;
  rightOpen: boolean;
  paletteOpen: boolean;
  paletteQuery: string;
  providerId: string;
  autoExecute: string;
  demoMode: boolean;
  kind: SessionKind;
  openFile: string | null;
  fileContent: string;
  dirty: boolean;
  draft: string;
  mentions: string[];
  approvals: ApprovalItem[];
  artifacts: Artifact[];
  answeredDecisions: Record<string, string>;
  statusLine: string;
  error: string | null;

  init: () => Promise<void>;
  openWorkspacePath: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  refreshPanels: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  newSession: () => Promise<void>;
  setCenterView: (v: CenterView) => void;
  setSideTab: (t: SideTab) => void;
  openPath: (path: string) => Promise<void>;
  closeTab: (key: string) => void;
  setActiveTab: (key: string) => void;
  setFileContent: (c: string) => void;
  saveFile: () => Promise<void>;
  sendPrompt: () => Promise<void>;
  continueRun: () => Promise<void>;
  cancelRun: () => Promise<void>;
  resolveApproval: (id: string, decision: string) => Promise<void>;
  answerDecision: (eventId: string, optionId: string, label: string) => Promise<void>;
  toggleSchedule: (id: string) => Promise<void>;
  setDraft: (s: string) => void;
  addMention: (path: string) => void;
  removeMention: (path: string) => void;
  setProviderId: (id: string) => void;
  setDemoMode: (v: boolean) => void;
  setKind: (k: SessionKind) => void;
  setAutoExecute: (v: string) => void;
  toggleRight: () => void;
  togglePalette: () => void;
  setPaletteQuery: (q: string) => void;
  toggleQueue: () => void;
  cycleGroupMode: () => void;
  toggleWorkspaceCollapsed: (id: string) => void;
  loadOfflineDemo: () => void;
};

function asEvents(raw: Record<string, unknown>[]): AgentEvent[] {
  return raw as unknown as AgentEvent[];
}

function tabsWithFile(tabs: WorkTab[], path: string): WorkTab[] {
  const key = `file:${path}`;
  if (tabs.some((t) => t.key === key)) return tabs;
  const label = path.split("/").pop() || path;
  const next = [...tabs];
  const activityIndex = next.findIndex((t) => t.key === "activity");
  const tab: WorkTab = {
    key,
    view: "code",
    label,
    icon: iconForPath(path),
    path,
    closable: true,
  };
  next.splice(activityIndex < 0 ? next.length : activityIndex, 0, tab);
  return next;
}

export function iconForPath(path: string): string {
  const name = path.toLowerCase();
  if (name.endsWith(".py")) return "py";
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "ts";
  if (name.endsWith(".js") || name.endsWith(".jsx")) return "js";
  if (name.endsWith(".go")) return "go";
  if (name.endsWith(".md")) return "md";
  if (name.endsWith(".json")) return "{}";
  if (name.endsWith(".yml") || name.endsWith(".yaml")) return "yml";
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xls";
  return "·";
}

export const useWorkbench = create<State>((set, get) => ({
  hostOnline: false,
  platform: OFFLINE_PLATFORM,
  providers: [],
  policy: null,
  connectors: [],
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
  checkpoints: [],
  tree: [],
  skills: [],
  schedules: [],
  context: null,
  usage: null,
  queue: [],
  queueOpen: false,
  tabs: BASE_TABS,
  activeTab: "chat",
  centerView: "chat",
  sideTab: "workspace",
  rightOpen: true,
  paletteOpen: false,
  paletteQuery: "",
  providerId: "codex",
  autoExecute: "ask_risky",
  demoMode: true,
  kind: "mixed",
  openFile: null,
  fileContent: "",
  dirty: false,
  draft: "",
  mentions: [],
  approvals: [],
  artifacts: [],
  answeredDecisions: {},
  statusLine: "offline",
  error: null,

  async init() {
    try {
      await hostApi.health();
      const [hostPlatform, providers, policy, connectors, workspaces] = await Promise.all([
        hostApi.platform().catch(() => OFFLINE_PLATFORM),
        hostApi.providers(),
        hostApi.policy(),
        hostApi.connectors(),
        hostApi.listWorkspaces(),
      ]);
      // Only the desktop shell (which serves this bundle) gets native chrome;
      // a browser tab keeps the web frame even when the host runs on macOS/Windows.
      const inShell = servedByHost();
      const platform: PlatformInfo = inShell
        ? hostPlatform
        : { ...hostPlatform, chrome: "web", desktop: false, windowControl: "none" };
      const available = providers.find((p) => p.available)?.id || "codex";
      set({
        hostOnline: true,
        platform,
        providers,
        policy,
        connectors,
        workspaces,
        providerId: available,
        autoExecute: policy.maxAutoExecute || "ask_risky",
        statusLine: `host online · ${
          providers
            .filter((p) => p.available)
            .map((p) => p.id)
            .join("/") || "no-cli"
        }`,
        error: null,
      });

      // Sessions for every known workspace so the sidebar can group them.
      const sessionMap: Record<string, Session[]> = {};
      await Promise.all(
        workspaces.map(async (w) => {
          try {
            sessionMap[w.id] = await hostApi.listSessions(w.id);
          } catch {
            sessionMap[w.id] = [];
          }
        }),
      );
      set({ workspaceSessions: sessionMap });

      subscribeHostEvents((payload) => {
        if (payload.channel !== "run:event") return;
        const ev = payload.event as unknown as AgentEvent;
        const { run } = get();
        if (!run || ev.runId !== run.id) {
          if (ev.type === "approval.requested") {
            set((s) => ({
              approvals: [approvalFrom(ev), ...s.approvals],
              sideTab: "approvals",
              rightOpen: true,
            }));
          }
          return;
        }
        set((s) => {
          const events = [...s.events, ev].sort((a, b) => a.seq - b.seq);
          let nextRun = s.run;
          if (ev.type === "run.status" && s.run) {
            nextRun = {
              ...s.run,
              status: String((ev as { status?: string }).status || s.run.status),
            };
          }
          const approvals = [...s.approvals];
          if (ev.type === "approval.requested") approvals.unshift(approvalFrom(ev));
          if (ev.type === "approval.resolved") {
            const id = String((ev as { approvalId?: string }).approvalId);
            const i = approvals.findIndex((a) => a.approvalId === id);
            if (i >= 0) approvals.splice(i, 1);
          }
          const checkpoints = [...s.checkpoints];
          if (ev.type === "checkpoint.created") {
            checkpoints.unshift({
              id: String((ev as { checkpointId?: string }).checkpointId),
              label: String((ev as { label?: string }).label || ""),
              createdAt: ev.ts,
            });
          }
          return {
            events,
            run: nextRun,
            approvals,
            checkpoints,
            statusLine: `${nextRun?.id || ""} · ${nextRun?.status || ""}`,
          };
        });
        if (ev.type === "run.status" || ev.type === "artifact.created") {
          void get().refreshPanels();
        }
      });

      if (workspaces[0]) {
        await get().openWorkspacePath(workspaces[0].rootPath);
      } else {
        await get().refreshPanels();
      }
    } catch {
      set({
        hostOnline: false,
        statusLine: "host offline · fixture demo",
        error:
          "无法连接 her-dock host（127.0.0.1:17890）。可先 pnpm dev:host，或使用离线 fixture。",
      });
      get().loadOfflineDemo();
    }
  },

  loadOfflineDemo() {
    const events = sampleAnalysisRunEvents as AgentEvent[];
    const workspace: Workspace = {
      id: "ws_demo",
      name: "northlake-crm",
      rootPath: "~/work/northlake-crm",
      branch: "main",
      dirtySummary: "+4 −1",
    };
    const sessions: Session[] = [
      {
        id: "sess_demo",
        workspaceId: "ws_demo",
        title: "门店销售异常排查",
        kind: "analysis",
        providerId: "codex",
      },
      {
        id: "sess_demo2",
        workspaceId: "ws_demo",
        title: "门店日报脚本调整",
        kind: "coding",
        providerId: "codex",
      },
    ];
    const demoRuns: Run[] = [
      {
        id: "RUN-337",
        sessionId: "sess_demo",
        workspaceId: "ws_demo",
        providerId: "codex",
        status: "waiting_human",
        prompt: "门店销售异常排查",
        planProgress: "3/5",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "RUN-318",
        sessionId: "sess_demo2",
        workspaceId: "ws_demo",
        providerId: "codex",
        status: "completed",
        prompt: "门店销售日报",
        planProgress: "3/3",
        updatedAt: new Date().toISOString(),
      },
    ];
    set({
      events,
      run: demoRuns[0],
      runs: demoRuns,
      allRuns: demoRuns,
      session: sessions[0],
      workspace,
      workspaces: [workspace],
      sessions,
      workspaceSessions: { ws_demo: sessions },
      checkpoints: [
        { id: "CP-03", label: "运行扫描脚本后", createdAt: "2026-08-09T14:32:13.000Z" },
        { id: "CP-02", label: "写入口径规则前", createdAt: "2026-08-09T14:31:10.000Z" },
        { id: "CP-01", label: "会话开始", createdAt: "2026-08-09T14:29:00.000Z" },
      ],
      artifacts: [
        { id: "a1", path: "out/离群门店明细.xlsx", name: "离群门店明细.xlsx", ext: "xlsx", sizeBytes: 24576 },
      ],
      skills: [
        { id: "table", glyph: "表", name: "表格分析", status: "enabled", detail: "读取 xlsx/csv，做聚合、透视与异常检测。" },
        { id: "code", glyph: "码", name: "代码执行", status: "enabled", detail: "在工作区沙箱里运行脚本，产物写入 out/。" },
        { id: "warehouse", glyph: "库", name: "数据仓库", status: "readonly", detail: "只读副本，用于核对线上口径。" },
        { id: "doc", glyph: "文", name: "文档生成", status: "enabled", detail: "按 rules/ 模板输出摘要与周报。" },
        { id: "web", glyph: "网", name: "网页抓取", status: "limited", detail: "仅允许白名单域名，需逐次确认。" },
        { id: "search", glyph: "知", name: "知识检索", status: "enabled", detail: "检索工作区内历史结论与纪要。" },
      ],
      context: {
        files: [
          { path: "agents/store/outlier_scan.py", kind: "code", size: "3.1 KB" },
          { path: "rules/口径.md", kind: "rule", size: "8.2 KB" },
          { path: "data/sales_east_q3.xlsx", kind: "data", size: "1.2 MB" },
          { path: "xingzhi.yml", kind: "config", size: "412 B" },
        ],
        rules: [
          "开业不满 90 天的门店不计入异常名单。",
          "周末与工作日的销售必须分开统计。",
          "结论中的数字都要附上原始表与行号。",
          "写入 out/ 之外的目录前必须先问我。",
        ],
        outputDir: "out",
        testCommand: "pnpm test",
        autoExecute: "ask_risky",
      },
      usage: {
        buckets: [
          { key: "run", label: "本次会话", tokens: 42600, runs: 1, calls: 11 },
          { key: "today", label: "今天", tokens: 128400, runs: 6, calls: 48 },
          { key: "month", label: "本月额度", tokens: 18400, runs: 62, calls: 410, limit: 50000 },
        ],
        credits: 2480,
        context: { used: 42600, limit: 200000 },
      },
      queue: [
        { runId: "RUN-337", name: "与促销日历交叉核对", workspaceId: "ws_demo", status: "running", meta: "RUN-337 · 下一步" },
        { runId: "RUN-341", name: "渠道投放素材批量生成", workspaceId: "ws_demo", status: "queued", meta: "RUN-341 · 等待算力" },
      ],
      schedules: [
        {
          id: "s1",
          workspaceId: "ws_demo",
          name: "门店销售日报",
          cron: "0 7 * * *",
          enabled: true,
          nextRunAt: nextDemoRun(1, 7),
        },
        {
          id: "s2",
          workspaceId: "ws_demo",
          name: "竞品定价监测",
          cron: "30 8 * * 1",
          enabled: true,
          nextRunAt: nextDemoRun(2, 8, 30),
        },
        {
          id: "s3",
          workspaceId: "ws_demo",
          name: "工单情绪聚类",
          cron: "0 18 * * 5",
          enabled: false,
        },
      ],
      tree: [
        {
          name: "agents",
          path: "agents",
          kind: "dir",
          children: [
            {
              name: "store",
              path: "agents/store",
              kind: "dir",
              children: [
                { name: "outlier_scan.py", path: "agents/store/outlier_scan.py", kind: "file", gitStatus: "M" },
                { name: "split_weekend.py", path: "agents/store/split_weekend.py", kind: "file", gitStatus: "A" },
              ],
            },
          ],
        },
        {
          name: "data",
          path: "data",
          kind: "dir",
          children: [
            { name: "sales_east_q3.xlsx", path: "data/sales_east_q3.xlsx", kind: "file" },
            { name: "store_master.csv", path: "data/store_master.csv", kind: "file" },
          ],
        },
        {
          name: "rules",
          path: "rules",
          kind: "dir",
          children: [{ name: "口径.md", path: "rules/口径.md", kind: "file", gitStatus: "M" }],
        },
        {
          name: "out",
          path: "out",
          kind: "dir",
          children: [
            { name: "离群门店明细.xlsx", path: "out/离群门店明细.xlsx", kind: "file", gitStatus: "A" },
          ],
        },
        { name: "xingzhi.yml", path: "xingzhi.yml", kind: "file" },
      ],
      openFile: "agents/store/outlier_scan.py",
      tabs: tabsWithFile(BASE_TABS, "agents/store/outlier_scan.py"),
      fileContent:
        '# 离线 fixture — 连接 host 后读取真实文件\nimport pandas as pd\nfrom pathlib import Path\n\nDATA = Path("data")\nMIN_AGE_DAYS = 90        # 见 rules/口径.md\nSIGMA = 2.0\n',
      statusLine: "RUN-337 · waiting_human · offline fixture",
    });
  },

  async openWorkspacePath(path: string) {
    const ws = await hostApi.openWorkspace(path);
    const [sessions, tree, artifacts, workspaces] = await Promise.all([
      hostApi.listSessions(ws.id),
      hostApi.tree(ws.id),
      hostApi.listArtifacts(ws.id),
      hostApi.listWorkspaces(),
    ]);
    set((s) => ({
      workspace: ws,
      workspaces,
      sessions,
      workspaceSessions: { ...s.workspaceSessions, [ws.id]: sessions },
      session: sessions[0] || null,
      tree,
      artifacts: artifacts || [],
      events: [],
      run: null,
    }));
    await get().refreshPanels();
    if (sessions[0]) await get().selectSession(sessions[0].id);
  },

  async refreshTree() {
    const { workspace, hostOnline } = get();
    if (!workspace || !hostOnline) return;
    const tree = await hostApi.tree(workspace.id);
    set({ tree });
  },

  /** Reload the right panel + status bar data sets from the host. */
  async refreshPanels() {
    const { workspace, hostOnline, run } = get();
    if (!hostOnline) return;
    const [skills, queue, usage, schedules, context, artifacts, allRuns] = await Promise.all([
      hostApi.skills(workspace?.id).catch(() => [] as Skill[]),
      hostApi.queue().catch(() => [] as QueueItem[]),
      hostApi.usage(run?.id).catch(() => null),
      workspace ? hostApi.schedules(workspace.id).catch(() => [] as Schedule[]) : Promise.resolve([]),
      workspace ? hostApi.workspaceContext(workspace.id).catch(() => null) : Promise.resolve(null),
      workspace ? hostApi.listArtifacts(workspace.id).catch(() => [] as Artifact[]) : Promise.resolve([]),
      hostApi.recentRuns().catch(() => [] as Run[]),
    ]);
    set({
      skills,
      queue,
      usage,
      schedules,
      context,
      artifacts: artifacts || [],
      allRuns: allRuns || [],
    });
  },

  async selectSession(id: string) {
    const { workspaceSessions, sessions, hostOnline } = get();
    const all = [...sessions, ...Object.values(workspaceSessions).flat()];
    const session = all.find((s) => s.id === id) || null;
    set({ session, centerView: "chat", activeTab: "chat" });
    if (!session || !hostOnline) return;
    if (session.workspaceId !== get().workspace?.id) {
      const ws = get().workspaces.find((w) => w.id === session.workspaceId);
      if (ws) {
        const [tree, list] = await Promise.all([
          hostApi.tree(ws.id).catch(() => [] as FsNode[]),
          hostApi.listSessions(ws.id).catch(() => [] as Session[]),
        ]);
        set({ workspace: ws, tree, sessions: list });
      }
    }
    const runs = await hostApi.listRuns(session.id);
    const run = runs[0] || null;
    let events: AgentEvent[] = [];
    let checkpoints: { id: string; label: string; createdAt: string }[] = [];
    if (run) {
      events = asEvents(await hostApi.events(run.id));
      const raw = await hostApi.checkpoints(run.id).catch(() => []);
      checkpoints = raw.map((c) => ({
        id: String(c.id),
        label: String(c.label ?? ""),
        createdAt: String(c.createdAt ?? ""),
      }));
    }
    set({ runs, run, events, checkpoints });
    await get().refreshPanels();
  },

  async newSession() {
    const { workspace, providerId, kind, hostOnline } = get();
    if (!workspace) return;
    if (!hostOnline) {
      set({
        session: {
          id: "sess_local",
          workspaceId: workspace.id,
          title: "新会话",
          kind,
          providerId,
        },
        events: [],
        run: null,
        centerView: "chat",
        activeTab: "chat",
      });
      return;
    }
    const session = await hostApi.createSession(workspace.id, {
      title: kind === "analysis" ? "分析会话" : kind === "coding" ? "编码会话" : "新会话",
      kind,
      providerId,
    });
    const sessions = await hostApi.listSessions(workspace.id);
    set((s) => ({
      session,
      sessions,
      workspaceSessions: { ...s.workspaceSessions, [workspace.id]: sessions },
      events: [],
      run: null,
      centerView: "chat",
      activeTab: "chat",
    }));
  },

  setCenterView: (centerView) => {
    set((s) => ({
      centerView,
      activeTab:
        centerView === "code"
          ? s.tabs.find((t) => t.view === "code")?.key || s.activeTab
          : centerView,
    }));
    if (centerView === "activity") void get().refreshPanels();
  },
  setSideTab: (sideTab) => set({ sideTab, rightOpen: true }),
  setActiveTab: (key) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.key === key);
      if (!tab) return {};
      return {
        activeTab: key,
        centerView: tab.view,
        openFile: tab.path ?? s.openFile,
      };
    }),
  closeTab: (key) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.key === key);
      if (!tab || !tab.closable) return {};
      const tabs = s.tabs.filter((t) => t.key !== key);
      if (s.activeTab !== key) return { tabs };
      return { tabs, activeTab: "chat", centerView: "chat" as CenterView };
    }),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen, paletteQuery: "" })),
  setPaletteQuery: (paletteQuery) => set({ paletteQuery }),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  cycleGroupMode: () =>
    set((s) => {
      const order: GroupMode[] = ["time", "status", "name"];
      return { groupMode: order[(order.indexOf(s.groupMode) + 1) % order.length] };
    }),
  toggleWorkspaceCollapsed: (id) =>
    set((s) => ({
      collapsedWorkspaces: { ...s.collapsedWorkspaces, [id]: !s.collapsedWorkspaces[id] },
    })),
  setDraft: (draft) => set({ draft }),
  addMention: (path) =>
    set((s) => (s.mentions.includes(path) ? {} : { mentions: [...s.mentions, path] })),
  removeMention: (path) => set((s) => ({ mentions: s.mentions.filter((m) => m !== path) })),
  setProviderId: (providerId) => set({ providerId }),
  setDemoMode: (demoMode) => set({ demoMode }),
  setKind: (kind) => set({ kind }),
  setAutoExecute: (autoExecute) => set({ autoExecute }),
  setFileContent: (fileContent) => set({ fileContent, dirty: true }),

  async openPath(path: string) {
    const { workspace, hostOnline } = get();
    set((s) => ({
      openFile: path,
      centerView: "code",
      tabs: tabsWithFile(s.tabs, path),
      activeTab: `file:${path}`,
    }));
    if (!workspace || !hostOnline) return;
    try {
      const f = await hostApi.readFile(workspace.id, path);
      set({ fileContent: f.content, dirty: false, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async saveFile() {
    const { workspace, openFile, fileContent, hostOnline } = get();
    if (!workspace || !openFile) return;
    if (!hostOnline) {
      set({ dirty: false });
      return;
    }
    await hostApi.writeFile(workspace.id, openFile, fileContent);
    set({ dirty: false });
    await get().refreshTree();
  },

  async sendPrompt() {
    const { draft, mentions, session, workspace, providerId, autoExecute, demoMode, hostOnline, kind } =
      get();
    const text = [
      ...mentions.map((m) => `@${m}`),
      draft.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    if (!text) return;
    if (!hostOnline) {
      get().loadOfflineDemo();
      set({ draft: "", mentions: [] });
      return;
    }
    let sess = session;
    if (!sess && workspace) {
      sess = await hostApi.createSession(workspace.id, {
        title: draft.slice(0, 40) || "新会话",
        kind,
        providerId,
      });
      const sessions = await hostApi.listSessions(workspace.id);
      set((s) => ({
        session: sess,
        sessions,
        workspaceSessions: { ...s.workspaceSessions, [workspace.id]: sessions },
      }));
    }
    if (!sess || !workspace) return;
    const run = await hostApi.startRun({
      sessionId: sess.id,
      workspaceId: workspace.id,
      providerId,
      prompt: text,
      autoExecute,
      demo: demoMode,
    });
    set({
      run,
      events: [],
      draft: "",
      mentions: [],
      centerView: "chat",
      activeTab: "chat",
      statusLine: `${run.id} · starting`,
    });
  },

  async continueRun() {
    const { run, workspace, autoExecute, demoMode, hostOnline, draft } = get();
    if (!run) return;
    if (!hostOnline) {
      set({ statusLine: "offline: continue 仅在 host 在线时可用" });
      return;
    }
    let summary = "Human edited files on disk take precedence.";
    if (workspace) {
      try {
        const d = await hostApi.diffSummary(workspace.id);
        summary = d.summary;
      } catch {
        /* ignore */
      }
    }
    const next = await hostApi.continueRun(run.id, {
      humanSummary: summary,
      note: draft,
      autoExecute,
      demo: demoMode,
    });
    set({
      run: next,
      events: [],
      draft: "",
      centerView: "chat",
      activeTab: "chat",
      statusLine: `${next.id} · continue`,
    });
  },

  async cancelRun() {
    const { run, hostOnline } = get();
    if (!run || !hostOnline) return;
    await hostApi.cancelRun(run.id);
    set({ run: { ...run, status: "cancelled" }, statusLine: `${run.id} · cancelled` });
  },

  async resolveApproval(id, decision) {
    if (!get().hostOnline) {
      set((s) => ({ approvals: s.approvals.filter((a) => a.approvalId !== id) }));
      return;
    }
    await hostApi.resolveApproval(id, decision);
    set((s) => ({ approvals: s.approvals.filter((a) => a.approvalId !== id) }));
  },

  async answerDecision(eventId, optionId, label) {
    const { run, hostOnline } = get();
    set((s) => ({ answeredDecisions: { ...s.answeredDecisions, [eventId]: label } }));
    if (!run || !hostOnline) return;
    await hostApi.resolveDecision(run.id, optionId, label).catch(() => undefined);
  },

  async toggleSchedule(id) {
    const { schedules, hostOnline, workspace } = get();
    const target = schedules.find((s) => s.id === id);
    if (!target) return;
    const enabled = !target.enabled;
    set({ schedules: schedules.map((s) => (s.id === id ? { ...s, enabled } : s)) });
    if (!hostOnline || !workspace) return;
    await hostApi
      .saveSchedule({ id, workspaceId: target.workspaceId || workspace.id, enabled })
      .catch(() => undefined);
  },
}));

/** Offline-fixture helper: a date `days` from now at the given wall-clock time. */
function nextDemoRun(days: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function approvalFrom(ev: AgentEvent): ApprovalItem {
  const e = ev as unknown as Record<string, string>;
  return {
    approvalId: String(e.approvalId),
    runId: ev.runId,
    title: String(e.title || "Approval"),
    detail: String(e.detail || ""),
    risk: String(e.risk || "medium"),
    kind: String(e.kind || "other"),
  };
}

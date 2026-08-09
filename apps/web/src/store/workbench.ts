import { create } from "zustand";
import {
  hostApi,
  subscribeHostEvents,
  type Connector,
  type FsNode,
  type PolicyBundle,
  type ProviderHealth,
  type Run,
  type Session,
  type Workspace,
} from "../host/client";
import {
  sampleAnalysisRunEvents,
  type AgentEvent,
} from "@her-dock/agent-protocol";

export type CenterView = "chat" | "code" | "diff" | "activity";
export type SideTab =
  | "workspace"
  | "approvals"
  | "context"
  | "skills"
  | "cost"
  | "artifacts";

export type ApprovalItem = {
  approvalId: string;
  runId: string;
  title: string;
  detail: string;
  risk: string;
  kind: string;
};

type State = {
  hostOnline: boolean;
  providers: ProviderHealth[];
  policy: PolicyBundle | null;
  connectors: Connector[];
  workspaces: Workspace[];
  workspace: Workspace | null;
  sessions: Session[];
  session: Session | null;
  runs: Run[];
  run: Run | null;
  events: AgentEvent[];
  tree: FsNode[];
  centerView: CenterView;
  sideTab: SideTab;
  rightOpen: boolean;
  paletteOpen: boolean;
  providerId: string;
  autoExecute: string;
  demoMode: boolean;
  kind: "coding" | "analysis" | "mixed";
  openFile: string | null;
  fileContent: string;
  dirty: boolean;
  draft: string;
  approvals: ApprovalItem[];
  artifacts: { id: string; path: string; name: string; ext: string }[];
  statusLine: string;
  error: string | null;
  init: () => Promise<void>;
  openWorkspacePath: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  newSession: () => Promise<void>;
  setCenterView: (v: CenterView) => void;
  setSideTab: (t: SideTab) => void;
  openPath: (path: string) => Promise<void>;
  setFileContent: (c: string) => void;
  saveFile: () => Promise<void>;
  sendPrompt: () => Promise<void>;
  continueRun: () => Promise<void>;
  cancelRun: () => Promise<void>;
  resolveApproval: (id: string, decision: string) => Promise<void>;
  setDraft: (s: string) => void;
  setProviderId: (id: string) => void;
  setDemoMode: (v: boolean) => void;
  setKind: (k: "coding" | "analysis" | "mixed") => void;
  setAutoExecute: (v: string) => void;
  toggleRight: () => void;
  togglePalette: () => void;
  loadOfflineDemo: () => void;
};

function asEvents(raw: Record<string, unknown>[]): AgentEvent[] {
  return raw as unknown as AgentEvent[];
}

export const useWorkbench = create<State>((set, get) => ({
  hostOnline: false,
  providers: [],
  policy: null,
  connectors: [],
  workspaces: [],
  workspace: null,
  sessions: [],
  session: null,
  runs: [],
  run: null,
  events: [],
  tree: [],
  centerView: "chat",
  sideTab: "workspace",
  rightOpen: true,
  paletteOpen: false,
  providerId: "codex",
  autoExecute: "ask_risky",
  demoMode: true,
  kind: "mixed",
  openFile: null,
  fileContent: "",
  dirty: false,
  draft: "",
  approvals: [],
  artifacts: [],
  statusLine: "offline",
  error: null,

  async init() {
    try {
      await hostApi.health();
      const [providers, policy, connectors, workspaces] = await Promise.all([
        hostApi.providers(),
        hostApi.policy(),
        hostApi.connectors(),
        hostApi.listWorkspaces(),
      ]);
      const available = providers.find((p) => p.available)?.id || "codex";
      set({
        hostOnline: true,
        providers,
        policy,
        connectors,
        workspaces,
        providerId: available,
        autoExecute: policy.maxAutoExecute || "ask_risky",
        statusLine: `host online · ${providers.filter((p) => p.available).map((p) => p.id).join("/") || "no-cli"}`,
        error: null,
      });
      subscribeHostEvents((payload) => {
        if (payload.channel !== "run:event") return;
        const ev = payload.event as unknown as AgentEvent;
        const { run } = get();
        if (!run || ev.runId !== run.id) {
          if (ev.type === "approval.requested") {
            set((s) => ({
              approvals: [
                {
                  approvalId: String((ev as { approvalId?: string }).approvalId),
                  runId: ev.runId,
                  title: String((ev as { title?: string }).title || "Approval"),
                  detail: String((ev as { detail?: string }).detail || ""),
                  risk: String((ev as { risk?: string }).risk || "medium"),
                  kind: String((ev as { kind?: string }).kind || "other"),
                },
                ...s.approvals,
              ],
              sideTab: "approvals",
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
          if (ev.type === "approval.requested") {
            approvals.unshift({
              approvalId: String((ev as { approvalId?: string }).approvalId),
              runId: ev.runId,
              title: String((ev as { title?: string }).title || "Approval"),
              detail: String((ev as { detail?: string }).detail || ""),
              risk: String((ev as { risk?: string }).risk || "medium"),
              kind: String((ev as { kind?: string }).kind || "other"),
            });
          }
          return {
            events,
            run: nextRun,
            approvals,
            statusLine: `${nextRun?.id || ""} · ${nextRun?.status || ""}`,
          };
        });
      });
      if (workspaces[0]) {
        await get().openWorkspacePath(workspaces[0].rootPath);
      }
    } catch {
      set({
        hostOnline: false,
        statusLine: "host offline · fixture demo",
        error: "无法连接 her-dock host（127.0.0.1:17890）。可先 pnpm dev:host，或使用离线 fixture。",
      });
      get().loadOfflineDemo();
    }
  },

  loadOfflineDemo() {
    set({
      events: sampleAnalysisRunEvents as AgentEvent[],
      run: {
        id: "RUN-337",
        sessionId: "sess_demo",
        workspaceId: "ws_demo",
        providerId: "codex",
        status: "waiting_human",
        prompt: "门店销售异常排查",
        planProgress: "3/5",
      },
      session: {
        id: "sess_demo",
        workspaceId: "ws_demo",
        title: "门店销售异常排查",
        kind: "analysis",
        providerId: "codex",
      },
      workspace: {
        id: "ws_demo",
        name: "northlake-crm",
        rootPath: "~/work/northlake-crm",
        branch: "main",
        dirtySummary: "+4 −1",
      },
      sessions: [
        {
          id: "sess_demo",
          workspaceId: "ws_demo",
          title: "门店销售异常排查",
          kind: "analysis",
          providerId: "codex",
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
                {
                  name: "outlier_scan.py",
                  path: "agents/store/outlier_scan.py",
                  kind: "file",
                  gitStatus: "M",
                },
              ],
            },
          ],
        },
        {
          name: "rules",
          path: "rules",
          kind: "dir",
          children: [
            { name: "口径.md", path: "rules/口径.md", kind: "file", gitStatus: "M" },
          ],
        },
        {
          name: "out",
          path: "out",
          kind: "dir",
          children: [
            { name: "离群门店明细.xlsx", path: "out/离群门店明细.xlsx", kind: "file", gitStatus: "A" },
          ],
        },
      ],
      openFile: "agents/store/outlier_scan.py",
      fileContent: `# demo file — connect host for real FS\nMIN_AGE_DAYS = 90\nSIGMA = 2.0\n`,
      statusLine: "RUN-337 · waiting_human · offline fixture",
    });
  },

  async openWorkspacePath(path: string) {
    const ws = await hostApi.openWorkspace(path);
    const sessions = await hostApi.listSessions(ws.id);
    const tree = await hostApi.tree(ws.id);
    const artifacts = await hostApi.listArtifacts(ws.id);
    set({
      workspace: ws,
      workspaces: await hostApi.listWorkspaces(),
      sessions,
      session: sessions[0] || null,
      tree,
      artifacts,
      events: [],
      run: null,
    });
    if (sessions[0]) await get().selectSession(sessions[0].id);
  },

  async refreshTree() {
    const { workspace } = get();
    if (!workspace || !get().hostOnline) return;
    const tree = await hostApi.tree(workspace.id);
    set({ tree });
  },

  async selectSession(id: string) {
    const { sessions, hostOnline } = get();
    const session = sessions.find((s) => s.id === id) || null;
    set({ session });
    if (!session || !hostOnline) return;
    const runs = await hostApi.listRuns(session.id);
    const run = runs[0] || null;
    let events: AgentEvent[] = [];
    if (run) {
      events = asEvents(await hostApi.events(run.id));
    }
    set({ runs, run, events, centerView: "chat" });
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
      });
      return;
    }
    const session = await hostApi.createSession(workspace.id, {
      title: kind === "analysis" ? "分析会话" : "编码会话",
      kind,
      providerId,
    });
    const sessions = await hostApi.listSessions(workspace.id);
    set({ session, sessions, events: [], run: null, centerView: "chat" });
  },

  setCenterView: (centerView) => set({ centerView }),
  setSideTab: (sideTab) => set({ sideTab }),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setDraft: (draft) => set({ draft }),
  setProviderId: (providerId) => set({ providerId }),
  setDemoMode: (demoMode) => set({ demoMode }),
  setKind: (kind) => set({ kind }),
  setAutoExecute: (autoExecute) => set({ autoExecute }),
  setFileContent: (fileContent) => set({ fileContent, dirty: true }),

  async openPath(path: string) {
    const { workspace, hostOnline } = get();
    set({ openFile: path, centerView: "code" });
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
    const {
      draft,
      session,
      workspace,
      providerId,
      autoExecute,
      demoMode,
      hostOnline,
      kind,
    } = get();
    if (!draft.trim()) return;
    if (!hostOnline) {
      get().loadOfflineDemo();
      set({ draft: "" });
      return;
    }
    let sess = session;
    if (!sess && workspace) {
      sess = await hostApi.createSession(workspace.id, {
        title: draft.slice(0, 40),
        kind,
        providerId,
      });
      set({
        session: sess,
        sessions: await hostApi.listSessions(workspace.id),
      });
    }
    if (!sess || !workspace) return;
    const run = await hostApi.startRun({
      sessionId: sess.id,
      workspaceId: workspace.id,
      providerId,
      prompt: draft.trim(),
      autoExecute,
      demo: demoMode,
    });
    set({
      run,
      events: [],
      draft: "",
      centerView: "chat",
      statusLine: `${run.id} · starting`,
    });
  },

  async continueRun() {
    const { run, workspace, autoExecute, demoMode, hostOnline, draft } = get();
    if (!run) return;
    if (!hostOnline) {
      set({
        statusLine: "offline: continue 仅在 host 在线时可用",
      });
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
      statusLine: `${next.id} · continue`,
    });
  },

  async cancelRun() {
    const { run, hostOnline } = get();
    if (!run || !hostOnline) return;
    await hostApi.cancelRun(run.id);
    set({
      run: { ...run, status: "cancelled" },
      statusLine: `${run.id} · cancelled`,
    });
  },

  async resolveApproval(id, decision) {
    if (!get().hostOnline) return;
    await hostApi.resolveApproval(id, decision);
    set((s) => ({
      approvals: s.approvals.filter((a) => a.approvalId !== id),
    }));
  },
}));

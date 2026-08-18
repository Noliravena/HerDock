import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowClockwise,
  ArrowSquareOut,
  ArrowsOut,
  ArrowUp,
  At,
  BracketsCurly,
  CaretDown,
  ChatCircleDots,
  Check,
  ClockCounterClockwise,
  CompassTool,
  Copy,
  Cursor,
  DeviceMobile,
  DeviceTablet,
  Export,
  FileHtml,
  ImageSquare,
  ImagesSquare,
  MagnifyingGlass,
  Minus,
  Monitor,
  Palette,
  Paperclip,
  PencilSimple,
  Plus,
  PresentationChart,
  SelectionAll,
  SelectionPlus,
  SidebarSimple,
  Sparkle,
  SquaresFour,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import type { AgentEvent, PlanStep } from "@her-dock/agent-protocol";
import {
  hostApi,
  type Approval,
  type Artifact,
  type Checkpoint,
  type ContextItem,
  type DesignSystem,
  type DesignSystemContent,
  type Run,
} from "../host/client";
import { chatModelLabel } from "../lib/models";
import { loadPromptHistory, pushPromptHistory } from "../lib/prompts";
import { runTimingLabel, tokensLite } from "../lib/runMetrics";
import {
  useWorkbench,
  type DesignRoute,
  type DesignRunInput,
  type Toast,
} from "../store/workbench";
import {
  DesignAgentPlan,
  DesignApprovalCard,
  DesignArtifactCard,
  DesignCheckpointCard,
  DesignComparison,
  DesignConnectionBanner,
  DesignEditsList,
  DesignEmptyColumn,
  DesignErrorBanner,
  DesignJobProgress,
  DesignOnboarding,
  DesignPathTree,
  DesignQueuedNote,
  DesignRecommendation,
  DesignSessionViewport,
  DesignSpecSheet,
  DesignStatusPill,
  DesignToolTimeline,
  DesignTypingBubble,
  useElapsedLabel,
} from "./designElements";
import { AuiTabs, CheckpointPreviewDialog, useConfirm } from "./pageElements";
import { GenerationLoader } from "./GenerationLoader";
import { PanelSash } from "./PanelSash";
import { ThinkingIndicator } from "./ThinkingIndicator";

/** Accent choices offered by the tweak panel, in the order the design lays them out. */
const ACCENTS = ["#3b5ba5", "#2f6b58", "#a5622a", "#6b4f8a"];
const DENSITIES = [
  { label: "紧凑", value: 7 },
  { label: "标准", value: 9 },
  { label: "宽松", value: 12 },
];
const FONT_SCALES = [
  { label: "小", value: 0.92 },
  { label: "标准", value: 1 },
  { label: "大", value: 1.08 },
];

type ViewportId = "desktop" | "tablet" | "mobile";
const VIEWPORTS: Record<
  ViewportId,
  { label: string; width: number; height: number; Icon: typeof Monitor }
> = {
  desktop: { label: "桌面", width: 1280, height: 900, Icon: Monitor },
  tablet: { label: "平板", width: 744, height: 1024, Icon: DeviceTablet },
  mobile: { label: "手机", width: 390, height: 844, Icon: DeviceMobile },
};

/** Deliverable formats the session composer can request. */
const FORMATS: Array<{
  id: string;
  label: string;
  templateLabel: string;
  artifactKind: DesignRunInput["artifactKind"];
  renderer: DesignRunInput["renderer"];
}> = [
  { id: "html", label: "HTML", templateLabel: "Web 页面", artifactKind: "html", renderer: "html" },
  {
    id: "deck",
    label: "Deck",
    templateLabel: "演示文稿",
    artifactKind: "deck",
    renderer: "deck-html",
  },
];

const ROUTES: Array<{ id: DesignRoute; label: string; Icon: typeof Palette }> = [
  { id: "canvas", label: "画布", Icon: SelectionAll },
  { id: "projects", label: "项目", Icon: SquaresFour },
  { id: "systems", label: "设计系统", Icon: Palette },
  { id: "assets", label: "素材库", Icon: ImagesSquare },
];

/** Preview overrides driven by the tweak panel; also written back on 应用. */
type Tweaks = {
  accent: number;
  radius: number;
  density: number;
  fontScale: number;
  dark: boolean;
  grid: boolean;
  hotspots: boolean;
};
const DEFAULT_TWEAKS: Tweaks = {
  accent: 0,
  radius: 10,
  density: 1,
  fontScale: 1,
  dark: false,
  grid: false,
  hotspots: false,
};

/** One design project — a package directory under out/design/. */
type DesignDoc = { slug: string; title: string; artifacts: Artifact[] };
/** One iteration of a project; a run may emit several variants side by side. */
type DesignTurn = { key: string; index: number; at: string; variants: Artifact[] };

/** Follow-up suggestions (assistant-ui follow-up-suggestions element) tuned
 * for design iteration; offered when a turn exists and the brief is empty. */
const DESIGN_FOLLOWUPS = [
  "整体更紧凑一些，信息密度提高",
  "主色换成墨蓝，强调色保持克制",
  "加强深色模式下的层次",
  "补一版移动端优先的布局",
];
const DESIGN_EMPTY_PROMPTS = [
  "做一个仪表盘首页，三列指标卡加一张趋势图",
  "后台表格页：筛选、批量操作、行内状态",
  "移动端优先的设置页，分组开关与说明",
];
const DESIGN_ONBOARD_KEY = "herdock.design.onboarded";
const DESIGN_ONBOARD_STEPS = [
  {
    title: "先描述界面",
    body: "在左侧写下目标用户、页面结构和关键内容。Agent 会把可预览的 HTML 写进 out/design/。",
    example: DESIGN_EMPTY_PROMPTS[0],
  },
  {
    title: "并排比较方案",
    body: "一次可以生成 2–3 个方案。点选后用「采用」，后续迭代会钉在这一版上。",
    example: DESIGN_FOLLOWUPS[0],
  },
  {
    title: "项目、系统与素材",
    body: "顶部分段可进项目库、设计系统和素材库。选用的设计系统会进入下一次生成。",
    example: "用当前设计系统做一版登录页，左侧品牌、右侧表单",
  },
] as const;
const JOB_STAGES = [{ name: "排队" }, { name: "生成" }, { name: "写入" }, { name: "预览" }];

const DESIGN_BRIEF_KEY = "herdock.design-brief.v1";

function loadOnboarded(): boolean {
  try {
    return localStorage.getItem(DESIGN_ONBOARD_KEY) === "1";
  } catch {
    return false;
  }
}

function saveOnboarded(): void {
  try {
    localStorage.setItem(DESIGN_ONBOARD_KEY, "1");
  } catch {
    /* ignore */
  }
}

function loadBrief(workspaceId: string | undefined): string {
  if (!workspaceId) return "";
  try {
    return localStorage.getItem(`${DESIGN_BRIEF_KEY}:${workspaceId}`) ?? "";
  } catch {
    return "";
  }
}

function saveBrief(workspaceId: string | undefined, brief: string): void {
  if (!workspaceId) return;
  try {
    localStorage.setItem(`${DESIGN_BRIEF_KEY}:${workspaceId}`, brief);
  } catch {
    /* ignore */
  }
}

export function DesignView() {
  const state = useWorkbench(
    useShallow((s) => ({
      activeDesignArtifactId: s.activeDesignArtifactId,
      allRuns: s.allRuns,
      approvals: s.approvals,
      artifacts: s.artifacts,
      checkpoints: s.checkpoints,
      contextItems: s.contextItems,
      continueDesignRun: s.continueDesignRun,
      checkpointPreview: s.checkpointPreview,
      designDraft: s.designDraft,
      designRoute: s.designRoute,
      dirty: s.dirty,
      error: s.error,
      hostOnline: s.hostOnline,
      events: s.events,
      importContextPaths: s.importContextPaths,
      model: s.model,
      openDesignArtifact: s.openDesignArtifact,
      openPath: s.openPath,
      ensureDefaultWorkspace: s.ensureDefaultWorkspace,
      providerId: s.providerId,
      providerProfiles: s.providerProfiles,
      pushToast: s.pushToast,
      refreshPanels: s.refreshPanels,
      removeContextItem: s.removeContextItem,
      resolveApproval: s.resolveApproval,
      restoreCheckpoint: s.restoreCheckpoint,
      run: s.run,
      selectedContextIds: s.selectedContextIds,
      setActiveDesignArtifact: s.setActiveDesignArtifact,
      setCenterView: s.setCenterView,
      setDesignDraft: s.setDesignDraft,
      setDesignRoute: s.setDesignRoute,
      startDesignRun: s.startDesignRun,
      toggleContextItem: s.toggleContextItem,
      workspace: s.workspace,
    })),
  );
  const [systems, setSystems] = useState<DesignSystem[]>([]);
  const [systemsError, setSystemsError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [askConfirm, confirmLayer] = useConfirm();

  const designs = useMemo(
    () =>
      state.artifacts.filter(
        (artifact) =>
          artifact.kind !== "file" &&
          artifact.path.startsWith("out/design/") &&
          ["html", "deck-html"].includes(artifact.renderer || ""),
      ),
    [state.artifacts],
  );
  const docs = useMemo(() => groupDocs(designs), [designs]);
  const selected = designs.find((item) => item.id === state.activeDesignArtifactId) || null;
  const activeDoc = useMemo(
    () => (selected ? docs.find((doc) => doc.slug === projectSlug(selected)) : docs[0]) || null,
    [docs, selected],
  );
  const activeSystem =
    systems.find((system) => system.id === state.designDraft.designSystemId) || systems[0] || null;
  // The design counterpart is addressed by model name, matching the chat surface.
  const assistantName =
    state.run?.model?.trim() ||
    chatModelLabel(state.model, state.providerId, state.providerProfiles);

  // Draft restore for the design brief: survives reloads per workspace.
  useEffect(() => {
    const saved = loadBrief(state.workspace?.id);
    if (saved && !state.designDraft.brief.trim()) {
      state.setDesignDraft({ brief: saved });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspace?.id]);

  useEffect(() => {
    saveBrief(state.workspace?.id, state.designDraft.brief);
  }, [state.workspace?.id, state.designDraft.brief]);

  useEffect(() => {
    let active = true;
    setSystemsError("");
    void hostApi
      .designSystems(state.workspace?.id)
      .then((items) => active && setSystems(items))
      .catch((error) => active && setSystemsError(String(error)));
    return () => {
      active = false;
    };
  }, [reloadKey, state.workspace?.id]);

  useEffect(() => {
    if (!systems.length) return;
    if (systems.some((system) => system.id === state.designDraft.designSystemId)) return;
    state.setDesignDraft({ designSystemId: systems[0].id });
  }, [state, systems]);

  useEffect(() => {
    if (!state.hostOnline || state.workspace) return;
    void state.ensureDefaultWorkspace();
  }, [state.hostOnline, state.workspace, state.ensureDefaultWorkspace]);

  const refresh = useCallback(async () => {
    setReloadKey((value) => value + 1);
    try {
      await state.refreshPanels();
    } catch (error) {
      state.pushToast({ kind: "error", title: "刷新失败", detail: String(error) });
    }
  }, [state]);
  const exportArtifact = async (artifact: Artifact) => {
    if (!state.workspace) return;
    const destination = await save({
      defaultPath: artifact.name,
      title: `导出设计 · ${artifact.name}`,
    });
    if (!destination) return;
    try {
      await hostApi.exportArtifact(
        state.workspace.id,
        artifact.entryPath || artifact.path,
        destination,
      );
      state.pushToast({ kind: "ok", title: "已导出", detail: artifact.name });
    } catch (error) {
      state.pushToast({ kind: "error", title: "导出失败", detail: String(error) });
    }
  };
  const handleNewDesign = async () => {
    if (state.run && isRunActive(state.run.status)) {
      const ok = await askConfirm({
        title: "新建设计？",
        body: "当前有正在进行的设计任务。新建设计会离开当前画布，运行仍会在后台继续。",
        confirmLabel: "继续新建",
      });
      if (!ok) return;
    }
    state.setActiveDesignArtifact(null);
    state.setDesignRoute("canvas");
  };

  return (
    <div className="design-surface">
      {!state.hostOnline && <DesignConnectionBanner />}
      <header className="design-header" data-tauri-drag-region>
        <div className="design-brand">
          <span className="design-brand-icon">
            <CompassTool size={13} />
          </span>
          <span className="design-brand-copy">
            <strong>设计</strong>
            <small className="mono">out/design</small>
          </span>
        </div>
        <nav className="design-routes" aria-label="设计工作区导航">
          <AuiTabs
            value={state.designRoute}
            onValueChange={(id) => state.setDesignRoute(id)}
            variant="default"
            size="sm"
            aria-label="设计工作区导航"
            items={ROUTES.map(({ id, label, Icon }) => ({
              value: id,
              label,
              icon: <Icon size={13} />,
            }))}
          />
        </nav>
        <div className="design-header-actions" data-tauri-drag-region="false">
          <div className="design-system-pick">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={systemMenuOpen}
              disabled={!systems.length}
              onClick={() => setSystemMenuOpen((value) => !value)}
            >
              <i style={{ background: systemDot(activeSystem) }} />
              {activeSystem?.name || "无设计系统"}
              <CaretDown size={10} />
            </button>
            {systemMenuOpen && (
              <ul role="listbox" aria-label="设计系统">
                {systems.map((system) => (
                  <li key={`${system.scope}:${system.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={system.id === activeSystem?.id}
                      className={system.id === activeSystem?.id ? "active" : ""}
                      onClick={() => {
                        state.setDesignDraft({ designSystemId: system.id });
                        setSystemMenuOpen(false);
                      }}
                    >
                      <i style={{ background: systemDot(system) }} />
                      <span>
                        <strong>{system.name}</strong>
                        <small>
                          {scopeLabel(system.scope)}
                          {system.hasTokens ? " · tokens.css" : ""}
                        </small>
                      </span>
                      {system.id === activeSystem?.id && <Check size={12} weight="bold" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="design-chip"
            disabled={!selected}
            onClick={() => selected && void exportArtifact(selected)}
          >
            <Export size={12} />
            导出
          </button>
          <button
            type="button"
            className="design-chip icon"
            title="刷新设计产物"
            aria-label="刷新设计产物"
            onClick={() => void refresh()}
          >
            <ArrowClockwise size={13} />
          </button>
          {state.designRoute === "canvas" && (
            <button
              type="button"
              className={`design-panel-toggle ${panelOpen ? "active" : ""}`}
              title={panelOpen ? "收起检查面板" : "展开检查面板"}
              aria-pressed={panelOpen}
              onClick={() => setPanelOpen((value) => !value)}
            >
              <SidebarSimple size={14} />
            </button>
          )}
        </div>
      </header>

      <main className={`design-body ${state.designRoute === "canvas" ? "canvas-route" : ""}`}>
        {state.error && (
          <div className="design-inline-error" role="alert">
            {state.error}
          </div>
        )}

        {state.designRoute === "canvas" && (
          <DesignCanvasRoute
            docs={docs}
            activeDoc={activeDoc}
            selected={selected}
            panelOpen={panelOpen}
            workspace={state.workspace}
            runs={state.allRuns}
            run={state.run}
            events={state.events}
            approvals={state.approvals}
            checkpoints={state.checkpoints}
            systems={systems}
            draft={state.designDraft}
            dirty={state.dirty}
            assistantName={assistantName}
            onDraft={state.setDesignDraft}
            onSelectArtifact={(artifact) => void state.openDesignArtifact(artifact.id)}
            onNewDesign={() => void handleNewDesign()}
            onStart={state.startDesignRun}
            onContinue={state.continueDesignRun}
            onResolveApproval={state.resolveApproval}
            onOpenApprovals={() => state.setCenterView("approvals")}
            onOpenSource={(path) => void state.openPath(path)}
            onExport={exportArtifact}
            onRefresh={refresh}
            askConfirm={askConfirm}
          />
        )}
        {state.designRoute === "projects" && (
          <DesignProjects
            designs={designs}
            runs={state.allRuns}
            workspaceId={state.workspace?.id}
            onOpen={(artifact) => void state.openDesignArtifact(artifact.id)}
            onCreate={() => void handleNewDesign()}
            onExport={exportArtifact}
            onReveal={(path) =>
              state.workspace && void hostApi.revealArtifact(state.workspace.id, path)
            }
          />
        )}
        {state.designRoute === "systems" && (
          <DesignSystems
            systems={systems}
            error={systemsError}
            selectedId={state.designDraft.designSystemId}
            workspaceId={state.workspace?.id}
            onSelect={(id) => state.setDesignDraft({ designSystemId: id })}
            onCreated={() => {
              setReloadKey((value) => value + 1);
            }}
            onToast={state.pushToast}
          />
        )}
        {state.designRoute === "assets" && (
          <DesignAssets
            items={state.contextItems}
            selectedIds={state.selectedContextIds}
            workspaceId={state.workspace?.id}
            workspaceReady={!!state.workspace}
            onImport={state.importContextPaths}
            onToggle={state.toggleContextItem}
            onRemove={state.removeContextItem}
            onToast={state.pushToast}
          />
        )}
      </main>
      {state.checkpointPreview && (
        <CheckpointPreviewDialog
          preview={state.checkpointPreview}
          onClose={() => useWorkbench.setState({ checkpointPreview: null })}
          onRestore={(id) => state.restoreCheckpoint(id)}
        />
      )}
      {confirmLayer}
    </div>
  );
}

function DesignCanvasRoute({
  docs,
  activeDoc,
  selected,
  panelOpen,
  workspace,
  runs,
  run,
  events,
  approvals,
  checkpoints,
  systems,
  draft,
  dirty,
  assistantName,
  onDraft,
  onSelectArtifact,
  onNewDesign,
  onStart,
  onContinue,
  onResolveApproval,
  onOpenApprovals,
  onOpenSource,
  onExport,
  onRefresh,
  askConfirm,
}: {
  docs: DesignDoc[];
  activeDoc: DesignDoc | null;
  selected: Artifact | null;
  panelOpen: boolean;
  workspace: { id: string; name: string } | null;
  runs: Run[];
  run: Run | null;
  events: AgentEvent[];
  approvals: Approval[];
  checkpoints: Checkpoint[];
  systems: DesignSystem[];
  draft: { brief: string; designSystemId: string; skillId: string };
  dirty: boolean;
  assistantName: string;
  onDraft: (patch: Record<string, string>) => void;
  onSelectArtifact: (artifact: Artifact) => void;
  onNewDesign: () => void;
  onStart: (input: DesignRunInput) => Promise<void>;
  onContinue: (runId: string, prompt: string) => Promise<void>;
  onResolveApproval: (id: string, decision: string) => Promise<void>;
  onOpenApprovals: () => void;
  onOpenSource: (path: string) => void;
  onExport: (artifact: Artifact) => Promise<void>;
  onRefresh: () => Promise<void>;
  askConfirm: (options: { title: string; body: string; confirmLabel: string }) => Promise<boolean>;
}) {
  const [viewport, setViewport] = useState<ViewportId>("desktop");
  const [zoom, setZoom] = useState(80);
  const [tab, setTab] = useState<"tweaks" | "versions" | "inspect">("tweaks");
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [maximized, setMaximized] = useState<Artifact | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [applyState, setApplyState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [onboarded, setOnboarded] = useState(loadOnboarded);
  const [onboardIndex, setOnboardIndex] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pushToast = useWorkbench((state) => state.pushToast);

  const turns = useMemo(() => (activeDoc ? groupTurns(activeDoc.artifacts) : []), [activeDoc]);
  const currentTurn = turns[0] || null;
  const activeVariant =
    selected && activeDoc?.artifacts.some((item) => item.id === selected.id)
      ? selected
      : currentTurn?.variants[0] || null;
  const activeRun = useMemo(() => {
    const runId = activeVariant?.runId;
    if (!runId) return null;
    if (run?.id === runId) return run;
    return runs.find((item) => item.id === runId) || null;
  }, [activeVariant?.runId, run, runs]);
  const liveRun = run && isRunActive(run.status) ? run : null;

  useEffect(() => setApplyState("idle"), [activeVariant?.id, tweaks]);

  const completeOnboard = () => {
    saveOnboarded();
    setOnboarded(true);
  };
  const focusComposer = () => composerRef.current?.focus();
  const applyTweaks = async () => {
    if (!workspace || !activeVariant) return;
    const path = activeVariant.entryPath || activeVariant.path;
    setApplyState("saving");
    try {
      const file = await hostApi.readFile(workspace.id, path);
      await hostApi.writeFile(workspace.id, path, withTweakBlock(file.content, tweaks));
      setApplyState("done");
      pushToast({ kind: "ok", title: "已写入预览调整", detail: path });
      await onRefresh();
    } catch (error) {
      setApplyState("error");
      pushToast({ kind: "error", title: "应用调整失败", detail: String(error) });
    }
  };

  const cardActions = (artifact: Artifact) => [
    { key: "zoom", title: "放大预览", Icon: ArrowsOut, run: () => setMaximized(artifact) },
    {
      key: "source",
      title: "打开源文件",
      Icon: BracketsCurly,
      run: () => {
        const openSource = () => onOpenSource(artifact.entryPath || artifact.path);
        if (!dirty) {
          openSource();
          return;
        }
        void askConfirm({
          title: "打开源文件？",
          body: "代码编辑器里有未保存内容。打开设计源文件会替换当前编辑内容。",
          confirmLabel: "继续打开",
        }).then((ok) => {
          if (ok) openSource();
        });
      },
    },
    { key: "export", title: "导出这一版", Icon: Copy, run: () => void onExport(artifact) },
    { key: "note", title: "针对这一版继续迭代", Icon: ChatCircleDots, run: focusComposer },
  ];

  const {
    designInspectorWidth,
    designSessionWidth,
    resetDesignInspectorWidth,
    setDesignInspectorWidth,
  } = useWorkbench(
    useShallow((state) => ({
      designInspectorWidth: state.designInspectorWidth,
      designSessionWidth: state.designSessionWidth,
      resetDesignInspectorWidth: state.resetDesignInspectorWidth,
      setDesignInspectorWidth: state.setDesignInspectorWidth,
    })),
  );

  return (
    <section
      className="design-canvas-shell"
      style={
        {
          "--design-session-w": `${designSessionWidth}px`,
          "--design-inspector-w": `${designInspectorWidth}px`,
        } as CSSProperties
      }
    >
      <DesignSessionPanel
        ref={composerRef}
        turns={turns}
        events={events}
        liveRun={liveRun}
        lastRun={activeRun}
        approvals={approvals}
        activeVariant={activeVariant}
        currentTurn={currentTurn}
        systems={systems}
        draft={draft}
        hasProject={!!activeDoc}
        assistantName={assistantName}
        onDraft={onDraft}
        onSelectVariant={onSelectArtifact}
        onNewDesign={onNewDesign}
        onStart={onStart}
        onContinue={onContinue}
        onResolveApproval={onResolveApproval}
        onOpenApprovals={onOpenApprovals}
        onOpenSource={onOpenSource}
      />

      <div className="design-canvas-main">
        <div className="design-doc-tabs">
          {docs.length > 0 && (
            <AuiTabs
              value={activeDoc?.slug || docs[0].slug}
              onValueChange={(slug) => {
                const doc = docs.find((item) => item.slug === slug);
                if (doc?.artifacts[0]) onSelectArtifact(doc.artifacts[0]);
              }}
              variant="ghost"
              size="sm"
              aria-label="设计文档"
              items={docs.map((doc) => ({
                value: doc.slug,
                label: doc.title,
                icon: <FileHtml size={12} />,
              }))}
            />
          )}
          <button type="button" className="design-doc-add" title="新建设计" onClick={onNewDesign}>
            <Plus size={12} />
          </button>
          <div className="design-doc-tools">
            <AuiTabs
              value={viewport}
              onValueChange={setViewport}
              variant="outline"
              size="sm"
              aria-label="预览尺寸"
              items={(Object.keys(VIEWPORTS) as ViewportId[]).map((id) => {
                const { Icon, label, width, height } = VIEWPORTS[id];
                return {
                  value: id,
                  label: <span className="sr-only">{label}</span>,
                  icon: <Icon size={14} />,
                  title: `${label} ${width} × ${height}`,
                };
              })}
            />
            <span className="mono design-doc-size">
              {VIEWPORTS[viewport].width} × {VIEWPORTS[viewport].height}
            </span>
          </div>
        </div>

        <div className="design-canvas-stage">
          {liveRun && !turns.length ? (
            <GenerationLoader
              className="design-gen-loader"
              label="正在生成设计"
              startedAt={liveRun.startedAt || liveRun.createdAt}
            />
          ) : turns.length ? (
            <div className="design-canvas-inner" style={{ transform: `scale(${zoom / 100})` }}>
              {turns.map((turn, position) => (
                <section
                  className={`design-turn ${position === 0 ? "current" : "archived"}`}
                  key={turn.key}
                >
                  <header className="design-turn-head">
                    <span className="mono">
                      TURN {turn.index} · {timeOf(turn.at)}
                    </span>
                    <i />
                    <small>
                      {position === 0
                        ? `${turn.variants.length} 个方案 · ${
                            systems.find((item) => item.id === draft.designSystemId)?.name ||
                            "工作区设计系统"
                          }`
                        : "已归档 · 可回滚"}
                    </small>
                  </header>
                  <div className="design-variant-row">
                    {turn.variants.map((artifact, index) => (
                      <DesignVariant
                        key={artifact.id}
                        artifact={artifact}
                        label={variantLabel(turn.index, index)}
                        active={artifact.id === activeVariant?.id}
                        archived={position !== 0}
                        viewport={viewport}
                        workspaceId={workspace?.id}
                        tweaks={tweaks}
                        onSelect={() => onSelectArtifact(artifact)}
                        onMaximize={() => setMaximized(artifact)}
                      />
                    ))}
                    {position === 0 && activeVariant && (
                      <div className="design-card-actions">
                        {cardActions(activeVariant).map(({ key, title, Icon, run: action }) => (
                          <button key={key} type="button" title={title} onClick={action}>
                            <Icon size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : !onboarded ? (
            <DesignOnboarding
              steps={DESIGN_ONBOARD_STEPS}
              index={onboardIndex}
              onSkip={completeOnboard}
              onNext={() => {
                if (onboardIndex >= DESIGN_ONBOARD_STEPS.length - 1) {
                  completeOnboard();
                  onDraft({ brief: DESIGN_ONBOARD_STEPS[onboardIndex].example });
                  focusComposer();
                  return;
                }
                setOnboardIndex((value) => value + 1);
              }}
            />
          ) : (
            <DesignEmptyColumn
              title="画布还是空的"
              body="在左侧描述你要的界面，Agent 会把源文件写进 out/design/，生成的方案会并排出现在这里。"
              suggestions={DESIGN_EMPTY_PROMPTS}
              onSuggest={(text) => {
                onDraft({ brief: text });
                focusComposer();
              }}
            />
          )}

          <div className="design-zoom-bar" role="group" aria-label="画布缩放">
            <button
              type="button"
              title="缩小"
              aria-label="缩小"
              onClick={() => setZoom((value) => Math.max(50, value - 10))}
            >
              <Minus size={13} />
            </button>
            <button type="button" className="mono zoom-label" onClick={() => setZoom(80)}>
              {zoom}%
            </button>
            <button
              type="button"
              title="放大"
              aria-label="放大"
              onClick={() => setZoom((value) => Math.min(140, value + 10))}
            >
              <Plus size={13} />
            </button>
            <i />
            <button
              type="button"
              title="选择方案"
              aria-label="选择方案"
              onClick={() => currentTurn && onSelectArtifact(currentTurn.variants[0])}
            >
              <Cursor size={13} />
            </button>
            <button
              type="button"
              title="放大当前方案"
              aria-label="放大当前方案"
              disabled={!activeVariant}
              onClick={() => activeVariant && setMaximized(activeVariant)}
            >
              <SelectionPlus size={13} />
            </button>
            <button
              type="button"
              title="对这一版提要求"
              aria-label="对这一版提要求"
              onClick={focusComposer}
            >
              <ChatCircleDots size={13} />
            </button>
          </div>
        </div>
      </div>

      {panelOpen && (
        <aside className="design-inspector-panel" aria-label="设计检查面板">
          <PanelSash
            label="调节检查面板宽度"
            invert
            value={designInspectorWidth}
            onChange={setDesignInspectorWidth}
            onReset={resetDesignInspectorWidth}
          />
          <AuiTabs
            className="aui-tabs-stretch inspector-tabs"
            value={tab}
            onValueChange={setTab}
            variant="default"
            size="sm"
            aria-label="检查面板"
            items={
              [
                { value: "tweaks" as const, label: "调整" },
                {
                  value: "versions" as const,
                  label: `版本${checkpoints.length ? ` ${checkpoints.length}` : ""}`,
                },
                { value: "inspect" as const, label: "检查" },
              ] as const
            }
          />

          {tab === "tweaks" && (
            <div className="inspector-content tweaks">
              <div className="tweak-selection">
                <span className="mono badge">
                  {activeVariant && currentTurn
                    ? variantLabel(
                        turnIndexOf(turns, activeVariant),
                        variantIndexOf(turns, activeVariant),
                      )
                    : "—"}
                </span>
                <strong>{activeVariant?.name || "未选择方案"}</strong>
                <small className="mono">tokens.css</small>
              </div>

              <div className="tweak-group">
                <span className="mono tweak-legend">BRAND</span>
                <div className="tweak-field">
                  <span>主色</span>
                  <div className="tweak-swatches">
                    {ACCENTS.map((color, index) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`主色 ${color}`}
                        aria-pressed={tweaks.accent === index}
                        className={tweaks.accent === index ? "active" : ""}
                        style={{
                          background: color,
                          borderRadius: `${Math.max(4, tweaks.radius - 4)}px`,
                          ...(tweaks.accent === index
                            ? { boxShadow: `0 0 0 2px var(--panel-alt), 0 0 0 3.5px ${color}` }
                            : {}),
                        }}
                        onClick={() => setTweaks((value) => ({ ...value, accent: index }))}
                      />
                    ))}
                    <span className="mono tweak-value">{ACCENTS[tweaks.accent].toUpperCase()}</span>
                  </div>
                </div>
                <div className="tweak-field">
                  <div className="tweak-row-head">
                    <span>圆角</span>
                    <span className="mono tweak-value">{tweaks.radius}px</span>
                  </div>
                  <div className="tweak-stepper">
                    <button
                      type="button"
                      aria-label="减小圆角"
                      onClick={() =>
                        setTweaks((value) => ({ ...value, radius: Math.max(0, value.radius - 2) }))
                      }
                    >
                      <Minus size={11} />
                    </button>
                    <span className="tweak-track">
                      <i style={{ width: `${(tweaks.radius / 20) * 100}%` }} />
                    </span>
                    <button
                      type="button"
                      aria-label="增大圆角"
                      onClick={() =>
                        setTweaks((value) => ({ ...value, radius: Math.min(20, value.radius + 2) }))
                      }
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
                <div className="tweak-field">
                  <span>密度</span>
                  <div className="seg" role="group" aria-label="密度">
                    {DENSITIES.map((item, index) => (
                      <button
                        key={item.label}
                        type="button"
                        aria-pressed={tweaks.density === index}
                        className={tweaks.density === index ? "active" : ""}
                        onClick={() => setTweaks((value) => ({ ...value, density: index }))}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="tweak-group">
                <span className="mono tweak-legend">PREVIEW</span>
                {(
                  [
                    ["dark", "深色模式"],
                    ["grid", "8px 栅格参考线"],
                    ["hotspots", "高亮可交互元素"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="tweak-toggle"
                    aria-pressed={tweaks[key]}
                    onClick={() => setTweaks((value) => ({ ...value, [key]: !value[key] }))}
                  >
                    <span>{label}</span>
                    <i className={tweaks[key] ? "on" : ""}>
                      <em />
                    </i>
                  </button>
                ))}
                <div className="tweak-field row">
                  <span>字号基准</span>
                  <select
                    value={String(tweaks.fontScale)}
                    onChange={(event) =>
                      setTweaks((value) => ({ ...value, fontScale: Number(event.target.value) }))
                    }
                  >
                    {FONT_SCALES.map((item) => (
                      <option key={item.label} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="tweak-apply">
                <span className="mono">
                  预览为实时覆盖
                  <br />
                  应用会写回源文件
                </span>
                <button
                  type="button"
                  disabled={!activeVariant || applyState === "saving"}
                  onClick={() => void applyTweaks()}
                >
                  {applyState === "saving"
                    ? "写入中"
                    : applyState === "done"
                      ? "已应用"
                      : applyState === "error"
                        ? "重试"
                        : "应用"}
                </button>
              </div>
              {applyState === "error" && (
                <p className="inspector-note error">写回源文件失败，请检查工作区权限后重试。</p>
              )}
            </div>
          )}

          {tab === "versions" && (
            <div className="inspector-content versions">
              {checkpoints.length ? (
                checkpoints.map((checkpoint, index) => (
                  <DesignCheckpointCard
                    key={checkpoint.id}
                    checkpoint={checkpoint}
                    current={index === 0}
                    onPreview={() => void useWorkbench.getState().previewCheckpoint(checkpoint.id)}
                  />
                ))
              ) : (
                <DesignEmptyColumn
                  title="暂无版本检查点"
                  body="Agent 写入前创建的检查点会显示在这里。"
                />
              )}
            </div>
          )}

          {tab === "inspect" && (
            <div className="inspector-content inspect">
              <DesignSpecSheet
                title={activeVariant?.name || "未选择方案"}
                subtitle={activeVariant?.kind || "artifact"}
                rows={[
                  { label: "renderer", value: rendererLabel(activeVariant), emphasis: true },
                  {
                    label: "entry",
                    value: activeVariant?.entryPath || activeVariant?.path || "—",
                  },
                  { label: "status", value: activeVariant?.status || "—" },
                  { label: "run", value: activeRun?.id || activeVariant?.runId || "—" },
                  { label: "viewport", value: viewportSize(viewport) },
                  { label: "accent", value: ACCENTS[tweaks.accent].toUpperCase() },
                  { label: "radius", value: `${tweaks.radius}px` },
                  { label: "network", value: "blocked (CSP default-src none)" },
                ]}
              />
              {activeRun?.tokenUsage?.total ? (
                <div className="design-cost-meter" data-slot="cost-meter">
                  <span className="mono">tokens</span>
                  <span className="design-job-track">
                    <i
                      style={{
                        width: `${Math.min(
                          100,
                          ((activeRun.tokenUsage.input || 0) / activeRun.tokenUsage.total) * 100,
                        )}%`,
                      }}
                    />
                  </span>
                  <em className="mono">
                    {tokensLite(activeRun.tokenUsage.input || 0)} in ·{" "}
                    {tokensLite(activeRun.tokenUsage.output || 0)} out
                  </em>
                </div>
              ) : null}
              <DesignPathTree
                paths={(activeDoc?.artifacts || []).map((item) => item.entryPath || item.path)}
                active={activeVariant?.entryPath || activeVariant?.path}
                onOpen={onOpenSource}
              />
              <p className="inspector-note">
                预览在隔离 iframe 里渲染，CSP 默认断网，不暴露任何 Tauri 能力。
              </p>
              {activeRun?.status === "waiting_approval" && (
                <button type="button" className="inspector-approval-link" onClick={onOpenApprovals}>
                  打开审批中心
                </button>
              )}
            </div>
          )}
        </aside>
      )}

      {maximized && (
        <div
          className="design-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${maximized.name} 放大预览`}
        >
          <header>
            <button
              type="button"
              className="ghost"
              title="重新加载预览"
              aria-label="重新加载预览"
              onClick={() => setPreviewNonce((value) => value + 1)}
            >
              <ArrowClockwise size={13} />
            </button>
            <strong>{maximized.name}</strong>
            <span className="mono">{maximized.entryPath || maximized.path}</span>
            <button type="button" onClick={() => setMaximized(null)}>
              关闭
            </button>
          </header>
          <DesignPreviewFrame
            artifact={maximized}
            workspaceId={workspace?.id}
            tweaks={tweaks}
            width={VIEWPORTS[viewport].width}
            height={VIEWPORTS[viewport].height}
            scale={1}
            fill
            reloadToken={previewNonce}
          />
        </div>
      )}
    </section>
  );
}

/** Left rail: the design conversation plus the composer that starts or iterates a run. */
function DesignSessionPanel({
  ref,
  turns,
  events,
  liveRun,
  lastRun,
  approvals,
  activeVariant,
  currentTurn,
  systems,
  draft,
  hasProject,
  assistantName,
  onDraft,
  onSelectVariant,
  onNewDesign,
  onStart,
  onContinue,
  onResolveApproval,
  onOpenApprovals,
  onOpenSource,
}: {
  ref: React.Ref<HTMLTextAreaElement>;
  turns: DesignTurn[];
  events: AgentEvent[];
  liveRun: Run | null;
  lastRun: Run | null;
  approvals: Approval[];
  activeVariant: Artifact | null;
  currentTurn: DesignTurn | null;
  systems: DesignSystem[];
  draft: { brief: string; designSystemId: string; skillId: string };
  hasProject: boolean;
  assistantName: string;
  onDraft: (patch: Record<string, string>) => void;
  onSelectVariant: (artifact: Artifact) => void;
  onNewDesign: () => void;
  onStart: (input: DesignRunInput) => Promise<void>;
  onContinue: (runId: string, prompt: string) => Promise<void>;
  onResolveApproval: (id: string, decision: string) => Promise<void>;
  onOpenApprovals: () => void;
  onOpenSource: (path: string) => void;
}) {
  const [variantCount, setVariantCount] = useState(2);
  const [formatId, setFormatId] = useState(FORMATS[0].id);
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [acceptedVariantId, setAcceptedVariantId] = useState<string | null>(null);
  const format = FORMATS.find((item) => item.id === formatId) || FORMATS[0];
  const messages = useMemo(() => conversation(events), [events]);
  const plan = useMemo(() => latestPlan(events), [events]);
  const tools = useMemo(() => latestTools(events), [events]);
  const edits = useMemo(() => latestEdits(events), [events]);
  const failure = useMemo(() => latestError(events, lastRun), [events, lastRun]);
  const runId = activeVariant?.runId || liveRun?.id;
  const iterating = !!runId && hasProject;
  useEffect(() => setAcceptedVariantId(null), [currentTurn?.key]);
  const system = systems.find((item) => item.id === draft.designSystemId);
  const retryRun = useWorkbench((state) => state.retryRun);
  const cancelRun = useWorkbench((state) => state.cancelRun);
  const hostOnline = useWorkbench((state) => state.hostOnline);
  const importContextPaths = useWorkbench((state) => state.importContextPaths);
  const contextItems = useWorkbench((state) => state.contextItems);
  const elapsed = useElapsedLabel(liveRun?.startedAt || liveRun?.createdAt);
  const job = liveRun ? jobStageOf(liveRun, plan) : null;
  const showTyping =
    !!liveRun &&
    ["queued", "starting", "running"].includes(liveRun.status) &&
    !messages.some((message) => message.streaming);
  const recentPrompts = loadPromptHistory().slice(0, 5);
  const slashQuery = /^\/([^\s/]*)$/.exec(draft.brief)?.[1]?.toLowerCase() ?? null;
  const mentionQuery = /(^|[\s])@([^\s@]*)$/.exec(draft.brief)?.[2]?.toLowerCase() ?? null;
  const slashOptions = useMemo(() => {
    if (slashQuery == null) return [];
    const prompts = DESIGN_FOLLOWUPS.filter((text) => text.toLowerCase().includes(slashQuery)).map(
      (text) => ({
        key: `p:${text}`,
        label: text,
        hint: "提示词",
        apply: () => onDraft({ brief: text }),
      }),
    );
    const apps = [
      { key: "new", label: "新建设计", hint: "会话", apply: onNewDesign },
      { key: "approvals", label: "打开审批中心", hint: "视图", apply: onOpenApprovals },
      {
        key: "html",
        label: "HTML 页面",
        hint: "格式",
        apply: () => {
          setFormatId("html");
          onDraft({ brief: "" });
        },
      },
      {
        key: "deck",
        label: "Deck 演示",
        hint: "格式",
        apply: () => {
          setFormatId("deck");
          onDraft({ brief: "" });
        },
      },
    ].filter((item) => item.label.toLowerCase().includes(slashQuery));
    return [...prompts, ...apps].slice(0, 8);
  }, [onDraft, onNewDesign, onOpenApprovals, slashQuery]);
  const mentionOptions = useMemo(() => {
    if (mentionQuery == null) return [];
    return systems.filter((item) => item.name.toLowerCase().includes(mentionQuery)).slice(0, 6);
  }, [mentionQuery, systems]);

  const focusInput = () => (ref as React.RefObject<HTMLTextAreaElement | null>)?.current?.focus();
  const applySlash = (option: (typeof slashOptions)[number]) => {
    option.apply();
    setSlashIndex(0);
    focusInput();
  };
  const applyMention = (item: (typeof mentionOptions)[number]) => {
    onDraft({
      brief: draft.brief.replace(/(^|[\s])@([^\s@]*)$/, `$1@${item.name} `),
      designSystemId: item.id,
    });
    focusInput();
  };
  const importFiles = async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      title: "导入设计上下文",
      filters: [{ name: "设计素材", extensions: ["css", "svg", "png", "jpg", "md", "txt"] }],
    });
    const paths = typeof selected === "string" ? [selected] : selected || [];
    if (paths.length) {
      try {
        await importContextPaths(paths);
        useWorkbench.getState().pushToast({
          kind: "ok",
          title: `已导入 ${paths.length} 个素材`,
        });
      } catch (error) {
        useWorkbench.getState().pushToast({
          kind: "error",
          title: "导入失败",
          detail: String(error),
        });
      }
    }
    setPlusOpen(false);
  };

  const submit = async () => {
    const text = draft.brief.trim();
    if (!text || sending || slashQuery != null) return;
    setSending(true);
    pushPromptHistory(text);
    try {
      if (iterating && runId) {
        await onContinue(runId, text);
        onDraft({ brief: "" });
      } else {
        await onStart({
          title: titleFromBrief(text),
          brief: text,
          templateLabel: format.templateLabel,
          artifactKind: format.artifactKind,
          renderer: format.renderer,
          designSystemId: draft.designSystemId,
          skillId: draft.skillId || undefined,
          variantCount,
        });
      }
    } finally {
      setSending(false);
    }
  };

  const statusLabel =
    liveRun?.status === "waiting_approval"
      ? "等待审批"
      : liveRun?.status === "queued"
        ? "排队中"
        : liveRun
          ? "正在生成"
          : "";

  return (
    <aside className="design-session-panel" data-slot="chat-panel" aria-label="设计会话">
      <div className="design-chat-head">
        <span>会话</span>
        {liveRun ? (
          <DesignStatusPill
            state={liveRun.status === "waiting_approval" ? "waiting" : "working"}
            label={statusLabel}
            elapsed={elapsed}
            onPause={() => void cancelRun()}
          />
        ) : (
          <span className="design-chat-turns">{turns.length ? `${turns.length} 轮` : "新会话"}</span>
        )}
        <button
          type="button"
          title="打开审批中心"
          aria-label="打开审批中心"
          onClick={onOpenApprovals}
        >
          <ClockCounterClockwise size={13} />
        </button>
        <button type="button" title="新建设计" aria-label="新建设计" onClick={onNewDesign}>
          <Plus size={13} />
        </button>
      </div>

      <DesignSessionViewport pinKey={events.length} messageCount={messages.length}>
        {!messages.length && !currentTurn && (
          <DesignEmptyColumn
            title="描述你想要的界面"
            body="说明目标用户、页面结构和关键内容。Agent 会按工作区的设计系统生成可预览的源文件。"
            suggestions={DESIGN_EMPTY_PROMPTS}
            onSuggest={(text) => {
              onDraft({ brief: text });
              focusInput();
            }}
          />
        )}

        {messages.map((message, index) => {
          const prev = messages[index - 1];
          const day = dayLabel(message.at);
          const showDay = day && day !== dayLabel(prev?.at);
          return (
            <Fragment key={message.key}>
              {showDay && <div className="design-day-sep">{day}</div>}
              {message.role === "user" ? (
                <div className="design-chat-user" data-slot="chat-panel-user-message">
                  <p>{message.text}</p>
                  <span className="design-msg-meta">
                    {message.at && <em className="mono">{timeOf(message.at)}</em>}
                    <button
                      type="button"
                      className="design-copy-btn"
                      title="编辑这条消息"
                      aria-label="编辑这条消息"
                      onClick={() => {
                        onDraft({ brief: message.text });
                        focusInput();
                      }}
                    >
                      <PencilSimple size={11} />
                    </button>
                  </span>
                </div>
              ) : (
                <div className="design-chat-assistant" data-slot="chat-panel-assistant-message">
                  <span className="design-speaker">
                    <span className="speaker-name">{assistantName || "Assistant"}</span>
                    {message.at && <em className="mono">{timeOf(message.at)}</em>}
                    <CopyBubbleAction
                      text={message.text}
                      onRetry={
                        message.last && lastRun
                          ? () => {
                              setRetrying(true);
                              void retryRun(lastRun.id).finally(() => setRetrying(false));
                            }
                          : undefined
                      }
                      retrying={retrying}
                    />
                  </span>
                  <StreamText text={message.text} streaming={message.streaming} />
                    {message.last && currentTurn && currentTurn.variants.length > 3 && (
                      <div className="design-option-list">
                        {currentTurn.variants.map((artifact, variantIndex) => (
                          <button
                            key={artifact.id}
                            type="button"
                            className={artifact.id === activeVariant?.id ? "active" : ""}
                            onClick={() => onSelectVariant(artifact)}
                          >
                            <span className="mono badge">
                              {variantLabel(currentTurn.index, variantIndex)}
                            </span>
                            <span>
                              <strong>{artifact.name}</strong>
                              <small>{artifact.entryPath || artifact.path}</small>
                            </span>
                            {artifact.id === activeVariant?.id && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                    )}
                    {message.last &&
                      currentTurn &&
                      currentTurn.variants.length > 1 &&
                      currentTurn.variants.length <= 3 && (
                        <DesignComparison
                          options={currentTurn.variants.map((artifact) => ({
                            id: artifact.id,
                            name: variantLabel(
                              currentTurn.index,
                              currentTurn.variants.indexOf(artifact),
                            ),
                            headline: artifact.name,
                            traits: [
                              artifact.kind,
                              artifact.status,
                              artifact.entryPath || artifact.path,
                            ],
                          }))}
                          recommendedId={activeVariant?.id || currentTurn.variants[0].id}
                          reason="当前选中的方案会进入检查面板，后续迭代也基于这一版。"
                          onPick={(id) => {
                            const next = currentTurn.variants.find((item) => item.id === id);
                            if (next) onSelectVariant(next);
                          }}
                        />
                      )}
                    {message.last &&
                      activeVariant &&
                      currentTurn &&
                      currentTurn.variants.length > 1 && (
                        <DesignRecommendation
                          question="采用这一版继续迭代？"
                          body={
                            <>
                              {activeVariant.name}
                              <span className="mono">
                                {" "}
                                · {activeVariant.entryPath || activeVariant.path}
                              </span>
                            </>
                          }
                          accepted={acceptedVariantId === activeVariant.id}
                          onAccept={() => {
                            setAcceptedVariantId(activeVariant.id);
                            focusInput();
                          }}
                          onAlternatives={() => {
                            const index = currentTurn.variants.findIndex(
                              (item) => item.id === activeVariant.id,
                            );
                            const next =
                              currentTurn.variants[(index + 1) % currentTurn.variants.length];
                            onSelectVariant(next);
                          }}
                        />
                      )}
                </div>
              )}
            </Fragment>
          );
        })}

        {showTyping && <DesignTypingBubble />}
        {liveRun?.status === "queued" && <DesignQueuedNote />}
        <DesignToolTimeline items={tools} />
        <DesignEditsList items={edits} onOpen={onOpenSource} />

        {!liveRun && lastRun?.status === "completed" && runTimingLabel(lastRun) && (
          <p className="design-timing">{runTimingLabel(lastRun)}</p>
        )}

        {!liveRun && lastRun?.status === "cancelled" && (
          <div className="design-stopped-note" role="status">
            <span className="run-dot cancelled" aria-hidden="true" />
            <span>运行已停止。在下方描述要继续的方向即可接着这一版迭代。</span>
            <button type="button" className="card-link" onClick={focusInput}>
              继续
            </button>
          </div>
        )}

        {!liveRun && failure && (
          <DesignErrorBanner
            title="设计生成失败"
            detail={failure.message}
            retrying={retrying}
            onRetry={
              failure.retriable && lastRun
                ? () => {
                    setRetrying(true);
                    void retryRun(lastRun.id).finally(() => setRetrying(false));
                  }
                : undefined
            }
          />
        )}

        {liveRun && (
          <div className="design-editing-card">
            <DesignJobProgress
              title={
                liveRun.status === "waiting_approval"
                  ? "等待审批后继续"
                  : activeVariant && currentTurn
                    ? `编辑 ${variantLabel(currentTurn.index, currentTurn.variants.indexOf(activeVariant))}`
                    : "正在生成设计"
              }
              stages={JOB_STAGES}
              stageIndex={job?.index ?? 1}
              stageProgress={job?.progress ?? 0.3}
              eta={elapsed || liveRun.planProgress || "—"}
              onCancel={() => void cancelRun()}
            />
            {!!plan.length && <DesignAgentPlan steps={plan} />}
            {!plan.length && (
              <ThinkingIndicator
                className="design-think"
                label={liveRun.status === "waiting_approval" ? "等待审批" : "正在编辑"}
                startedAt={liveRun.startedAt || liveRun.createdAt}
              />
            )}
          </div>
        )}

        {approvals.map((approval) => (
          <DesignApprovalCard
            key={approval.approvalId}
            approval={approval}
            onDeny={() => void onResolveApproval(approval.approvalId, "deny")}
            onAlwaysAllow={() => void onResolveApproval(approval.approvalId, "always_allow")}
            onAllowOnce={() => void onResolveApproval(approval.approvalId, "approve_once")}
          />
        ))}
      </DesignSessionViewport>

      {!liveRun && hasProject && currentTurn && !draft.brief.trim() && (
        <div className="design-followups">
          {DESIGN_FOLLOWUPS.map((text, index) => (
            <button
              key={text}
              type="button"
              style={{ "--i": index } as CSSProperties}
              onClick={() => {
                onDraft({ brief: text });
                focusInput();
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}

      <form
        className="design-iterate-composer"
        data-slot="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {slashOptions.length > 0 && (
          <ul className="design-composer-menu" data-slot="composer-menu" role="listbox">
            {slashOptions.map((option, index) => (
              <li key={option.key}>
                <button
                  type="button"
                  className={index === slashIndex ? "active" : ""}
                  onClick={() => applySlash(option)}
                >
                  <span>{option.label}</span>
                  <small>{option.hint}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {mentionOptions.length > 0 && (
          <ul className="design-composer-menu" data-slot="composer-menu" role="listbox">
            {mentionOptions.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={index === 0 ? "active" : ""}
                  onClick={() => applyMention(item)}
                >
                  <At size={12} />
                  <span>{item.name}</span>
                  <small>{scopeLabel(item.scope)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {(system || activeVariant || contextItems.length > 0) && (
          <div className="design-composer-attachments" data-slot="composer-attachments">
            {system?.hasTokens && <span className="accent">tokens.css</span>}
            {system && <span>{system.name}</span>}
            {activeVariant && <span>{activeVariant.name}</span>}
            {contextItems.slice(0, 3).map((item) => (
              <span key={item.id}>{item.displayName}</span>
            ))}
          </div>
        )}
        <div className="design-chat-composer" data-slot="chat-panel-composer">
          <div className="design-plus-wrap">
            <button
              type="button"
              className="design-chat-attach"
              data-slot="composer-attach"
              title="添加"
              aria-label="添加"
              aria-expanded={plusOpen}
              onClick={() => setPlusOpen((value) => !value)}
            >
              <Plus size={16} />
            </button>
            {plusOpen && (
              <ul className="design-composer-menu plus" role="menu">
                <li>
                  <button type="button" onClick={onNewDesign}>
                    新建设计
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => void importFiles()}>
                    <Paperclip size={12} />
                    导入素材
                  </button>
                </li>
                {!iterating && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setVariantCount((value) => (value % 3) + 1)}
                    >
                      方案 ×{variantCount}
                    </button>
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      const index = FORMATS.findIndex((item) => item.id === formatId);
                      setFormatId(FORMATS[(index + 1) % FORMATS.length].id);
                    }}
                  >
                    格式 · {format.label}
                  </button>
                </li>
                {recentPrompts.map((text) => (
                  <li key={text}>
                    <button
                      type="button"
                      onClick={() => {
                        onDraft({ brief: text });
                        setPlusOpen(false);
                        focusInput();
                      }}
                    >
                      {text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <textarea
            ref={ref}
            data-slot="composer-input"
            value={draft.brief}
            onChange={(event) => {
              onDraft({ brief: event.target.value });
              setSlashIndex(0);
              const el = event.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
            onKeyDown={(event) => {
              if (slashOptions.length) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSlashIndex((value) => (value + 1) % slashOptions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSlashIndex((value) => (value - 1 + slashOptions.length) % slashOptions.length);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  applySlash(slashOptions[slashIndex] || slashOptions[0]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onDraft({ brief: "" });
                  return;
                }
              }
              if (mentionOptions.length) {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  applyMention(mentionOptions[0]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onDraft({ brief: draft.brief.replace(/(^|[\s])@([^\s@]*)$/, "$1") });
                  return;
                }
              }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
                return;
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !event.altKey
              ) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={iterating ? "说明要改的地方…" : "描述你要的界面…"}
            rows={1}
          />
          {liveRun ? (
            <button
              type="button"
              className="design-chat-send is-streaming"
              data-slot="composer-send"
              title="停止"
              aria-label="停止"
              onClick={() => void cancelRun()}
            >
              <span className="stop-sq" />
            </button>
          ) : (
            <button
              type="submit"
              className={`design-chat-send${draft.brief.trim() ? " is-ready" : ""}`}
              data-slot="composer-send"
              disabled={!draft.brief.trim() || sending || !hostOnline}
              title={iterating ? "继续迭代 (Enter)" : "开始设计 (Enter)"}
              aria-label={iterating ? "继续迭代" : "开始设计"}
            >
              <ArrowUp size={14} weight="bold" />
            </button>
          )}
        </div>
      </form>
      <PanelSash
        label="调节设计会话栏宽度"
        value={useWorkbench.getState().designSessionWidth}
        onChange={useWorkbench.getState().setDesignSessionWidth}
        onReset={useWorkbench.getState().resetDesignSessionWidth}
      />
    </aside>
  );
}

/** Hover-revealed copy / retry (assistant-ui message-actions). */
function CopyBubbleAction({
  text,
  onRetry,
  retrying,
}: {
  text: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="design-msg-actions">
      <button
        type="button"
        className={`design-copy-btn${copied ? " done" : ""}`}
        title={copied ? "已复制" : "复制"}
        aria-label={copied ? "已复制" : "复制"}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? <Check size={11} weight="bold" /> : <Copy size={11} />}
      </button>
      {onRetry && (
        <button
          type="button"
          className="design-copy-btn"
          title="重试"
          aria-label="重试"
          disabled={retrying}
          onClick={onRetry}
        >
          <ArrowClockwise size={11} className={retrying ? "spin" : ""} />
        </button>
      )}
    </span>
  );
}

/** assistant-ui streaming-text: newest words tint, then settle. */
function StreamText({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!streaming) return <p>{text}</p>;
  const parts = text.split(/(\s+)/);
  return (
    <p className="design-stream">
      {parts.map((part, index) => (
        <span
          key={`${index}-${part}`}
          className={index >= parts.length - 3 && part.trim() ? "fresh" : ""}
        >
          {part}
        </span>
      ))}
      <span className="design-caret" aria-hidden="true" />
    </p>
  );
}

function DesignVariant({
  artifact,
  label,
  active,
  archived,
  viewport,
  workspaceId,
  tweaks,
  onSelect,
  onMaximize,
}: {
  artifact: Artifact;
  label: string;
  active: boolean;
  archived: boolean;
  viewport: ViewportId;
  workspaceId?: string;
  tweaks: Tweaks;
  onSelect: () => void;
  onMaximize: () => void;
}) {
  const { width, height } = VIEWPORTS[viewport];
  const frameWidth = archived ? 230 : Math.min(400, width);
  const scale = frameWidth / width;
  const bodyHeight = archived ? 122 : 360;
  const [reloadToken, setReloadToken] = useState(0);
  const origin = artifact.entryPath || artifact.path;
  return (
    <div className={`design-variant ${archived ? "archived" : ""}`}>
      <button
        type="button"
        className={`design-variant-badge ${active ? "active" : ""}`}
        onClick={onSelect}
      >
        <span className="mono badge">{label}</span>
        {artifact.name}
        <span className="mono size">
          {width} × {height}
        </span>
      </button>
      <div
        className={`design-variant-frame ${active ? "active" : ""}`}
        style={{ width: frameWidth }}
      >
        <span className="design-variant-chrome">
          <i className="r" />
          <i className="y" />
          <i className="g" />
          <span className="mono">{origin}</span>
          <button
            type="button"
            title="重新加载预览"
            aria-label="重新加载预览"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            <ArrowClockwise size={11} />
          </button>
          <button type="button" title="放大预览" aria-label="放大预览" onClick={onMaximize}>
            <ArrowSquareOut size={11} />
          </button>
        </span>
        <button type="button" className="design-preview-hit" onClick={onSelect}>
          <DesignPreviewFrame
            artifact={artifact}
            workspaceId={workspaceId}
            tweaks={tweaks}
            width={width}
            height={Math.round(bodyHeight / scale)}
            scale={scale}
            reloadToken={reloadToken}
          />
        </button>
      </div>
    </div>
  );
}

/** Sandboxed artifact preview; tweak overrides are injected into the document head. */
function DesignPreviewFrame({
  artifact,
  workspaceId,
  tweaks,
  width,
  height,
  scale,
  fill,
  reloadToken = 0,
}: {
  artifact: Artifact;
  workspaceId?: string;
  tweaks: Tweaks;
  width: number;
  height: number;
  scale: number;
  fill?: boolean;
  reloadToken?: number;
}) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const path = artifact.entryPath || artifact.path;
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setHtml("");
    setError("");
    setLoading(true);
    void hostApi
      .artifactPreview(workspaceId, path)
      .then((result) => {
        if (!active) return;
        setHtml(result.html);
        setLoading(false);
      })
      .catch((reason) => {
        if (!active) return;
        setError(String(reason));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, workspaceId, reloadToken]);

  const document = useMemo(() => (html ? securePreviewDocument(html, tweaks) : ""), [html, tweaks]);

  return (
    <span className={`design-preview-body ${fill ? "fill" : ""}`}>
      {error ? (
        <span className="design-preview-error">预览失败 · {error}</span>
      ) : loading || !document ? (
        <span className="design-preview-loading think-label">正在加载安全预览</span>
      ) : (
        <iframe
          title={`${artifact.name} 预览`}
          srcDoc={document}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={
            fill
              ? undefined
              : { width, height, transform: `scale(${scale})`, transformOrigin: "top left" }
          }
        />
      )}
    </span>
  );
}

function DesignProjects({
  designs,
  runs,
  workspaceId,
  onOpen,
  onCreate,
  onExport,
  onReveal,
}: {
  designs: Artifact[];
  runs: Run[];
  workspaceId?: string;
  onOpen: (artifact: Artifact) => void;
  onCreate: () => void;
  onExport: (artifact: Artifact) => Promise<void>;
  onReveal: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "live">("all");
  const projects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groupDocs(designs).filter((doc) => {
      const cover = doc.artifacts[0];
      const run = runs.find((item) => item.id === cover?.runId);
      const live = !!(run && isRunActive(run.status));
      if (filter === "live" && !live) return false;
      if (filter === "ready" && live) return false;
      if (!needle) return true;
      return `${doc.title} ${doc.slug} ${cover?.path || ""}`.toLowerCase().includes(needle);
    });
  }, [designs, filter, query, runs]);
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small className="mono">DESIGN PROJECTS</small>
          <h2>项目</h2>
          <p>每个项目都由 manifest 管理，并保留可继续编辑的 HTML 源文件。</p>
        </span>
        <div className="design-page-toolbar">
          <label className="g-search">
            <MagnifyingGlass size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目"
            />
          </label>
          <AuiTabs
            value={filter}
            onValueChange={setFilter}
            variant="pills"
            size="sm"
            aria-label="项目状态"
            items={[
              { value: "all" as const, label: "全部" },
              { value: "ready" as const, label: "已完成" },
              { value: "live" as const, label: "生成中" },
            ]}
          />
          <button type="button" className="primary" onClick={onCreate}>
            <Sparkle size={13} />
            新建设计
          </button>
        </div>
      </div>
      {projects.length ? (
        <div className="design-project-grid">
          {projects.map((doc) => {
            const artifact = doc.artifacts[0];
            const run = runs.find((item) => item.id === artifact.runId);
            return (
              <DesignProjectCard
                key={doc.slug}
                artifact={artifact}
                title={doc.title}
                run={run}
                workspaceId={workspaceId}
                onOpen={onOpen}
                onExport={onExport}
                onReveal={onReveal}
              />
            );
          })}
        </div>
      ) : (
        <DesignEmptyColumn
          title={designs.length ? "没有匹配的项目" : "还没有设计项目"}
          body={
            designs.length
              ? "换个名称或状态再试一次。"
              : "从一段 brief 开始，首个产物会生成在 out/design 目录。"
          }
          action={designs.length ? undefined : { label: "创建第一个设计", onClick: onCreate }}
        />
      )}
    </section>
  );
}

function DesignProjectCard({
  artifact,
  title,
  run,
  workspaceId,
  onOpen,
  onExport,
  onReveal,
}: {
  artifact: Artifact;
  title: string;
  run?: Run;
  workspaceId?: string;
  onOpen: (artifact: Artifact) => void;
  onExport: (artifact: Artifact) => Promise<void>;
  onReveal: (path: string) => void;
}) {
  const generating = !!(run && isRunActive(run.status));
  const htmlCover =
    artifact.kind !== "deck" && /\.html?$/i.test(artifact.entryPath || artifact.path);
  return (
    <article className="design-project-card">
      <button type="button" className="design-project-cover" onClick={() => onOpen(artifact)}>
        {htmlCover && workspaceId ? (
          <span className="design-project-thumb">
            <DesignPreviewFrame
              artifact={artifact}
              workspaceId={workspaceId}
              tweaks={DEFAULT_TWEAKS}
              width={1280}
              height={800}
              scale={0.18}
            />
          </span>
        ) : artifact.kind === "deck" ? (
          <PresentationChart size={28} weight="duotone" />
        ) : (
          <BracketsCurly size={28} weight="duotone" />
        )}
        <em className="mono">{artifact.renderer || artifact.ext}</em>
      </button>
      <DesignArtifactCard
        title={title}
        meta={`${artifact.kind} · ${generating ? "生成中" : artifact.status} · ${formatDate(artifact.createdAt)}`}
        generating={generating}
        onClick={() => onOpen(artifact)}
      />
      <div className="design-project-actions">
        <button type="button" onClick={() => void onExport(artifact)}>
          导出
        </button>
        <button type="button" onClick={() => onReveal(artifact.entryPath || artifact.path)}>
          显示文件
        </button>
      </div>
    </article>
  );
}

function DesignSystems({
  systems,
  error,
  selectedId,
  workspaceId,
  onSelect,
  onCreated,
  onToast,
}: {
  systems: DesignSystem[];
  error: string;
  selectedId: string;
  workspaceId?: string;
  onSelect: (id: string) => void;
  onCreated: () => void;
  onToast: (toast: Omit<Toast, "id">) => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [content, setContent] = useState<DesignSystemContent | null>(null);
  const selected = systems.find((item) => item.id === selectedId) || systems[0] || null;

  useEffect(() => {
    if (!selected) {
      setContent(null);
      return;
    }
    let active = true;
    void hostApi
      .readDesignSystem(selected.id, workspaceId)
      .then((item) => active && setContent(item))
      .catch(() => active && setContent(null));
    return () => {
      active = false;
    };
  }, [selected, workspaceId]);

  const createSystem = async () => {
    if (!workspaceId || !name.trim()) return;
    const slug = slugify(name);
    setCreating(true);
    try {
      await hostApi.writeFile(
        workspaceId,
        `.herdock/design-systems/${slug}/DESIGN.md`,
        `# ${name.trim()}\n\n> Category: Workspace\n\n${name.trim()} 的可移植品牌合同。保持克制的色彩、清晰的层级和可访问的对比度。\n`,
      );
      await hostApi.writeFile(
        workspaceId,
        `.herdock/design-systems/${slug}/tokens.css`,
        `:root {\n  --color-bg: #f6f4ef;\n  --color-surface: #ffffff;\n  --color-ink: #24231f;\n  --color-muted: #6f6b61;\n  --color-accent: #3b5ba5;\n  --radius-sm: 8px;\n  --radius-md: 14px;\n  --space-1: 4px;\n  --space-2: 8px;\n  --space-3: 12px;\n  --space-4: 16px;\n  --space-6: 24px;\n}\n`,
      );
      onSelect(slug);
      setName("");
      onCreated();
      onToast({ kind: "ok", title: "已创建设计系统", detail: slug });
    } catch (reason) {
      onToast({ kind: "error", title: "创建失败", detail: String(reason) });
    } finally {
      setCreating(false);
    }
  };

  const colors = tokenColors(content?.tokensCss || "");
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small className="mono">PORTABLE BRAND CONTRACTS</small>
          <h2>设计系统</h2>
          <p>读取全局目录和工作区 .herdock/design-systems 下的 DESIGN.md 与 tokens.css。</p>
        </span>
        <div className="design-create-row">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="新系统名称"
            disabled={!workspaceId || creating}
          />
          <button
            type="button"
            className="primary"
            disabled={!workspaceId || creating || !name.trim()}
            onClick={() => void createSystem()}
          >
            在工作区新建
          </button>
        </div>
      </div>
      {error && (
        <div className="design-inline-error" role="alert">
          {error}
        </div>
      )}
      {!systems.length ? (
        <DesignEmptyColumn
          title="还没有设计系统"
          body="内置 Neutral Modern 会在连接本地核心后出现。也可以在工作区新建一份。"
        />
      ) : (
        <div className="design-systems-layout">
          <div className="design-system-grid">
            {systems.map((system) => (
              <article
                key={`${system.scope}:${system.id}`}
                className={`design-system-card ${system.id === selected?.id ? "on" : ""}`}
                onClick={() => onSelect(system.id)}
              >
                <span className="design-system-swatch">
                  <i />
                  <i />
                  <i />
                  <Palette size={15} />
                </span>
                <span className="design-system-copy">
                  <small className="mono">{system.category}</small>
                  <strong>{system.name}</strong>
                  <p>{system.description || "可移植的 HerDock 设计上下文。"}</p>
                </span>
                <span className="design-system-foot">
                  <em>{scopeLabel(system.scope)}</em>
                  {system.hasTokens && <em className="mono ok">tokens.css</em>}
                </span>
              </article>
            ))}
          </div>
          {selected && (
            <aside className="design-system-detail" data-slot="spec-sheet">
              <DesignSpecSheet
                title={selected.name}
                subtitle={`${scopeLabel(selected.scope)} · ${selected.category}`}
                rows={[
                  { label: "ID", value: selected.id, emphasis: true },
                  { label: "范围", value: scopeLabel(selected.scope) },
                  { label: "tokens.css", value: selected.hasTokens ? "有" : "无" },
                ]}
              />
              {!!colors.length && (
                <div className="design-system-swatches" aria-label="色板">
                  {colors.map((color) => (
                    <i key={color} style={{ background: color }} title={color} />
                  ))}
                </div>
              )}
              {content?.designMarkdown && (
                <pre className="design-system-md">{content.designMarkdown.slice(0, 900)}</pre>
              )}
              {workspaceId && selected.scope !== "builtin" && (
                <button
                  type="button"
                  onClick={() =>
                    void hostApi.revealFile(
                      workspaceId,
                      `.herdock/design-systems/${selected.id}/DESIGN.md`,
                    )
                  }
                >
                  在文件夹中打开
                </button>
              )}
            </aside>
          )}
        </div>
      )}
    </section>
  );
}

function DesignAssets({
  items,
  selectedIds,
  workspaceId,
  workspaceReady,
  onImport,
  onToggle,
  onRemove,
  onToast,
}: {
  items: ContextItem[];
  selectedIds: string[];
  workspaceId?: string;
  workspaceReady: boolean;
  onImport: (paths: string[]) => Promise<void>;
  onToggle: (id: string) => void;
  onRemove: (id: string) => Promise<void>;
  onToast: (toast: Omit<Toast, "id">) => void;
}) {
  const assets = items.filter(isDesignAsset);
  const importFiles = async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      title: "导入设计素材",
      filters: [
        { name: "设计素材", extensions: ["css", "svg", "png", "jpg", "jpeg", "webp", "md", "txt"] },
      ],
    });
    const paths = typeof selected === "string" ? [selected] : selected || [];
    if (!paths.length) return;
    try {
      await onImport(paths);
      onToast({ kind: "ok", title: `已导入 ${paths.length} 个素材` });
    } catch (error) {
      onToast({ kind: "error", title: "导入失败", detail: String(error) });
    }
  };
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small className="mono">REFERENCE MATERIAL</small>
          <h2>素材库</h2>
          <p>导入的图片、tokens 与参考文案都会成为下次设计会话的上下文。</p>
        </span>
        <button type="button" disabled={!workspaceReady} onClick={() => void importFiles()}>
          <UploadSimple size={13} />
          导入素材
        </button>
      </div>
      {!workspaceReady ? (
        <DesignEmptyColumn
          title="正在准备工作区"
          body="素材会加入当前工作区上下文，供下次生成引用。"
        />
      ) : assets.length ? (
        <div className="design-asset-grid">
          {assets.map((item) => (
            <article
              key={item.id}
              className={`design-asset-card ${selectedIds.includes(item.id) ? "on" : ""}`}
            >
              <DesignAssetThumb item={item} workspaceId={workspaceId} />
              <DesignArtifactCard
                title={item.displayName}
                meta={`${item.mimeType.split(";")[0]} · ${formatBytes(item.sizeBytes)}`}
                onClick={() => onToggle(item.id)}
              />
              <div className="design-project-actions">
                <button type="button" onClick={() => onToggle(item.id)}>
                  {selectedIds.includes(item.id) ? "已加入上下文" : "加入下次生成"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void onRemove(item.id).then(() =>
                      onToast({ kind: "ok", title: "已移除素材", detail: item.displayName }),
                    )
                  }
                >
                  <Trash size={12} />
                  移除
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <DesignEmptyColumn
          title="暂无设计素材"
          body="可导入图片、CSS、SVG 或参考文案；文件会加入当前工作区上下文。"
          action={{ label: "选择文件", onClick: () => void importFiles() }}
        />
      )}
    </section>
  );
}

function DesignAssetThumb({ item, workspaceId }: { item: ContextItem; workspaceId?: string }) {
  const [src, setSrc] = useState("");
  const path = item.relativePath || item.storedPath;
  const image = item.mimeType.startsWith("image/");
  useEffect(() => {
    if (!image || !workspaceId || !path) return;
    let active = true;
    void hostApi
      .previewFile(workspaceId, path)
      .then((preview) => {
        if (!active || !preview.bytesBase64) return;
        setSrc(`data:${preview.mime || item.mimeType};base64,${preview.bytesBase64}`);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [image, item.mimeType, path, workspaceId]);
  if (src) return <img className="design-asset-preview" src={src} alt="" />;
  return (
    <span className="design-asset-preview icon">
      {image ? <ImageSquare size={22} /> : <FileHtml size={22} />}
    </span>
  );
}

/* ------------------------------------------------------------------ helpers -- */

function projectSlug(artifact: Artifact): string {
  const rest = artifact.path.replace(/^out\/design\//, "");
  return rest.split("/")[0] || rest;
}

function groupDocs(designs: Artifact[]): DesignDoc[] {
  const map = new Map<string, Artifact[]>();
  for (const artifact of designs) {
    const slug = projectSlug(artifact);
    const list = map.get(slug);
    if (list) list.push(artifact);
    else map.set(slug, [artifact]);
  }
  return Array.from(map.entries()).map(([slug, artifacts]) => {
    const sorted = [...artifacts].sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));
    const root = sorted.find((item) => projectDepth(item) === 1) || sorted[0];
    return { slug, title: root.name || slug, artifacts: sorted };
  });
}

function projectDepth(artifact: Artifact): number {
  return artifact.path.replace(/^out\/design\//, "").split("/").length - 1;
}

function groupTurns(artifacts: Artifact[]): DesignTurn[] {
  const map = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    const key = artifact.runId || `local:${projectSlug(artifact)}`;
    const list = map.get(key);
    if (list) list.push(artifact);
    else map.set(key, [artifact]);
  }
  const groups = Array.from(map.entries()).map(([key, variants]) => {
    const sorted = [...variants].sort((a, b) => stamp(a.createdAt) - stamp(b.createdAt));
    return { key, at: sorted[sorted.length - 1].createdAt || "", variants: sorted };
  });
  groups.sort((a, b) => stamp(a.at) - stamp(b.at));
  return groups
    .map((group, index) => ({ ...group, index: index + 1 }))
    .sort((a, b) => b.index - a.index);
}

function variantLabel(turnIndex: number, variantIndex: number): string {
  return `${turnIndex}${String.fromCharCode(97 + variantIndex)}`;
}
function turnIndexOf(turns: DesignTurn[], artifact: Artifact): number {
  return turns.find((turn) => turn.variants.some((item) => item.id === artifact.id))?.index || 1;
}
function variantIndexOf(turns: DesignTurn[], artifact: Artifact): number {
  const turn = turns.find((item) => item.variants.some((entry) => entry.id === artifact.id));
  return turn ? turn.variants.findIndex((item) => item.id === artifact.id) : 0;
}

type Bubble = {
  key: string;
  role: "user" | "agent";
  text: string;
  at?: string;
  last?: boolean;
  streaming?: boolean;
};

function conversation(events: AgentEvent[]): Bubble[] {
  const bubbles: Bubble[] = [];
  let live = "";
  let liveKey = "stream";
  let liveAt = "";
  for (const event of events) {
    if (event.type === "message.user") {
      if (live.trim()) {
        bubbles.push({
          key: liveKey,
          role: "agent",
          text: live.trim(),
          at: liveAt,
          streaming: true,
        });
        live = "";
      }
      const text = "text" in event ? String(event.text || "").trim() : "";
      if (!text) continue;
      bubbles.push({
        key: String(event.id || `${event.seq}`),
        role: "user",
        text,
        at: event.ts,
      });
    } else if (event.type === "message.assistant") {
      live = "";
      const text = "text" in event ? String(event.text || "").trim() : "";
      if (!text) continue;
      bubbles.push({
        key: String(event.id || `${event.seq}`),
        role: "agent",
        text,
        at: event.ts,
      });
    } else if (event.type === "assistant_delta") {
      live += "text" in event ? String(event.text || "") : "";
      liveKey = String(event.id || `${event.seq}`);
      liveAt = event.ts;
    }
  }
  if (live.trim()) {
    bubbles.push({ key: liveKey, role: "agent", text: live.trim(), at: liveAt, streaming: true });
  }
  const trimmed = bubbles.slice(-8);
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed[index].role === "agent") {
      trimmed[index] = { ...trimmed[index], last: true };
      break;
    }
  }
  return trimmed;
}

function latestPlan(events: AgentEvent[]): PlanStep[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "plan_updated" || event.type === "plan.updated") return event.steps || [];
  }
  return [];
}

function latestTools(events: AgentEvent[]) {
  const map = new Map<
    string,
    { id: string; name: string; hint: string; state: "running" | "done" | "failed" }
  >();
  for (const event of events) {
    if (event.type === "tool.requested" || event.type === "tool_requested") {
      const args = event.arguments || {};
      const path = typeof args.path === "string" ? args.path : "";
      const command = typeof args.command === "string" ? args.command : "";
      const hint = path || command.split(" ").slice(0, 3).join(" ") || event.name;
      map.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.name,
        hint,
        state: "running",
      });
    } else if (event.type === "tool.output" || event.type === "tool_output") {
      const prev = map.get(event.toolCallId);
      map.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.name || prev?.name || "tool",
        hint: prev?.hint || "",
        state: event.failed ? "failed" : "done",
      });
    }
  }
  return Array.from(map.values()).slice(-6);
}

function latestEdits(events: AgentEvent[]) {
  const items: {
    id: string;
    path: string;
    kind: string;
    additions?: number;
    deletions?: number;
  }[] = [];
  for (const event of events) {
    if (
      event.type === "file.edit_applied" ||
      event.type === "file.edit_proposed" ||
      event.type === "file_patch"
    ) {
      items.push({
        id: String(event.id || event.seq),
        path: event.path,
        kind: event.kind,
        additions: event.additions,
        deletions: event.deletions,
      });
    }
  }
  return items.slice(-8);
}

function latestError(events: AgentEvent[], run: Run | null) {
  if (!run || run.status !== "failed") return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "error") {
      return { message: event.message, retriable: event.retriable !== false };
    }
    if ((event.type === "failed" || event.type === "run.status") && event.message) {
      return { message: event.message, retriable: true };
    }
  }
  return { message: "设计生成失败，可重试这一轮。", retriable: true };
}

function jobStageOf(run: Run, plan: PlanStep[]) {
  if (run.status === "queued" || run.status === "starting") return { index: 0, progress: 0.45 };
  if (run.status === "waiting_approval" || run.status === "waiting_human") {
    return { index: 2, progress: 0.4 };
  }
  if (plan.length) {
    const done = plan.filter((step) => step.state === "done").length;
    return { index: 1, progress: done / plan.length };
  }
  return { index: 1, progress: 0.35 };
}

function dayLabel(value?: string): string {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今天";
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

/** Token overrides the tweak panel writes; design-system packages consume these names. */
function tweakCss(tweaks: Tweaks): string {
  const accent = ACCENTS[tweaks.accent];
  const density = DENSITIES[tweaks.density].value;
  const lines = [
    `:root{`,
    `--accent:${accent};--accent-strong:${accent};--brand:${accent};`,
    `--radius:${tweaks.radius}px;--radius-card:${tweaks.radius}px;--radius-btn:${Math.max(4, tweaks.radius - 3)}px;`,
    `--density:${density}px;--space-unit:${density}px;`,
    `font-size:${(16 * tweaks.fontScale).toFixed(2)}px;`,
    `color-scheme:${tweaks.dark ? "dark" : "light"};`,
    `}`,
  ];
  if (tweaks.dark) lines.push(`html{color-scheme:dark}`);
  if (tweaks.grid)
    lines.push(
      `body{background-image:linear-gradient(to right,rgba(59,91,165,.12) 0 1px,transparent 1px 8px),linear-gradient(to bottom,rgba(59,91,165,.12) 0 1px,transparent 1px 8px)!important;background-size:8px 8px!important}`,
    );
  if (tweaks.hotspots)
    lines.push(
      `a,button,[role="button"],input,select,textarea{outline:1px dashed ${accent}!important;outline-offset:1px}`,
    );
  return lines.join("");
}

const TWEAK_MARK = "herdock-tweaks";

function securePreviewDocument(html: string, tweaks: Tweaks): string {
  const policy =
    "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const head = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style id="${TWEAK_MARK}">${tweakCss(tweaks)}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${head}</head>`);
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${head}`);
  if (/<html[\s>]/i.test(html))
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

/** Persist the current tweaks into the artifact source, replacing any earlier block. */
function withTweakBlock(html: string, tweaks: Tweaks): string {
  const block = `<style id="${TWEAK_MARK}">${tweakCss(tweaks)}</style>`;
  const existing = new RegExp(`<style id="${TWEAK_MARK}">[\\s\\S]*?</style>`, "i");
  if (existing.test(html)) return html.replace(existing, block);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${block}</body>`);
  return `${html}\n${block}`;
}

function titleFromBrief(brief: string): string {
  const first = brief.split(/[\n。.!?！？]/)[0].trim();
  return (first || brief).slice(0, 40);
}
function systemDot(system: DesignSystem | null): string {
  if (!system) return "var(--faint)";
  if (system.scope === "workspace") return "var(--accent-hover)";
  if (system.scope === "global") return "var(--ok)";
  return "var(--violet)";
}
function scopeLabel(scope: string): string {
  if (scope === "workspace") return "工作区";
  if (scope === "global") return "全局";
  return "内置";
}
function rendererLabel(artifact: Artifact | null): string {
  if (!artifact) return "—";
  return `${artifact.renderer || artifact.ext} · sandboxed iframe`;
}
function viewportSize(viewport: ViewportId): string {
  const { width, height } = VIEWPORTS[viewport];
  return `${width} × ${height}`;
}
function isRunActive(status: string): boolean {
  return ["queued", "starting", "running", "waiting_approval", "waiting_human", "paused"].includes(
    status,
  );
}
function stamp(value?: string): number {
  const time = new Date(value || "").getTime();
  return Number.isNaN(time) ? 0 : time;
}
function timeOf(value?: string): string {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
function formatBytes(n?: number): string {
  if (!n) return "0 B";
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}
function formatDate(value?: string): string {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 48) || "brand";
}
function tokenColors(css: string): string[] {
  const found = [...css.matchAll(/--[\w-]+:\s*(#[0-9a-fA-F]{3,8})\b/g)].map((match) => match[1]);
  return Array.from(new Set(found)).slice(0, 8);
}
function isDesignAsset(item: ContextItem): boolean {
  const mime = item.mimeType.split(";")[0].trim().toLowerCase();
  const name = item.displayName.toLowerCase();
  return (
    mime.startsWith("image/") ||
    mime === "text/css" ||
    mime === "text/markdown" ||
    mime === "text/plain" ||
    /\.(svg|css|md|txt|png|jpe?g|webp|gif)$/i.test(name)
  );
}

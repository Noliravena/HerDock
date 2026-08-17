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
  FolderOpen,
  ImageSquare,
  ImagesSquare,
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
  type Run,
} from "../host/client";
import { chatModelLabel } from "../lib/models";
import { loadPromptHistory, pushPromptHistory } from "../lib/prompts";
import { runTimingLabel, tokensLite } from "../lib/runMetrics";
import { useWorkbench, type DesignRoute, type DesignRunInput } from "../store/workbench";
import { BrandMark } from "./BrandMark";
import {
  DesignAgentPlan,
  DesignApprovalCard,
  DesignArtifactCard,
  DesignCheckpointCard,
  DesignComparison,
  DesignConfirm,
  DesignConnectionBanner,
  DesignEditsList,
  DesignEmptyColumn,
  DesignErrorBanner,
  DesignJobProgress,
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
const JOB_STAGES = [{ name: "排队" }, { name: "生成" }, { name: "写入" }, { name: "预览" }];

const DESIGN_BRIEF_KEY = "herdock.design-brief.v1";

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
      openWorkspacePath: s.openWorkspacePath,
      providerId: s.providerId,
      providerProfiles: s.providerProfiles,
      refreshPanels: s.refreshPanels,
      resolveApproval: s.resolveApproval,
      run: s.run,
      setActiveDesignArtifact: s.setActiveDesignArtifact,
      setCenterView: s.setCenterView,
      setDesignDraft: s.setDesignDraft,
      setDesignRoute: s.setDesignRoute,
      startDesignRun: s.startDesignRun,
      workspace: s.workspace,
    })),
  );
  const [systems, setSystems] = useState<DesignSystem[]>([]);
  const [systemsError, setSystemsError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);

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

  const refresh = useCallback(async () => {
    setReloadKey((value) => value + 1);
    await state.refreshPanels();
  }, [state]);
  const openWorkspace = async () => {
    const path = await open({ directory: true, multiple: false, title: "打开设计工作区" });
    if (typeof path === "string") await state.openWorkspacePath(path);
  };
  const exportArtifact = async (artifact: Artifact) => {
    if (!state.workspace) return;
    const destination = await save({
      defaultPath: artifact.name,
      title: `导出设计 · ${artifact.name}`,
    });
    if (destination)
      await hostApi.exportArtifact(
        state.workspace.id,
        artifact.entryPath || artifact.path,
        destination,
      );
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
          {ROUTES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={state.designRoute === id ? "active" : ""}
              aria-current={state.designRoute === id ? "page" : undefined}
              onClick={() => state.setDesignRoute(id)}
            >
              <Icon size={13} />
              {label}
              <i aria-hidden />
            </button>
          ))}
        </nav>
        <div className="design-header-actions">
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
        {!state.workspace && (
          <div className="design-workspace-callout">
            <FolderOpen size={20} />
            <span>
              <strong>先选择一个本地工作区</strong>
              <small>设计源文件和产物会写入该工作区的 out/design 目录。</small>
            </span>
            <button type="button" onClick={() => void openWorkspace()}>
              打开文件夹
            </button>
          </div>
        )}
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
            onNewDesign={() => state.setActiveDesignArtifact(null)}
            onStart={state.startDesignRun}
            onContinue={state.continueDesignRun}
            onResolveApproval={state.resolveApproval}
            onOpenApprovals={() => state.setCenterView("approvals")}
            onOpenSource={(path) => void state.openPath(path)}
            onExport={exportArtifact}
            onRefresh={refresh}
          />
        )}
        {state.designRoute === "projects" && (
          <DesignProjects
            designs={designs}
            runs={state.allRuns}
            onOpen={(artifact) => void state.openDesignArtifact(artifact.id)}
            onCreate={() => {
              state.setActiveDesignArtifact(null);
              state.setDesignRoute("canvas");
            }}
          />
        )}
        {state.designRoute === "systems" && (
          <DesignSystems systems={systems} error={systemsError} />
        )}
        {state.designRoute === "assets" && (
          <DesignAssets
            items={state.contextItems}
            workspaceReady={!!state.workspace}
            onImport={state.importContextPaths}
          />
        )}
      </main>
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
}) {
  const [viewport, setViewport] = useState<ViewportId>("desktop");
  const [zoom, setZoom] = useState(80);
  const [tab, setTab] = useState<"tweaks" | "versions" | "inspect">("tweaks");
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [maximized, setMaximized] = useState<Artifact | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [applyState, setApplyState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    run: () => void;
  } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

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

  const focusComposer = () => composerRef.current?.focus();
  const applyTweaks = async () => {
    if (!workspace || !activeVariant) return;
    const path = activeVariant.entryPath || activeVariant.path;
    setApplyState("saving");
    try {
      const file = await hostApi.readFile(workspace.id, path);
      await hostApi.writeFile(workspace.id, path, withTweakBlock(file.content, tweaks));
      setApplyState("done");
      await onRefresh();
    } catch {
      setApplyState("error");
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
        if (dirty) {
          setConfirm({
            title: "打开源文件？",
            body: "代码编辑器里有未保存内容。打开设计源文件会替换当前编辑内容。",
            confirmLabel: "继续打开",
            run: openSource,
          });
          return;
        }
        openSource();
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
          {docs.map((doc) => (
            <button
              key={doc.slug}
              type="button"
              className={doc.slug === activeDoc?.slug ? "active" : ""}
              onClick={() => onSelectArtifact(doc.artifacts[0])}
            >
              <FileHtml size={12} />
              {doc.title}
            </button>
          ))}
          <button type="button" className="design-doc-add" title="新建设计" onClick={onNewDesign}>
            <Plus size={12} />
          </button>
          <div className="design-doc-tools">
            <div className="seg icon-seg" role="group" aria-label="预览尺寸">
              {(Object.keys(VIEWPORTS) as ViewportId[]).map((id) => {
                const { Icon, label, width, height } = VIEWPORTS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className={viewport === id ? "active" : ""}
                    aria-pressed={viewport === id}
                    title={`${label} ${width} × ${height}`}
                    onClick={() => setViewport(id)}
                  >
                    <Icon size={12} />
                  </button>
                );
              })}
            </div>
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
          <div className="inspector-tabs" role="tablist">
            {(
              [
                ["tweaks", "调整"],
                ["versions", `版本${checkpoints.length ? ` ${checkpoints.length}` : ""}`],
                ["inspect", "检查"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

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
      {confirm && (
        <DesignConfirm
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.run();
            setConfirm(null);
          }}
        />
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
  const format = FORMATS.find((item) => item.id === formatId) || FORMATS[0];
  const messages = useMemo(() => conversation(events), [events]);
  const plan = useMemo(() => latestPlan(events), [events]);
  const tools = useMemo(() => latestTools(events), [events]);
  const edits = useMemo(() => latestEdits(events), [events]);
  const failure = useMemo(() => latestError(events, lastRun), [events, lastRun]);
  const runId = activeVariant?.runId || liveRun?.id;
  const iterating = !!runId && hasProject;
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
  const importFiles = async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      title: "导入设计上下文",
      filters: [{ name: "设计素材", extensions: ["css", "svg", "png", "jpg", "md", "txt"] }],
    });
    const paths = typeof selected === "string" ? [selected] : selected || [];
    if (paths.length) await importContextPaths(paths);
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
    <aside className="design-session-panel" aria-label="设计会话">
      <div className="canvas-panel-head">
        <span className="mono">DESIGN SESSION</span>
        {liveRun ? (
          <DesignStatusPill
            state={liveRun.status === "waiting_approval" ? "waiting" : "working"}
            label={statusLabel}
            elapsed={elapsed}
            onPause={() => void cancelRun()}
          />
        ) : (
          <span className="mono turns">{turns.length ? `${turns.length} 轮` : "新会话"}</span>
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
                <div className="design-bubble user">
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
                <div className="design-bubble agent">
                  <span className="design-avatar">
                    <BrandMark />
                  </span>
                  <div>
                    <span className="design-speaker">
                      <span className="speaker-dot" aria-hidden="true" />
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
                          accepted={false}
                          onAccept={focusInput}
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
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div
          className={`design-composer-card${slashOptions.length || mentionOptions.length ? " menu-open" : ""}`}
        >
          {slashOptions.length > 0 && (
            <ul className="design-composer-menu" role="listbox">
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
            <ul className="design-composer-menu" role="listbox">
              {mentionOptions.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onDraft({
                        brief: draft.brief.replace(/(^|[\s])@([^\s@]*)$/, `$1@${item.name} `),
                        designSystemId: item.id,
                      });
                      focusInput();
                    }}
                  >
                    <At size={12} />
                    <span>{item.name}</span>
                    <small>{scopeLabel(item.scope)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="design-composer-chips">
            {system?.hasTokens && <span className="mono accent">@ tokens.css</span>}
            {system && <span className="mono">{system.name}</span>}
            {activeVariant && <span className="mono">{activeVariant.name}</span>}
            {contextItems.slice(0, 3).map((item) => (
              <span key={item.id} className="mono">
                {item.displayName}
              </span>
            ))}
          </div>
          <textarea
            ref={ref}
            value={draft.brief}
            onChange={(event) => {
              onDraft({ brief: event.target.value });
              setSlashIndex(0);
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
                if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
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
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={
              iterating
                ? "说明要改的地方，或输入 / 唤起命令…"
                : "描述你要的界面，或输入 / 唤起命令…"
            }
            rows={2}
          />
          <div className="design-composer-row">
            <div className="design-plus-wrap">
              <button
                type="button"
                className="round"
                title="更多"
                aria-label="更多"
                aria-expanded={plusOpen}
                onClick={() => setPlusOpen((value) => !value)}
              >
                <Plus size={12} />
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
            {!iterating && (
              <button
                type="button"
                className="pill"
                title="一次生成几个方案"
                onClick={() => setVariantCount((value) => (value % 3) + 1)}
              >
                方案 ×{variantCount}
                <CaretDown size={9} />
              </button>
            )}
            <label className="pill">
              <span className="sr-only">产物格式</span>
              <select value={formatId} onChange={(event) => setFormatId(event.target.value)}>
                {FORMATS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {liveRun ? (
              <button
                type="button"
                className="send stop"
                title="停止"
                aria-label="停止"
                onClick={() => void cancelRun()}
              >
                <span className="stop-sq" />
              </button>
            ) : (
              <button
                type="submit"
                className="send"
                disabled={!draft.brief.trim() || sending || !hostOnline}
                title={iterating ? "继续迭代 (Ctrl/⌘ + Enter)" : "开始设计 (Ctrl/⌘ + Enter)"}
                aria-label={iterating ? "继续迭代" : "开始设计"}
              >
                <ArrowUp size={12} />
              </button>
            )}
          </div>
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
  onOpen,
  onCreate,
}: {
  designs: Artifact[];
  runs: Run[];
  onOpen: (artifact: Artifact) => void;
  onCreate: () => void;
}) {
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small className="mono">DESIGN PROJECTS</small>
          <h2>项目</h2>
          <p>每个项目都由 manifest 管理，并保留可继续编辑的 HTML 源文件。</p>
        </span>
        <button type="button" className="primary" onClick={onCreate}>
          <Sparkle size={13} />
          新建设计
        </button>
      </div>
      {designs.length ? (
        <div className="design-project-grid">
          {designs.map((artifact) => (
            <DesignProjectCard
              key={artifact.id}
              artifact={artifact}
              run={runs.find((item) => item.id === artifact.runId)}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <div className="design-empty-state">
          <Monitor size={32} weight="thin" />
          <strong>还没有设计项目</strong>
          <p>从一段 brief 开始，首个产物会生成在 out/design 目录。</p>
          <button type="button" onClick={onCreate}>
            <Sparkle size={13} />
            创建第一个设计
          </button>
        </div>
      )}
    </section>
  );
}

function DesignProjectCard({
  artifact,
  run,
  onOpen,
}: {
  artifact: Artifact;
  run?: Run;
  onOpen: (artifact: Artifact) => void;
}) {
  const generating = !!(run && isRunActive(run.status));
  return (
    <article className="design-project-card">
      <button type="button" className="design-project-cover" onClick={() => onOpen(artifact)}>
        {artifact.kind === "deck" ? (
          <PresentationChart size={28} weight="duotone" />
        ) : (
          <BracketsCurly size={28} weight="duotone" />
        )}
        <em className="mono">{artifact.renderer || artifact.ext}</em>
      </button>
      <DesignArtifactCard
        title={artifact.name}
        meta={`${artifact.kind} · ${generating ? "生成中" : artifact.status} · ${formatDate(artifact.createdAt)}`}
        generating={generating}
        onClick={() => onOpen(artifact)}
      />
    </article>
  );
}

function DesignSystems({ systems, error }: { systems: DesignSystem[]; error: string }) {
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small className="mono">PORTABLE BRAND CONTRACTS</small>
          <h2>设计系统</h2>
          <p>读取全局目录和工作区 .herdock/design-systems 下的 DESIGN.md 与 tokens.css。</p>
        </span>
      </div>
      {error && (
        <div className="design-inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="design-system-grid">
        {systems.map((system) => (
          <article key={`${system.scope}:${system.id}`} className="design-system-card">
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
    </section>
  );
}

function DesignAssets({
  items,
  workspaceReady,
  onImport,
}: {
  items: ContextItem[];
  workspaceReady: boolean;
  onImport: (paths: string[]) => Promise<void>;
}) {
  const assets = items.filter(
    (item) => item.mimeType.startsWith("image/svg+xml") || item.mimeType.startsWith("text/css"),
  );
  const importFiles = async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      title: "导入 CSS 或 SVG 设计素材",
      filters: [{ name: "设计素材", extensions: ["css", "svg"] }],
    });
    const paths = typeof selected === "string" ? [selected] : selected || [];
    if (paths.length) await onImport(paths);
  };
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small className="mono">REFERENCE MATERIAL</small>
          <h2>素材库</h2>
          <p>导入的 tokens 与矢量素材都会成为设计会话的上下文。</p>
        </span>
        <button type="button" disabled={!workspaceReady} onClick={() => void importFiles()}>
          <UploadSimple size={13} />
          导入 CSS / SVG
        </button>
      </div>
      {assets.length ? (
        <div className="design-asset-grid">
          {assets.map((item) => (
            <DesignArtifactCard
              key={item.id}
              title={item.displayName}
              meta={`${item.mimeType.split(";")[0]} · ${formatBytes(item.sizeBytes)}`}
            />
          ))}
        </div>
      ) : (
        <div className="design-empty-state small">
          <ImageSquare size={30} weight="thin" />
          <strong>暂无设计素材</strong>
          <p>可在这里直接导入 CSS 或 SVG；文件会加入当前工作区上下文。</p>
          <button type="button" disabled={!workspaceReady} onClick={() => void importFiles()}>
            选择文件
          </button>
        </div>
      )}
    </section>
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

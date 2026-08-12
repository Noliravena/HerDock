import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowClockwise,
  BracketsCurly,
  Browser,
  Check,
  ClockCounterClockwise,
  DeviceMobile,
  DownloadSimple,
  FileCss,
  FolderOpen,
  ImageSquare,
  Layout,
  Monitor,
  Palette,
  Play,
  PresentationChart,
  ShieldCheck,
  Sparkle,
  UploadSimple,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import type { AgentEvent } from "@her-dock/agent-protocol";
import {
  hostApi,
  type Approval,
  type Artifact,
  type Checkpoint,
  type ContextItem,
  type DesignSystem,
  type Run,
} from "../host/client";
import { useWorkbench, type DesignRoute, type DesignRunInput } from "../store/workbench";

const TEMPLATES: Array<{
  id: string;
  label: string;
  detail: string;
  icon: typeof Browser;
  artifactKind: DesignRunInput["artifactKind"];
  renderer: DesignRunInput["renderer"];
}> = [
  {
    id: "web",
    label: "Web 原型",
    detail: "落地页、产品页与交互原型",
    icon: Browser,
    artifactKind: "html",
    renderer: "html",
  },
  {
    id: "dashboard",
    label: "数据看板",
    detail: "运营后台、指标与工作台",
    icon: Layout,
    artifactKind: "html",
    renderer: "html",
  },
  {
    id: "mobile",
    label: "移动界面",
    detail: "响应式移动端页面与流程",
    icon: DeviceMobile,
    artifactKind: "html",
    renderer: "html",
  },
  {
    id: "deck",
    label: "演示文稿",
    detail: "横向浏览的 HTML Deck",
    icon: PresentationChart,
    artifactKind: "deck",
    renderer: "deck-html",
  },
];

const ROUTES: Array<{ id: DesignRoute; label: string }> = [
  { id: "canvas", label: "画布" },
  { id: "projects", label: "项目" },
  { id: "systems", label: "设计系统" },
  { id: "assets", label: "素材库" },
];

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
      events: s.events,
      importContextPaths: s.importContextPaths,
      openDesignArtifact: s.openDesignArtifact,
      openPath: s.openPath,
      openWorkspacePath: s.openWorkspacePath,
      providerId: s.providerId,
      refreshPanels: s.refreshPanels,
      resolveApproval: s.resolveApproval,
      run: s.run,
      setActiveDesignArtifact: s.setActiveDesignArtifact,
      setCenterView: s.setCenterView,
      setDesignDraft: s.setDesignDraft,
      setDesignRoute: s.setDesignRoute,
      skills: s.skills,
      startDesignRun: s.startDesignRun,
      workspace: s.workspace,
    })),
  );
  const [systems, setSystems] = useState<DesignSystem[]>([]);
  const [systemsError, setSystemsError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

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
  const selected = designs.find((item) => item.id === state.activeDesignArtifactId) || null;

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
    if (state.activeDesignArtifactId && !selected && designs.length) {
      state.setActiveDesignArtifact(null);
    }
  }, [designs.length, selected, state]);

  const refresh = async () => {
    setReloadKey((value) => value + 1);
    await state.refreshPanels();
  };
  const openWorkspace = async () => {
    const path = await open({ directory: true, multiple: false, title: "打开设计工作区" });
    if (typeof path === "string") await state.openWorkspacePath(path);
  };

  return (
    <div className="design-surface">
      <header className="design-header">
        <div className="design-brand">
          <span className="design-brand-icon">
            <Palette size={17} weight="duotone" />
          </span>
          <span>
            <strong>设计</strong>
            <small>{state.workspace?.name || "未打开工作区"}</small>
          </span>
        </div>
        <nav className="design-routes" aria-label="设计工作区导航">
          {ROUTES.map((route) => (
            <button
              key={route.id}
              type="button"
              className={state.designRoute === route.id ? "active" : ""}
              aria-current={state.designRoute === route.id ? "page" : undefined}
              onClick={() => state.setDesignRoute(route.id)}
            >
              {route.label}
            </button>
          ))}
        </nav>
        <button type="button" className="design-refresh" onClick={() => void refresh()}>
          <ArrowClockwise size={14} />
          刷新
        </button>
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

        {state.designRoute === "canvas" &&
          (selected ? (
            <DesignCanvas
              artifact={selected}
              designs={designs}
              workspaceId={state.workspace?.id}
              run={
                selected.runId
                  ? state.allRuns.find((item) => item.id === selected.runId) ||
                    (state.run?.id === selected.runId ? state.run : undefined)
                  : undefined
              }
              approvals={state.approvals.filter((item) => item.runId === selected.runId)}
              checkpoints={state.checkpoints.filter((item) => item.runId === selected.runId)}
              events={state.events}
              dirty={state.dirty}
              onChoose={(artifact) => void state.openDesignArtifact(artifact.id)}
              onContinue={state.continueDesignRun}
              onResolveApproval={state.resolveApproval}
              onOpenApprovals={() => state.setCenterView("approvals")}
              onOpenSource={(path) => void state.openPath(path)}
              onRefresh={refresh}
            />
          ) : (
            <DesignStart
              workspaceReady={!!state.workspace}
              systems={systems}
              systemsError={systemsError}
              skills={state.skills}
              providerId={state.providerId}
              designs={designs.slice(0, 4)}
              draft={state.designDraft}
              onDraft={state.setDesignDraft}
              onCreate={state.startDesignRun}
              onOpenProject={(artifact) => void state.openDesignArtifact(artifact.id)}
            />
          ))}
        {state.designRoute === "projects" && (
          <DesignProjects
            designs={designs}
            runs={state.allRuns}
            onOpen={(artifact) => void state.openDesignArtifact(artifact.id)}
            onCreate={() => {
              state.setActiveDesignArtifact(null);
              state.setDesignRoute("canvas");
            }}
            onApproval={() => state.setCenterView("approvals")}
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

function DesignStart({
  workspaceReady,
  systems,
  systemsError,
  skills,
  providerId,
  designs,
  draft,
  onDraft,
  onCreate,
  onOpenProject,
}: {
  workspaceReady: boolean;
  systems: DesignSystem[];
  systemsError: string;
  skills: Array<{ id: string; name: string; detail: string }>;
  providerId: string;
  designs: Artifact[];
  draft: {
    title: string;
    brief: string;
    templateId: string;
    designSystemId: string;
    skillId: string;
  };
  onDraft: (patch: Record<string, string>) => void;
  onCreate: (input: DesignRunInput) => Promise<void>;
  onOpenProject: (artifact: Artifact) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const template = TEMPLATES.find((item) => item.id === draft.templateId) || TEMPLATES[0];
  useEffect(() => {
    if (!systems.length || systems.some((system) => system.id === draft.designSystemId)) return;
    onDraft({ designSystemId: systems[0].id });
  }, [draft.designSystemId, onDraft, systems]);
  const submit = async () => {
    if (!workspaceReady || !draft.title.trim() || !draft.brief.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({
        title: draft.title.trim(),
        brief: draft.brief.trim(),
        templateLabel: template.label,
        artifactKind: template.artifactKind,
        renderer: template.renderer,
        designSystemId: draft.designSystemId,
        skillId: draft.skillId || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="design-home">
      <section className="design-hero">
        <span className="design-eyebrow">
          <Sparkle size={13} weight="fill" /> Agent-native design
        </span>
        <h1>从真实 brief 开始一轮设计</h1>
        <p>产物生成后留在同一个画布中比较、预览、审批和继续迭代。</p>
      </section>
      <form
        className="design-composer-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <div className="design-template-grid" role="radiogroup" aria-label="产物类型">
          {TEMPLATES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={draft.templateId === item.id}
                className={draft.templateId === item.id ? "active" : ""}
                onClick={() => onDraft({ templateId: item.id })}
              >
                <Icon size={18} weight={draft.templateId === item.id ? "duotone" : "regular"} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                {draft.templateId === item.id && <Check size={13} weight="bold" />}
              </button>
            );
          })}
        </div>
        <div className="design-form-grid">
          <label className="design-field title-field">
            <span>项目名称</span>
            <input
              value={draft.title}
              onChange={(e) => onDraft({ title: e.target.value })}
              placeholder="例如：HerDock 产品首页"
              maxLength={80}
            />
          </label>
          <label className="design-field">
            <span>设计系统</span>
            <select
              value={draft.designSystemId}
              onChange={(e) => onDraft({ designSystemId: e.target.value })}
              disabled={!systems.length}
            >
              {systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name} · {scopeLabel(system.scope)}
                </option>
              ))}
            </select>
          </label>
          <label className="design-field">
            <span>附加技能</span>
            <select value={draft.skillId} onChange={(e) => onDraft({ skillId: e.target.value })}>
              <option value="">不额外选择</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {systemsError && (
          <div className="design-inline-error" role="alert">
            设计系统加载失败：{systemsError}
          </div>
        )}
        <label className="design-brief">
          <span>设计需求</span>
          <textarea
            value={draft.brief}
            onChange={(e) => onDraft({ brief: e.target.value })}
            placeholder="描述目标用户、页面结构、关键内容、交互和视觉气质……"
            rows={7}
          />
        </label>
        <div className="design-submit-row">
          <span>
            Provider <strong>{providerId}</strong> · Ctrl/⌘ + Enter 提交
          </span>
          <button
            type="submit"
            disabled={
              !workspaceReady ||
              !systems.length ||
              !draft.title.trim() ||
              !draft.brief.trim() ||
              submitting
            }
          >
            <Play size={14} weight="fill" />
            {submitting ? "正在启动" : "开始设计"}
          </button>
        </div>
      </form>
      {!!designs.length && (
        <section className="design-recent">
          <div className="design-section-head">
            <span>
              <strong>最近设计</strong>
              <small>选择一个产物回到一体化画布</small>
            </span>
          </div>
          <div className="design-project-grid compact">
            {designs.map((artifact) => (
              <DesignProjectCard key={artifact.id} artifact={artifact} onOpen={onOpenProject} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DesignCanvas({
  artifact,
  designs,
  workspaceId,
  run,
  approvals,
  checkpoints,
  events,
  dirty,
  onChoose,
  onContinue,
  onResolveApproval,
  onOpenApprovals,
  onOpenSource,
  onRefresh,
}: {
  artifact: Artifact;
  designs: Artifact[];
  workspaceId?: string;
  run?: Run | null;
  approvals: Approval[];
  checkpoints: Checkpoint[];
  events: AgentEvent[];
  dirty: boolean;
  onChoose: (artifact: Artifact) => void;
  onContinue: (runId: string, prompt: string) => Promise<void>;
  onResolveApproval: (id: string, decision: string) => Promise<void>;
  onOpenApprovals: () => void;
  onOpenSource: (path: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [inspectTab, setInspectTab] = useState<"versions" | "inspect">("inspect");
  const [version, setVersion] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setPreview("");
    setPreviewError("");
    void hostApi
      .artifactPreview(workspaceId, artifact.entryPath || artifact.path)
      .then((result) => active && setPreview(securePreviewDocument(result.html)))
      .catch((error) => active && setPreviewError(String(error)));
    return () => {
      active = false;
    };
  }, [artifact.entryPath, artifact.path, version, workspaceId]);
  const submit = async () => {
    if (!run || !note.trim() || sending) return;
    setSending(true);
    try {
      await onContinue(run.id, note);
      setNote("");
    } finally {
      setSending(false);
    }
  };
  const exportCurrent = async () => {
    if (!workspaceId) return;
    const destination = await save({
      defaultPath: artifact.name,
      title: `导出当前设计 · ${artifact.name}`,
    });
    if (destination)
      await hostApi.exportArtifact(workspaceId, artifact.entryPath || artifact.path, destination);
  };
  const openSource = () => {
    if (
      dirty &&
      !window.confirm("代码编辑器里有未保存内容。打开设计源文件会替换当前编辑内容，是否继续？")
    )
      return;
    onOpenSource(artifact.entryPath || artifact.path);
  };
  const messages = events
    .filter((event) => event.type === "message.user" || event.type === "message.assistant")
    .slice(-5);
  return (
    <section className="design-canvas-shell">
      <aside className="design-session-panel" aria-label="Design Session">
        <div className="canvas-panel-head">
          <span>
            <small>DESIGN SESSION</small>
            <strong>{artifact.name}</strong>
          </span>
          <button
            type="button"
            title="新建设计"
            aria-label="新建设计"
            onClick={() => useWorkbench.getState().setActiveDesignArtifact(null)}
          >
            +
          </button>
        </div>
        <div className="design-session-scroll">
          {messages.length ? (
            messages.map((event, index) => (
              <article
                className={`design-message ${event.type === "message.user" ? "user" : "agent"}`}
                key={String(event.id || index)}
              >
                <small>{event.type === "message.user" ? "你" : "Agent"}</small>
                <p>
                  {event.type === "message.user" || event.type === "message.assistant"
                    ? event.text
                    : ""}
                </p>
              </article>
            ))
          ) : (
            <div className="canvas-empty-copy">
              <Sparkle size={20} />
              <strong>继续这轮设计</strong>
              <span>在这里迭代当前源文件，不会跳出设计表面。</span>
            </div>
          )}
          {run && (
            <div className="design-run-state" role="status">
              <span className={`status-dot ${run.status}`} />
              {statusLabel(run.status)} · {run.id}
            </div>
          )}
          {approvals.map((approval) => (
            <article className="design-approval-card" key={approval.approvalId}>
              <ShieldCheck size={18} />
              <span>
                <strong>{approval.title}</strong>
                <small>{approval.detail}</small>
              </span>
              <div>
                <button
                  type="button"
                  onClick={() => void onResolveApproval(approval.approvalId, "deny")}
                >
                  拒绝
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void onResolveApproval(approval.approvalId, "approve_once")}
                >
                  批准一次
                </button>
              </div>
            </article>
          ))}
        </div>
        <form
          className="design-iterate-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={composerRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={run ? "例如：保留布局，把图表区改得更紧凑…" : "此产物没有可继续的 Run"}
            disabled={!run}
            rows={5}
          />
          <div>
            <span>Ctrl/⌘ + Enter</span>
            <button type="submit" disabled={!run || !note.trim() || sending}>
              <Sparkle size={13} weight="fill" />
              {sending ? "发送中" : "迭代"}
            </button>
          </div>
        </form>
      </aside>

      <div className="design-canvas-main">
        <header className="design-canvas-toolbar">
          <label>
            <span className="sr-only">当前设计方案</span>
            <select
              value={artifact.id}
              onChange={(e) => {
                const next = designs.find((item) => item.id === e.target.value);
                if (next) onChoose(next);
              }}
            >
              {designs.map((item, index) => (
                <option key={item.id} value={item.id}>
                  方案 {index + 1} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="studio-viewports" role="group" aria-label="预览设备">
            {(["desktop", "tablet", "mobile"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={viewport === item ? "active" : ""}
                aria-pressed={viewport === item}
                aria-label={viewportLabel(item)}
                title={viewportLabel(item)}
                onClick={() => setViewport(item)}
              >
                {item === "mobile" ? <DeviceMobile size={14} /> : <Monitor size={14} />}
              </button>
            ))}
          </div>
          <span className="canvas-viewport-size">{viewportSize(viewport)}</span>
          <span className="grow" />
          <button
            type="button"
            onClick={() => {
              setVersion((value) => value + 1);
              void onRefresh();
            }}
          >
            <ArrowClockwise size={13} />
            刷新
          </button>
          <button type="button" onClick={openSource}>
            <BracketsCurly size={13} />
            源文件
          </button>
          <button type="button" onClick={() => void exportCurrent()}>
            <DownloadSimple size={13} />
            导出当前方案
          </button>
        </header>
        <main className="design-preview-stage">
          <div className={`design-preview-frame ${viewport}`}>
            {previewError ? (
              <div className="design-preview-error" role="alert">
                <strong>预览加载失败</strong>
                <span>{previewError}</span>
                <button type="button" onClick={() => setVersion((value) => value + 1)}>
                  重试
                </button>
              </div>
            ) : preview ? (
              <iframe
                title={`${artifact.name} 预览`}
                srcDoc={preview}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="design-preview-loading" role="status">
                正在加载安全预览…
              </div>
            )}
          </div>
        </main>
        <footer className="design-studio-foot">
          <span>
            <i className={artifact.status} />
            {artifact.status}
          </span>
          <span>隔离预览 · 无 Tauri 能力 · 网络默认禁用</span>
        </footer>
      </div>

      <aside className="design-inspector-panel">
        <div className="inspector-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={inspectTab === "inspect"}
            className={inspectTab === "inspect" ? "active" : ""}
            onClick={() => setInspectTab("inspect")}
          >
            检查
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inspectTab === "versions"}
            className={inspectTab === "versions" ? "active" : ""}
            onClick={() => setInspectTab("versions")}
          >
            版本 {checkpoints.length || ""}
          </button>
        </div>
        {inspectTab === "inspect" ? (
          <div className="inspector-content">
            <InspectorRow label="Renderer" value={artifact.renderer || artifact.ext} />
            <InspectorRow label="入口" value={artifact.entryPath || artifact.path} />
            <InspectorRow label="状态" value={artifact.status} />
            <InspectorRow label="尺寸" value={viewportSize(viewport)} />
            <InspectorRow label="网络" value="已禁用" />
            <InspectorRow label="Tauri IPC" value="不可用" />
            <p className="inspector-note">
              视觉 token 调整尚未接入原子写回与检查点，因此这里不提供会误导你的假滑杆；请通过左侧
              Agent 迭代。
            </p>
          </div>
        ) : (
          <div className="inspector-content versions">
            {checkpoints.length ? (
              checkpoints.map((checkpoint) => (
                <article key={checkpoint.id}>
                  <ClockCounterClockwise size={16} />
                  <span>
                    <strong>{checkpoint.label}</strong>
                    <small>{formatDate(checkpoint.createdAt)}</small>
                  </span>
                </article>
              ))
            ) : (
              <div className="canvas-empty-copy">
                <ClockCounterClockwise size={20} />
                <strong>暂无版本检查点</strong>
                <span>Agent 写入前创建的检查点会显示在这里。</span>
              </div>
            )}
          </div>
        )}
        {run?.status === "waiting_approval" && !approvals.length && (
          <button type="button" className="inspector-approval-link" onClick={onOpenApprovals}>
            打开审批中心
          </button>
        )}
      </aside>
    </section>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector-row">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function DesignProjects({
  designs,
  runs,
  onOpen,
  onCreate,
  onApproval,
}: {
  designs: Artifact[];
  runs: Run[];
  onOpen: (artifact: Artifact) => void;
  onCreate: () => void;
  onApproval: () => void;
}) {
  const designRun = designs
    .map((item) => item.runId && runs.find((run) => run.id === item.runId))
    .find(
      (run) => run && ["queued", "starting", "running", "waiting_approval"].includes(run.status),
    );
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small>DESIGN PROJECTS</small>
          <h2>项目</h2>
          <p>每个项目都由 manifest 管理，并保留可继续编辑的 HTML 源文件。</p>
        </span>
        <button type="button" onClick={onCreate}>
          <Sparkle size={14} />
          新建设计
        </button>
      </div>
      {designRun && (
        <button
          type="button"
          className="design-run-banner"
          onClick={designRun.status === "waiting_approval" ? onApproval : undefined}
        >
          <span className="design-live-dot" />
          设计 Agent {statusLabel(designRun.status)}
          {designRun.status === "waiting_approval" && " · 点击处理"}
        </button>
      )}
      {designs.length ? (
        <div className="design-project-grid">
          {designs.map((artifact) => (
            <DesignProjectCard key={artifact.id} artifact={artifact} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <div className="design-empty-state">
          <Monitor size={32} weight="thin" />
          <strong>还没有设计项目</strong>
          <p>从一段 brief 开始，首个产物会生成在 out/design 目录。</p>
          <button type="button" onClick={onCreate}>
            创建第一个设计
          </button>
        </div>
      )}
    </section>
  );
}

function DesignProjectCard({
  artifact,
  onOpen,
}: {
  artifact: Artifact;
  onOpen: (artifact: Artifact) => void;
}) {
  return (
    <button type="button" className="design-project-card" onClick={() => onOpen(artifact)}>
      <span className="design-project-cover">
        {artifact.kind === "deck" ? (
          <PresentationChart size={30} weight="duotone" />
        ) : (
          <BracketsCurly size={30} weight="duotone" />
        )}
        <em>{artifact.renderer || artifact.ext}</em>
      </span>
      <span className="design-project-copy">
        <strong>{artifact.name}</strong>
        <small>{formatDate(artifact.createdAt)}</small>
        <span>
          <i className={artifact.status} />
          {artifact.kind} · {artifact.status}
        </span>
      </span>
    </button>
  );
}

function DesignSystems({ systems, error }: { systems: DesignSystem[]; error: string }) {
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small>PORTABLE BRAND CONTRACTS</small>
          <h2>设计系统</h2>
          <p>读取内置、全局和工作区 .herdock/design-systems 下的 DESIGN.md 与 tokens.css。</p>
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
              <Palette size={18} />
            </span>
            <span className="design-system-copy">
              <small>{system.category}</small>
              <strong>{system.name}</strong>
              <p>{system.description || "可移植的 HerDock 设计上下文。"}</p>
              <span>
                {scopeLabel(system.scope)}
                {system.hasTokens && <em>tokens.css</em>}
              </span>
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
          <small>REFERENCE MATERIAL</small>
          <h2>素材库</h2>
          <p>当前安全支持 UTF-8 CSS 与 SVG；位图和字体需等多模态附件链路完成后再开放。</p>
        </span>
        <button type="button" disabled={!workspaceReady} onClick={() => void importFiles()}>
          <UploadSimple size={14} />
          导入 CSS / SVG
        </button>
      </div>
      {assets.length ? (
        <div className="design-asset-grid">
          {assets.map((item) => (
            <article key={item.id}>
              {item.mimeType.startsWith("text/css") ? (
                <FileCss size={24} weight="duotone" />
              ) : (
                <ImageSquare size={24} weight="duotone" />
              )}
              <span>
                <strong>{item.displayName}</strong>
                <small>
                  {item.mimeType.split(";")[0]} · {formatBytes(item.sizeBytes)}
                </small>
              </span>
            </article>
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

function securePreviewDocument(html: string): string {
  const policy =
    "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  if (/<html[\s>]/i.test(html))
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

function scopeLabel(scope: string): string {
  if (scope === "workspace") return "工作区";
  if (scope === "global") return "全局";
  return "内置";
}
function viewportSize(viewport: "desktop" | "tablet" | "mobile"): string {
  return viewport === "desktop" ? "1280 × 900" : viewport === "tablet" ? "744 × 1024" : "390 × 844";
}
function viewportLabel(viewport: "desktop" | "tablet" | "mobile"): string {
  return viewport === "desktop"
    ? "桌面预览 1280 × 900"
    : viewport === "tablet"
      ? "平板预览 744 × 1024"
      : "手机预览 390 × 844";
}
function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "排队中",
    starting: "正在启动",
    running: "运行中",
    waiting_approval: "等待审批",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status] || status;
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

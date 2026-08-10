import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowSquareOut,
  BracketsCurly,
  Browser,
  Check,
  DeviceMobile,
  FolderOpen,
  ImageSquare,
  Layout,
  Monitor,
  Palette,
  Play,
  PresentationChart,
  Sparkle,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { hostApi, type Artifact, type DesignSystem } from "../host/client";
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
  { id: "home", label: "开始" },
  { id: "projects", label: "项目" },
  { id: "systems", label: "设计系统" },
  { id: "assets", label: "素材库" },
];

export function DesignView() {
  const {
    allRuns,
    artifacts,
    contextItems,
    designRoute,
    openPath,
    openWorkspacePath,
    providerId,
    refreshPanels,
    run,
    selectRun,
    setDesignRoute,
    skills,
    startDesignRun,
    workspace,
  } = useWorkbench(
    useShallow((state) => ({
      allRuns: state.allRuns,
      artifacts: state.artifacts,
      contextItems: state.contextItems,
      designRoute: state.designRoute,
      openPath: state.openPath,
      openWorkspacePath: state.openWorkspacePath,
      providerId: state.providerId,
      refreshPanels: state.refreshPanels,
      run: state.run,
      selectRun: state.selectRun,
      setDesignRoute: state.setDesignRoute,
      skills: state.skills,
      startDesignRun: state.startDesignRun,
      workspace: state.workspace,
    })),
  );
  const [systems, setSystems] = useState<DesignSystem[]>([]);
  const [systemsError, setSystemsError] = useState("");
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);

  const designs = useMemo(
    () =>
      artifacts.filter(
        (artifact) =>
          artifact.kind !== "file" &&
          artifact.path.startsWith("out/design/") &&
          ["html", "deck-html"].includes(artifact.renderer || ""),
      ),
    [artifacts],
  );

  useEffect(() => {
    let active = true;
    setSystemsError("");
    void hostApi
      .designSystems(workspace?.id)
      .then((items) => active && setSystems(items))
      .catch((error) => active && setSystemsError(String(error)));
    return () => {
      active = false;
    };
  }, [workspace?.id]);

  useEffect(() => {
    if (!selectedArtifact) return;
    const fresh = designs.find((item) => item.id === selectedArtifact.id);
    if (fresh) setSelectedArtifact(fresh);
  }, [designs, selectedArtifact]);

  const openWorkspace = async () => {
    const path = await open({ directory: true, multiple: false, title: "打开设计工作区" });
    if (typeof path === "string") await openWorkspacePath(path);
  };

  if (selectedArtifact) {
    const targetRun = selectedArtifact.runId
      ? allRuns.find((item) => item.id === selectedArtifact.runId)
      : undefined;
    return (
      <DesignStudio
        artifact={selectedArtifact}
        workspaceId={workspace?.id}
        onBack={() => setSelectedArtifact(null)}
        onOpenSource={() => void openPath(selectedArtifact.entryPath || selectedArtifact.path)}
        onContinue={targetRun ? () => void selectRun(targetRun.id) : undefined}
      />
    );
  }

  return (
    <div className="design-surface">
      <header className="design-header">
        <div className="design-brand">
          <span className="design-brand-icon">
            <Palette size={17} weight="duotone" />
          </span>
          <span>
            <strong>设计</strong>
            <small>{workspace?.name || "未打开工作区"}</small>
          </span>
        </div>
        <nav className="design-routes" aria-label="设计工作区导航">
          {ROUTES.map((route) => (
            <button
              key={route.id}
              type="button"
              className={designRoute === route.id ? "active" : ""}
              onClick={() => setDesignRoute(route.id)}
            >
              {route.label}
            </button>
          ))}
        </nav>
        <button type="button" className="design-refresh" onClick={() => void refreshPanels()}>
          <ArrowClockwise size={14} />
          刷新
        </button>
      </header>

      <main className="design-body">
        {!workspace && (
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

        {designRoute === "home" && (
          <DesignHome
            workspaceReady={!!workspace}
            systems={systems}
            skills={skills}
            providerId={providerId}
            designs={designs.slice(0, 4)}
            onCreate={startDesignRun}
            onOpenProject={setSelectedArtifact}
          />
        )}
        {designRoute === "projects" && (
          <DesignProjects
            designs={designs}
            runStatus={run?.status}
            onOpen={setSelectedArtifact}
            onCreate={() => setDesignRoute("home")}
          />
        )}
        {designRoute === "systems" && <DesignSystems systems={systems} error={systemsError} />}
        {designRoute === "assets" && <DesignAssets items={contextItems} />}
      </main>
    </div>
  );
}

function DesignHome({
  workspaceReady,
  systems,
  skills,
  providerId,
  designs,
  onCreate,
  onOpenProject,
}: {
  workspaceReady: boolean;
  systems: DesignSystem[];
  skills: Array<{ id: string; name: string; detail: string }>;
  providerId: string;
  designs: Artifact[];
  onCreate: (input: DesignRunInput) => Promise<void>;
  onOpenProject: (artifact: Artifact) => void;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [systemId, setSystemId] = useState("default");
  const [skillId, setSkillId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const template = TEMPLATES.find((item) => item.id === templateId) || TEMPLATES[0];

  useEffect(() => {
    if (systems.some((system) => system.id === systemId)) return;
    setSystemId(systems[0]?.id || "default");
  }, [systemId, systems]);

  const submit = async () => {
    if (!workspaceReady || !title.trim() || !brief.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({
        title: title.trim(),
        brief: brief.trim(),
        templateLabel: template.label,
        artifactKind: template.artifactKind,
        renderer: template.renderer,
        designSystemId: systemId,
        skillId: skillId || undefined,
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
        <h1>把想法变成可运行的界面</h1>
        <p>选择产物类型和设计系统，由 HerDock Agent 直接生成可预览、可迭代的源文件。</p>
      </section>

      <section className="design-composer-card">
        <div className="design-template-grid">
          {TEMPLATES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={templateId === item.id ? "active" : ""}
                onClick={() => setTemplateId(item.id)}
              >
                <Icon size={18} weight={templateId === item.id ? "duotone" : "regular"} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                {templateId === item.id && <Check size={13} weight="bold" />}
              </button>
            );
          })}
        </div>

        <div className="design-form-grid">
          <label className="design-field title-field">
            <span>项目名称</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：HerDock 产品首页"
              maxLength={80}
            />
          </label>
          <label className="design-field">
            <span>设计系统</span>
            <select value={systemId} onChange={(event) => setSystemId(event.target.value)}>
              {systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name} · {scopeLabel(system.scope)}
                </option>
              ))}
            </select>
          </label>
          <label className="design-field">
            <span>附加技能</span>
            <select value={skillId} onChange={(event) => setSkillId(event.target.value)}>
              <option value="">不额外选择</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="design-brief">
          <span>设计需求</span>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="描述目标用户、页面结构、关键内容、交互和视觉气质……"
            rows={7}
          />
        </label>

        <div className="design-submit-row">
          <span>
            Provider <strong>{providerId}</strong> · 复用当前上下文、技能与 MCP 选择
          </span>
          <button
            type="button"
            disabled={!workspaceReady || !title.trim() || !brief.trim() || submitting}
            onClick={() => void submit()}
          >
            <Play size={14} weight="fill" />
            {submitting ? "正在启动" : "开始设计"}
          </button>
        </div>
      </section>

      {designs.length > 0 && (
        <section className="design-recent">
          <div className="design-section-head">
            <span>
              <strong>最近设计</strong>
              <small>继续预览或进入 Agent 会话迭代</small>
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

function DesignProjects({
  designs,
  runStatus,
  onOpen,
  onCreate,
}: {
  designs: Artifact[];
  runStatus?: string;
  onOpen: (artifact: Artifact) => void;
  onCreate: () => void;
}) {
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small>DESIGN PROJECTS</small>
          <h2>项目</h2>
          <p>每个项目都由 manifest 管理，并保留可继续编辑的 HTML 源文件。</p>
        </span>
        <button type="button" onClick={onCreate}>
          <Sparkle size={14} /> 新建设计
        </button>
      </div>
      {runStatus && ["queued", "starting", "running", "waiting_approval"].includes(runStatus) && (
        <div className="design-run-banner">
          <span className="design-live-dot" />
          设计 Agent 正在运行 ·{" "}
          {runStatus === "waiting_approval" ? "等待审批" : "完成后会自动刷新项目"}
        </div>
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
          <i className={artifact.status} /> {artifact.kind} · {artifact.status}
        </span>
      </span>
      <ArrowSquareOut size={14} />
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
          <p>读取全局目录和工作区 .herdock/design-systems 下的 DESIGN.md 与 tokens.css。</p>
        </span>
      </div>
      {error && <div className="design-inline-error">{error}</div>}
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
}: {
  items: Array<{ id: string; displayName: string; mimeType: string; sourceKind: string }>;
}) {
  const assets = items.filter(
    (item) =>
      item.mimeType.startsWith("image/") ||
      item.mimeType.startsWith("font/") ||
      item.mimeType === "text/css",
  );
  return (
    <section className="design-page-section">
      <div className="design-page-title">
        <span>
          <small>REFERENCE MATERIAL</small>
          <h2>素材库</h2>
          <p>第一阶段复用 HerDock 上下文素材；内容寻址、标签和调色板富化将在后续加入。</p>
        </span>
      </div>
      {assets.length ? (
        <div className="design-asset-grid">
          {assets.map((item) => (
            <article key={item.id}>
              <ImageSquare size={24} weight="duotone" />
              <span>
                <strong>{item.displayName}</strong>
                <small>
                  {item.mimeType} · {item.sourceKind}
                </small>
              </span>
            </article>
          ))}
        </div>
      ) : (
        <div className="design-empty-state small">
          <ImageSquare size={30} weight="thin" />
          <strong>暂无设计素材</strong>
          <p>在右侧“上下文”中导入图片、字体或 CSS 后会显示在这里。</p>
        </div>
      )}
    </section>
  );
}

function DesignStudio({
  artifact,
  workspaceId,
  onBack,
  onOpenSource,
  onContinue,
}: {
  artifact: Artifact;
  workspaceId?: string;
  onBack: () => void;
  onOpenSource: () => void;
  onContinue?: () => void;
}) {
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setError("");
    setPreview("");
    void hostApi
      .artifactPreview(workspaceId, artifact.entryPath || artifact.path)
      .then((result) => active && setPreview(securePreviewDocument(result.html)))
      .catch((reason) => active && setError(String(reason)));
    return () => {
      active = false;
    };
  }, [artifact.entryPath, artifact.path, version, workspaceId]);

  return (
    <div className="design-studio">
      <header className="design-studio-head">
        <button type="button" className="studio-back" onClick={onBack}>
          <ArrowLeft size={14} /> 项目
        </button>
        <span className="studio-title">
          <strong>{artifact.name}</strong>
          <small>{artifact.path}</small>
        </span>
        <div className="studio-viewports">
          {(["desktop", "tablet", "mobile"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={viewport === item ? "active" : ""}
              onClick={() => setViewport(item)}
              title={item}
            >
              {item === "mobile" ? <DeviceMobile size={14} /> : <Monitor size={14} />}
            </button>
          ))}
        </div>
        <div className="studio-actions">
          <button type="button" onClick={() => setVersion((value) => value + 1)}>
            <ArrowClockwise size={13} />
            刷新
          </button>
          <button type="button" onClick={onOpenSource}>
            <BracketsCurly size={13} />
            源文件
          </button>
          <button type="button" className="primary" disabled={!onContinue} onClick={onContinue}>
            <Sparkle size={13} weight="fill" />
            Agent 迭代
          </button>
        </div>
      </header>
      <main className="design-preview-stage">
        <div className={`design-preview-frame ${viewport}`}>
          {error ? (
            <div className="design-preview-error">{error}</div>
          ) : preview ? (
            <iframe
              title={`${artifact.name} 预览`}
              srcDoc={preview}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="design-preview-loading">正在加载安全预览…</div>
          )}
        </div>
      </main>
      <footer className="design-studio-foot">
        <span>
          <i className={artifact.status} /> {artifact.status}
        </span>
        <span>隔离预览 · 无 Tauri 能力 · 网络默认禁用</span>
      </footer>
    </div>
  );
}

function securePreviewDocument(html: string): string {
  const policy =
    "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  }
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

function scopeLabel(scope: string): string {
  if (scope === "workspace") return "工作区";
  if (scope === "global") return "全局";
  return "内置";
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

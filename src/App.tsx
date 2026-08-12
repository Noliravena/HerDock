import { lazy, Suspense, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { RUN_STATUS_LABELS, type RunStatus } from "@her-dock/agent-protocol";
import { Browser, ChatCircleDots, Code, GitDiff, TerminalWindow } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import {
  IconClose,
  IconMaximize,
  IconMinimize,
  IconMore,
  IconPanelRight,
  IconPlus,
  IconWinClose,
} from "./components/Icons";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Thread } from "./components/Thread";
import { NewTabPage } from "./components/NewTabPage";
import { BrandMark } from "./components/BrandMark";
import { isConsoleView, useWorkbench, type WorkTab } from "./store/workbench";

const ActivityView = lazy(() =>
  import("./components/ActivityView").then((module) => ({ default: module.ActivityView })),
);
const ApprovalsView = lazy(() =>
  import("./components/ApprovalsView").then((module) => ({ default: module.ApprovalsView })),
);
const UsageView = lazy(() =>
  import("./components/UsageView").then((module) => ({ default: module.UsageView })),
);
const SkillsView = lazy(() =>
  import("./components/SkillsView").then((module) => ({ default: module.SkillsView })),
);
const McpView = lazy(() =>
  import("./components/McpView").then((module) => ({ default: module.McpView })),
);
const ArtifactsView = lazy(() =>
  import("./components/ArtifactsView").then((module) => ({ default: module.ArtifactsView })),
);
const DiffView = lazy(() =>
  import("./components/DiffView").then((module) => ({ default: module.DiffView })),
);
const EditorPane = lazy(() =>
  import("./components/EditorPane").then((module) => ({ default: module.EditorPane })),
);
const SettingsModal = lazy(() =>
  import("./components/SettingsModal").then((module) => ({ default: module.SettingsModal })),
);
const TerminalPane = lazy(() =>
  import("./components/TerminalPane").then((module) => ({ default: module.TerminalPane })),
);
const BrowserView = lazy(() =>
  import("./components/BrowserView").then((module) => ({ default: module.BrowserView })),
);
const DesignView = lazy(() =>
  import("./components/DesignView").then((module) => ({ default: module.DesignView })),
);

export function App() {
  const {
    centerView,
    fileContent,
    hostOnline,
    init,
    openFile,
    openWorkspacePath,
    paletteOpen,
    platform,
    rightOpen,
    setFileContent,
    settingsOpen,
    activeTab,
    tabs,
    appSurface,
  } = useWorkbench(
    useShallow((state) => ({
      centerView: state.centerView,
      fileContent: state.fileContent,
      hostOnline: state.hostOnline,
      init: state.init,
      openFile: state.openFile,
      openWorkspacePath: state.openWorkspacePath,
      paletteOpen: state.paletteOpen,
      platform: state.platform,
      rightOpen: state.rightOpen,
      setFileContent: state.setFileContent,
      settingsOpen: state.settingsOpen,
      activeTab: state.activeTab,
      tabs: state.tabs,
      appSurface: state.appSurface,
    })),
  );

  useEffect(() => {
    void init();
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        useWorkbench.getState().togglePalette();
      } else if (key === "t") {
        e.preventDefault();
        useWorkbench.getState().createTab();
      } else if (key === "s") {
        e.preventDefault();
        void useWorkbench.getState().saveFile();
      } else if (key === "n") {
        e.preventDefault();
        void useWorkbench.getState().newSession();
      } else if (key === "o") {
        e.preventDefault();
        void open({ directory: true, multiple: false, title: "打开本地工作区" }).then((path) => {
          if (typeof path === "string") void useWorkbench.getState().openWorkspacePath(path);
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        void useWorkbench.getState().sendPrompt();
      } else if (e.key === ",") {
        e.preventDefault();
        useWorkbench.getState().setSettingsOpen(true);
      } else if (e.key === "`") {
        e.preventDefault();
        useWorkbench.getState().setCenterView("terminal");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [init]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop" && event.payload.paths.length)
          void useWorkbench.getState().importContextPaths(event.payload.paths);
      })
      .then((stop) => {
        unlisten = stop;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, []);

  const openWorkspace = async () => {
    const path = await open({ directory: true, multiple: false, title: "打开本地工作区" });
    if (typeof path === "string") await openWorkspacePath(path);
  };
  const activeWorkTab = tabs.find((tab) => tab.key === activeTab);
  // Console destinations own the whole centre pane: no work tabs, no side panel.
  const onConsole = isConsoleView(centerView);

  return (
    <div className="app-root">
      <div className="frame">
        {platform.windowControl === "windows" && <WinChrome />}

        <div className="body-row">
          <Sidebar onOpenWorkspace={openWorkspace} />

          <section className={`center ${appSurface === "design" ? "design-center" : ""}`}>
            {appSurface === "design" && (
              <Suspense fallback={<ViewLoading />}>
                <DesignView />
              </Suspense>
            )}

            {appSurface === "workbench" && onConsole && (
              <Suspense fallback={<ViewLoading />}>
                {centerView === "activity" && <ActivityView />}
                {centerView === "approvals" && <ApprovalsView />}
                {centerView === "usage" && <UsageView />}
                {centerView === "skills" && <SkillsView />}
                {centerView === "mcp" && <McpView />}
                {centerView === "artifacts" && <ArtifactsView />}
              </Suspense>
            )}

            {appSurface === "workbench" && !onConsole && (
              <>
                <TabBar />

                {centerView === "chat" && <ChatView />}

                {centerView === "code" && (
                  <Suspense fallback={<ViewLoading />}>
                    <EditorPane
                      path={openFile}
                      value={fileContent}
                      onChange={setFileContent}
                      readOnly={!hostOnline && !!openFile}
                    />
                  </Suspense>
                )}

                {centerView === "diff" && (
                  <Suspense fallback={<ViewLoading />}>
                    <DiffView />
                  </Suspense>
                )}
                {centerView === "terminal" && (
                  <Suspense fallback={<ViewLoading />}>
                    <TerminalPane />
                  </Suspense>
                )}
                {centerView === "new-tab" && activeWorkTab && (
                  <NewTabPage tabKey={activeWorkTab.key} />
                )}
                {centerView === "browser" && activeWorkTab?.browserId && (
                  <Suspense fallback={<ViewLoading />}>
                    <BrowserView
                      browserId={activeWorkTab.browserId}
                      initialUrl={activeWorkTab.url || "https://www.bing.com/"}
                    />
                  </Suspense>
                )}
              </>
            )}
          </section>

          {appSurface === "workbench" && !onConsole && rightOpen && <RightPanel />}
        </div>

        <StatusBar />
      </div>

      {paletteOpen && <CommandPalette onOpenWorkspace={openWorkspace} />}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      )}
    </div>
  );
}

function ViewLoading() {
  return (
    <div className="view">
      <div className="empty-hint">正在加载视图...</div>
    </div>
  );
}

function ChatView() {
  const events = useWorkbench((state) => state.events);
  const openPath = useWorkbench((state) => state.openPath);
  const onOpenFile = useCallback((path: string) => void openPath(path), [openPath]);
  return (
    <div className="view">
      <ChatHeader />
      <div className="chat-scroll">
        <Thread events={events} onOpenFile={onOpenFile} />
      </div>
      <Composer />
    </div>
  );
}

function WinChrome() {
  const workspaceName = useWorkbench((state) => state.workspace?.name);
  return (
    <div className="chrome-win" data-tauri-drag-region>
      <div className="title" data-tauri-drag-region>
        <BrandMark className="mark" />
        <span>HerDock · 行知</span>
        <span className="sub">— {workspaceName || "未打开工作区"}</span>
      </div>
      <div className="caption-buttons">
        <button type="button" title="最小化" onClick={() => void getCurrentWindow().minimize()}>
          <IconMinimize />
        </button>
        <button
          type="button"
          title="最大化"
          onClick={() => void getCurrentWindow().toggleMaximize()}
        >
          <IconMaximize />
        </button>
        <button
          type="button"
          className="close"
          title="关闭"
          onClick={() => void getCurrentWindow().close()}
        >
          <IconWinClose />
        </button>
      </div>
    </div>
  );
}

function TabBar() {
  const {
    activeTab,
    closeTab,
    createTab,
    dirty,
    openFile,
    run,
    session,
    setActiveTab,
    tabs,
    toggleRight,
  } = useWorkbench(
    useShallow((state) => ({
      activeTab: state.activeTab,
      closeTab: state.closeTab,
      createTab: state.createTab,
      dirty: state.dirty,
      openFile: state.openFile,
      run: state.run,
      session: state.session,
      setActiveTab: state.setActiveTab,
      tabs: state.tabs,
      toggleRight: state.toggleRight,
    })),
  );
  const tone = run
    ? ["running", "starting"].includes(run.status)
      ? "live"
      : run.status === "completed"
        ? "ok"
        : ["failed", "cancelled"].includes(run.status)
          ? "bad"
          : ""
    : "idle";

  return (
    <div className="tabs">
      <div className="tab-strip">
        {tabs.map((t) => {
          const label = t.key === "chat" ? session?.title || "会话" : t.label;
          const tabDirty = t.view === "code" && t.path === openFile && dirty;
          return (
            <div
              key={t.key}
              className={`tab ${activeTab === t.key ? "active" : ""}`}
              onClick={() => setActiveTab(t.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setActiveTab(t.key)}
              title={t.path || label}
            >
              <span className="tab-icon">
                <WorkTabIcon tab={t} />
              </span>
              <span className="tab-label">{label}</span>
              {tabDirty && <span className="dirty" />}
              {t.closable && (
                <button
                  type="button"
                  className="close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.key);
                  }}
                >
                  <IconClose />
                </button>
              )}
            </div>
          );
        })}
        <button type="button" className="tab-add" title="新建标签" onClick={createTab}>
          <IconPlus />
        </button>
      </div>

      <div className="tabs-right">
        <span className={`run-pill ${tone}`}>
          <i />
          {run
            ? `${run.id} · ${run.planProgress || RUN_STATUS_LABELS[run.status as RunStatus] || run.status}`
            : "idle"}
        </span>
        <button type="button" className="panel-toggle" onClick={toggleRight} title="切换右侧栏">
          <IconPanelRight />
        </button>
      </div>
    </div>
  );
}

function WorkTabIcon({ tab }: { tab: WorkTab }) {
  if (tab.path) return tab.icon || <Code size={12} />;
  switch (tab.view) {
    case "chat":
      return <ChatCircleDots size={12} />;
    case "diff":
      return <GitDiff size={12} />;
    case "browser":
      return <Browser size={12} />;
    case "terminal":
      return <TerminalWindow size={12} />;
    case "code":
      return <Code size={12} />;
    default:
      return <IconPlus size={11} />;
  }
}

function ChatHeader() {
  const {
    cancelRun,
    continueRun,
    platform,
    providerId,
    run,
    session,
    setSettingsOpen,
    togglePalette,
    workspace,
  } = useWorkbench(
    useShallow((state) => ({
      cancelRun: state.cancelRun,
      continueRun: state.continueRun,
      platform: state.platform,
      providerId: state.providerId,
      run: state.run,
      session: state.session,
      setSettingsOpen: state.setSettingsOpen,
      togglePalette: state.togglePalette,
      workspace: state.workspace,
    })),
  );
  const started = run ? new Date(run.createdAt || "") : null;
  const startedLabel =
    started && !Number.isNaN(started.getTime())
      ? started.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "—";
  const statusLabel = run ? RUN_STATUS_LABELS[run.status as RunStatus] || run.status : "尚未运行";
  const running =
    !!run && ["queued", "starting", "running", "waiting_approval"].includes(run.status);

  return (
    <div className="chat-head">
      <div className="head-id">
        <div className="chat-title-row">
          <span className="chat-title">{session?.title || "新会话"}</span>
          <span className={`status-chip ${run?.status || "idle"}`}>{statusLabel}</span>
        </div>
        <div className="chat-meta">
          <span>{run?.id || "未开始"}</span>
          <span>{workspace?.name || "未打开工作区"}</span>
          <span>开始于 {startedLabel}</span>
          <span>{providerId}</span>
        </div>
      </div>
      <div className="head-actions">
        <button type="button" className="ghost-btn" onClick={togglePalette}>
          命令
          <span className="kbd">{platform.commandHint}</span>
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={!running}
          onClick={() => void cancelRun()}
        >
          <span className="stop-glyph" />
          停止运行
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={!run}
          onClick={() => void continueRun()}
          title="把磁盘上的改动作为新的起点继续运行"
        >
          采纳并继续
        </button>
        <button
          type="button"
          className="ghost-btn square"
          title="设置"
          onClick={() => setSettingsOpen(true)}
        >
          <IconMore />
        </button>
      </div>
    </div>
  );
}

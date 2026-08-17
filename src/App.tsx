import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { LEFT_RAIL } from "./lib/layout";
import { Toasts } from "./components/Toasts";
import { PanelSash } from "./components/PanelSash";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { RUN_STATUS_LABELS, type RunStatus } from "@her-dock/agent-protocol";
import { Browser, Code, FolderSimple, TerminalWindow } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { GenerationLoader } from "./components/GenerationLoader";
import { IconClose, IconMaximize, IconMinimize, IconPlus, IconWinClose } from "./components/Icons";
import { Sidebar } from "./components/Sidebar";
import { FilesPanel } from "./components/FilesPanel";
import { Thread, PlanStatusBar, ChatApprovalBar, countChatMessages } from "./components/Thread";
import { ThreadViewport } from "./components/ScrollAnchor";
import { NewTabPage } from "./components/NewTabPage";
import { isConsoleView, useWorkbench, type WorkTab } from "./store/workbench";
import { parseSettingsHash } from "./lib/settingsCatalog";
import { runIsBusy } from "./lib/runBudget";

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
const FilePreviewPane = lazy(() =>
  import("./components/FilePreviewPane").then((module) => ({ default: module.FilePreviewPane })),
);
const SettingsModal = lazy(() =>
  import("./components/SettingsModal").then((module) => ({ default: module.SettingsModal })),
);
const SetupWizard = lazy(() =>
  import("./components/SetupWizard").then((module) => ({ default: module.SetupWizard })),
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !==
      null
  );
}

export function App() {
  const {
    centerView,
    fileContent,
    filePreview,
    hostOnline,
    init,
    leftOpen,
    leftWidth,
    openFile,
    openWorkspacePath,
    paletteOpen,
    platform,
    reflowLayout,
    setFileContent,
    settingsOpen,
    setupWizardOpen,
    settings,
    activeTab,
    tabs,
    appSurface,
    bottomHeight,
    bottomOpen,
    filesOpen,
    filesWidth,
  } = useWorkbench(
    useShallow((state) => ({
      centerView: state.centerView,
      fileContent: state.fileContent,
      filePreview: state.filePreview,
      hostOnline: state.hostOnline,
      init: state.init,
      leftOpen: state.leftOpen,
      leftWidth: state.leftWidth,
      openFile: state.openFile,
      openWorkspacePath: state.openWorkspacePath,
      paletteOpen: state.paletteOpen,
      platform: state.platform,
      reflowLayout: state.reflowLayout,
      setFileContent: state.setFileContent,
      settingsOpen: state.settingsOpen,
      setupWizardOpen: state.setupWizardOpen,
      settings: state.settings,
      activeTab: state.activeTab,
      tabs: state.tabs,
      appSurface: state.appSurface,
      bottomHeight: state.bottomHeight,
      bottomOpen: state.bottomOpen,
      filesOpen: state.filesOpen,
      filesWidth: state.filesWidth,
    })),
  );
  const [terminalMounted, setTerminalMounted] = useState(bottomOpen);
  useEffect(() => {
    if (bottomOpen) setTerminalMounted(true);
  }, [bottomOpen]);

  useEffect(() => {
    // Theme itself is applied by the store (localStorage + system preference);
    // the shell class only marks which chrome we render.
    document.documentElement.classList.add("grok-ui");
  }, []);

  useEffect(() => {
    const applyHash = () => {
      const parsed = parseSettingsHash(window.location.hash);
      if (parsed) useWorkbench.getState().openSettings({ tab: parsed.tab, focus: parsed.focus });
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    void init();
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        useWorkbench.getState().togglePalette();
      } else if (key === "o") {
        e.preventDefault();
        void open({ directory: true, multiple: false, title: "打开本地工作区" }).then((path) => {
          if (typeof path === "string") void useWorkbench.getState().openWorkspacePath(path);
        });
      } else if (e.key === ",") {
        e.preventDefault();
        useWorkbench.getState().setSettingsOpen(true);
      } else if (key === "b") {
        e.preventDefault();
        useWorkbench.getState().toggleLeft();
      } else if (useWorkbench.getState().appSurface !== "workbench") {
        if (
          ["t", "s", "n", "`"].includes(key) ||
          (key === "enter" && !isEditableTarget(e.target))
        ) {
          e.preventDefault();
        }
        return;
      } else if (key === "t") {
        e.preventDefault();
        useWorkbench.getState().createTab();
      } else if (key === "w") {
        e.preventDefault();
        const store = useWorkbench.getState();
        const tab = store.tabs.find((item) => item.key === store.activeTab);
        if (tab?.closable) store.closeTab(tab.key);
      } else if (key === "s") {
        e.preventDefault();
        void useWorkbench.getState().saveFile();
      } else if (key === "n") {
        e.preventDefault();
        void useWorkbench.getState().newSession();
      } else if (key === "enter") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        const store = useWorkbench.getState();
        // On the approvals console the same chord confirms the highlighted request.
        const pending =
          store.centerView === "approvals"
            ? store.approvals.find((item) => item.approvalId === store.selectedApprovalId) ||
              store.approvals[0]
            : undefined;
        if (pending) void store.resolveApproval(pending.approvalId, store.approvalScope);
        else void store.sendPrompt();
      } else if (key === "`") {
        e.preventDefault();
        useWorkbench.getState().toggleBottom();
      } else if (key === "f" && e.shiftKey) {
        if (useWorkbench.getState().centerView === "chat") {
          e.preventDefault();
          useWorkbench.getState().toggleFiles();
        }
      } else if (key === "f" && useWorkbench.getState().centerView === "chat") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("herdock:find-in-chat"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [init]);

  useEffect(() => {
    const onResize = () => useWorkbench.getState().reflowLayout();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [reflowLayout]);

  useEffect(() => {
    let last: string | null = null;
    return useWorkbench.subscribe((state) => {
      if (state.error && state.error !== last) {
        last = state.error;
        useWorkbench.getState().pushToast({
          kind: "error",
          title: "出错了",
          detail: state.error,
        });
      } else if (!state.error) {
        last = null;
      }
    });
  }, []);

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
  // Console destinations own the whole centre pane: no work tabs.
  const onConsole = isConsoleView(centerView);

  return (
    <div
      className={`app-root simple-shell ${
        platform.windowControl === "macos" ? "is-mac" : "is-win"
      }`}
    >
      <div className="frame">
        {platform.windowControl === "windows" && <WinChrome />}

        {platform.windowControl === "macos" && !leftOpen && (
          <div className="mac-lights mac-lights-overlay" data-tauri-drag-region>
            <span className="traffic">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}

        <div
          className={`body-row ${leftOpen ? "" : "left-collapsed"}${
            appSurface === "workbench" && centerView === "chat" && filesOpen
              ? " has-files-rail"
              : ""
          }`}
          style={
            {
              "--left-w": `${leftOpen ? leftWidth : LEFT_RAIL}px`,
              "--files-w": `${filesWidth}px`,
            } as CSSProperties
          }
        >
          <Sidebar onOpenWorkspace={openWorkspace} />

          <section className={`center ${appSurface === "design" ? "design-center" : ""}`}>
            {appSurface === "design" && (
              <Suspense fallback={<ViewLoading />}>
                <DesignView />
              </Suspense>
            )}

            {appSurface === "workbench" && onConsole && (
              <Suspense fallback={<ViewLoading />}>
                {(centerView === "activity" || centerView === "history") && <ActivityView />}
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
                <div className="center-stack">
                  <div className="center-main">
                    {centerView === "chat" && <SimpleChat />}

                    {centerView === "code" && (
                      <Suspense fallback={<ViewLoading />}>
                        {filePreview ? (
                          <FilePreviewPane />
                        ) : (
                          <EditorPane
                            path={openFile}
                            value={fileContent}
                            onChange={setFileContent}
                            readOnly={!hostOnline && !!openFile}
                          />
                        )}
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
                  </div>
                  {centerView !== "terminal" && (bottomOpen || terminalMounted) && (
                    <div
                      className={`bottom-drawer ${bottomOpen ? "open" : ""}`}
                      style={{ height: bottomOpen ? bottomHeight : 0 }}
                    >
                      {bottomOpen && (
                        <PanelSash
                          label="调节终端高度"
                          orientation="horizontal"
                          invert
                          value={bottomHeight}
                          onChange={useWorkbench.getState().setBottomHeight}
                          onReset={useWorkbench.getState().resetBottomHeight}
                        />
                      )}
                      <div className="bottom-drawer-body" style={{ height: bottomHeight }}>
                        <Suspense fallback={<ViewLoading />}>
                          <TerminalPane />
                        </Suspense>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          {appSurface === "workbench" && centerView === "chat" && filesOpen && <FilesPanel />}
        </div>
      </div>

      <Toasts />
      {paletteOpen && <CommandPalette onOpenWorkspace={openWorkspace} />}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      )}
      {hostOnline && (settings.setupComplete === false || setupWizardOpen) && (
        <Suspense fallback={null}>
          <SetupWizard />
        </Suspense>
      )}
    </div>
  );
}

function ViewLoading() {
  // assistant-ui loading-state element: the pixel matrix keeps time while a
  // lazily loaded view chunk arrives.
  return (
    <div className="view view-loading">
      <GenerationLoader label="正在加载视图" />
    </div>
  );
}

function SimpleChat() {
  const events = useWorkbench((state) => state.events);
  const hostOnline = useWorkbench((state) => state.hostOnline);
  const run = useWorkbench((state) => state.run);
  const openPath = useWorkbench((state) => state.openPath);
  const onOpenFile = useCallback((path: string) => void openPath(path), [openPath]);
  const empty = events.length === 0 && !run;
  const messageCount = useMemo(() => countChatMessages(events), [events]);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  useEffect(() => {
    const onFind = () => setFindOpen(true);
    window.addEventListener("herdock:find-in-chat", onFind);
    return () => window.removeEventListener("herdock:find-in-chat", onFind);
  }, []);

  return (
    <div className={`simple-chat ${empty ? "is-empty" : ""}`}>
      {empty ? (
        <div className="g-welcome">
          <div className="g-wordmark">
            <span className="g-wordmark-name">行知</span>
            <span className="g-wordmark-badge">LOCAL</span>
          </div>
          <Composer />
        </div>
      ) : (
        <>
          <GrokChatHead />
          {!hostOnline && (
            <div className="conn-banner" role="status">
              <span className="conn-dot" aria-hidden="true" />
              与本地核心的连接已断开，发送与文件操作暂不可用。
            </div>
          )}
          {findOpen && (
            <ChatFindBar
              query={findQuery}
              index={findIndex}
              onQuery={(value) => {
                setFindQuery(value);
                setFindIndex(0);
              }}
              onIndex={setFindIndex}
              onClose={() => {
                setFindOpen(false);
                setFindQuery("");
                setFindIndex(0);
              }}
            />
          )}
          <PlanStatusBar events={events} />
          <ChatApprovalBar />
          <ThreadViewport pinKey={events.length} messageCount={messageCount}>
            <Thread
              events={events}
              onOpenFile={onOpenFile}
              findQuery={findQuery}
              findIndex={findIndex}
            />
          </ThreadViewport>
          <Composer />
        </>
      )}
    </div>
  );
}

function GrokChatHead() {
  const {
    allRuns,
    beginRenameSession,
    continueRun,
    forkSession,
    providerId,
    renamingSessionId,
    renameSession,
    run,
    session,
    setCenterView,
    workspace,
  } = useWorkbench(
    useShallow((state) => ({
      allRuns: state.allRuns,
      beginRenameSession: state.beginRenameSession,
      continueRun: state.continueRun,
      forkSession: state.forkSession,
      providerId: state.providerId,
      renamingSessionId: state.renamingSessionId,
      renameSession: state.renameSession,
      run: state.run,
      session: state.session,
      setCenterView: state.setCenterView,
      workspace: state.workspace,
    })),
  );
  const started = run ? new Date(run.createdAt || "") : null;
  const startedLabel =
    started && !Number.isNaN(started.getTime())
      ? started.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "—";
  const statusLabel = run ? RUN_STATUS_LABELS[run.status as RunStatus] || run.status : "尚未运行";
  const otherLive = allRuns.filter(
    (item) => item.sessionId !== session?.id && runIsBusy(item),
  ).length;

  return (
    <header className="g-chat-head stacked">
      <div className="g-chat-row">
        {session && renamingSessionId === session.id ? (
          <input
            className="g-chat-title-input"
            defaultValue={session.title}
            autoFocus
            aria-label="会话名称"
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next && next !== session.title) void renameSession(session.id, next);
              else beginRenameSession(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                (event.target as HTMLInputElement).blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                beginRenameSession(null);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="g-chat-title"
            title="双击重命名"
            onDoubleClick={() => session && beginRenameSession(session.id)}
            onKeyDown={(event) => {
              if (event.key === "F2" && session) {
                event.preventDefault();
                beginRenameSession(session.id);
              }
            }}
          >
            {session?.title || "新会话"}
          </button>
        )}
        <span className="g-chat-grow" />
        <button
          type="button"
          className="g-chat-continue"
          disabled={!session}
          title="复制当前对话到新会话，原会话不受影响"
          onClick={() => void forkSession()}
        >
          分叉
        </button>
        <button
          type="button"
          className="g-chat-continue"
          disabled={!run}
          title="把磁盘上的改动作为新的起点继续运行"
          onClick={() => void continueRun()}
        >
          采纳并继续
        </button>
      </div>
      <div className="g-chat-row">
        <span className={`status-chip ${run?.status || "idle"}`}>{statusLabel}</span>
        <span className="g-chat-meta">
          {[run?.id || "未开始", workspace?.name || "未打开工作区", startedLabel, providerId].join(
            " · ",
          )}
        </span>
        {otherLive > 0 && (
          <button type="button" className="g-chat-others" onClick={() => setCenterView("activity")}>
            另有 {otherLive} 个会话在运行
          </button>
        )}
      </div>
    </header>
  );
}

function ChatFindBar({
  query,
  index,
  onQuery,
  onIndex,
  onClose,
}: {
  query: string;
  index: number;
  onQuery: (value: string) => void;
  onIndex: (value: number) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const events = useWorkbench((state) => state.events);
  const hits = countFindHits(events, query);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (hits === 0) return;
    if (index >= hits) onIndex(0);
  }, [hits, index, onIndex]);
  return (
    <div className="chat-find">
      <input
        ref={inputRef}
        value={query}
        placeholder="在对话中查找"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (!hits) return;
            const step = event.shiftKey ? -1 : 1;
            onIndex((index + step + hits) % hits);
          }
        }}
      />
      <span className="chat-find-count">
        {query.trim() ? `${hits ? index + 1 : 0}/${hits}` : ""}
      </span>
      <button type="button" disabled={!hits} onClick={() => onIndex((index - 1 + hits) % hits)}>
        上一条
      </button>
      <button type="button" disabled={!hits} onClick={() => onIndex((index + 1) % hits)}>
        下一条
      </button>
      <button type="button" onClick={onClose}>
        关闭
      </button>
    </div>
  );
}

function countFindHits(events: { type: string; text?: string }[], query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  return events.filter(
    (event) => event.type === "message.user" && (event.text || "").toLowerCase().includes(needle),
  ).length;
}

function WinChrome() {
  return (
    <div className="chrome-win" data-tauri-drag-region>
      <div className="title" data-tauri-drag-region />
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
    cancelRun,
    closeTab,
    createTab,
    dirty,
    openFile,
    run,
    session,
    bottomOpen,
    platform,
    queue,
    queueOpen,
    filesOpen,
    setActiveTab,
    tabs,
    toggleBottom,
    toggleFiles,
    toggleQueue,
  } = useWorkbench(
    useShallow((state) => ({
      activeTab: state.activeTab,
      bottomOpen: state.bottomOpen,
      cancelRun: state.cancelRun,
      closeTab: state.closeTab,
      createTab: state.createTab,
      dirty: state.dirty,
      openFile: state.openFile,
      platform: state.platform,
      queue: state.queue,
      queueOpen: state.queueOpen,
      run: state.run,
      session: state.session,
      filesOpen: state.filesOpen,
      setActiveTab: state.setActiveTab,
      tabs: state.tabs,
      toggleBottom: state.toggleBottom,
      toggleFiles: state.toggleFiles,
      toggleQueue: state.toggleQueue,
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
  const running =
    !!run && ["queued", "starting", "running", "waiting_approval"].includes(run.status);

  return (
    <div className="tabs grok-tabs" data-tauri-drag-region>
      <div className="tab-strip" role="tablist" aria-label="工作标签">
        {tabs.map((t) => {
          const label = t.key === "chat" ? session?.title || "会话" : t.label;
          const tabDirty = t.view === "code" && t.path === openFile && dirty;
          const showIcon = !(t.view === "chat" || t.view === "diff");
          return (
            <div
              key={t.key}
              className={`tab ${activeTab === t.key ? "active" : ""}`}
              onClick={() => setActiveTab(t.key)}
              role="tab"
              aria-selected={activeTab === t.key}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setActiveTab(t.key)}
              onMouseDown={(e) => {
                if (e.button !== 1 || !t.closable) return;
                e.preventDefault();
                closeTab(t.key);
              }}
              onAuxClick={(e) => {
                if (e.button !== 1 || !t.closable) return;
                e.preventDefault();
                closeTab(t.key);
              }}
              title={t.path || label}
            >
              {showIcon && (
                <span className="tab-icon">
                  <WorkTabIcon tab={t} compact />
                </span>
              )}
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
        <div className="run-queue-wrap">
          {queueOpen && (
            <div className="queue-pop">
              <header>
                运行队列
                <span className="n">{queue.length}</span>
              </header>
              {queue.map((q) => (
                <div className="queue-row" key={q.runId}>
                  <span className={`run-dot ${q.status}`} />
                  <div>
                    <div className="name">{q.name}</div>
                    <div className="meta">{q.meta}</div>
                  </div>
                </div>
              ))}
              {!queue.length && <div className="empty-hint">队列为空。</div>}
            </div>
          )}
          <button
            type="button"
            className={`run-pill ${tone}`}
            onClick={toggleQueue}
            title="运行队列"
          >
            <i />
            {run ? RUN_STATUS_LABELS[run.status as RunStatus] || run.status : "就绪"}
            {queue.length > 0 ? ` · ${queue.length}` : ""}
          </button>
        </div>
        {running && (
          <button type="button" className="simple-stop" onClick={() => void cancelRun()}>
            停止
          </button>
        )}
        <button
          type="button"
          className={`panel-toggle ${filesOpen ? "on" : ""}`}
          onClick={toggleFiles}
          title={filesOpen ? "收起文件面板 · Ctrl Shift F" : "展开文件面板 · Ctrl Shift F"}
          aria-pressed={filesOpen}
        >
          <FolderSimple size={14} />
        </button>
        <button
          type="button"
          className={`panel-toggle ${bottomOpen ? "on" : ""}`}
          onClick={toggleBottom}
          title={
            bottomOpen
              ? `收起终端 · ${platform.modifierKey} \``
              : `打开终端 · ${platform.modifierKey} \``
          }
          aria-pressed={bottomOpen}
        >
          <TerminalWindow size={14} />
        </button>
      </div>
    </div>
  );
}

function WorkTabIcon({ tab, compact }: { tab: WorkTab; compact?: boolean }) {
  if (compact && (tab.view === "chat" || tab.view === "diff")) return null;
  if (tab.path || tab.view === "code") return <Code size={13} />;
  switch (tab.view) {
    case "browser":
      return <Browser size={13} />;
    case "terminal":
      return <TerminalWindow size={13} />;
    default:
      return <IconPlus size={11} />;
  }
}

import { useEffect } from "react";
import { RUN_STATUS_LABELS, type RunStatus } from "@her-dock/agent-protocol";
import { ActivityView } from "./components/ActivityView";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { DiffView } from "./components/DiffView";
import { EditorPane } from "./components/EditorPane";
import {
  IconClose,
  IconLock,
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
import { useWorkbench } from "./store/workbench";

export function App() {
  const s = useWorkbench();

  useEffect(() => {
    void s.init();
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        useWorkbench.getState().togglePalette();
      } else if (key === "s") {
        e.preventDefault();
        void useWorkbench.getState().saveFile();
      } else if (key === "n") {
        e.preventDefault();
        void useWorkbench.getState().newSession();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void useWorkbench.getState().sendPrompt();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openWorkspace = () => {
    const path = window.prompt(
      "输入本地工作区绝对路径（Host 将挂载该目录）",
      s.workspace?.rootPath || "",
    );
    if (path) void s.openWorkspacePath(path);
  };

  return (
    <div className="app-root">
      <div className="frame">
        {s.platform.chrome === "web" && <WebChrome />}
        {s.platform.chrome === "win" && <WinChrome />}

        <div className="body-row">
          <Sidebar onOpenWorkspace={openWorkspace} />

          <section className="center">
            <TabBar />

            {s.centerView === "chat" && (
              <div className="view">
                <ChatHeader />
                <div className="chat-scroll">
                  <Thread events={s.events} onOpenFile={(p) => void s.openPath(p)} />
                </div>
                <Composer />
              </div>
            )}

            {s.centerView === "code" && (
              <EditorPane
                path={s.openFile}
                value={s.fileContent}
                onChange={s.setFileContent}
                readOnly={!s.hostOnline && !!s.openFile}
              />
            )}

            {s.centerView === "diff" && <DiffView />}
            {s.centerView === "activity" && <ActivityView />}
          </section>

          {s.rightOpen && <RightPanel />}
        </div>

        <StatusBar />
      </div>

      {s.paletteOpen && <CommandPalette onOpenWorkspace={openWorkspace} />}
    </div>
  );
}

function WebChrome() {
  const s = useWorkbench();
  const slug = s.workspace?.name || "workspace";
  return (
    <div className="chrome-web">
      <span className="traffic">
        <i />
        <i />
        <i />
      </span>
      <div className="omnibox">
        <IconLock />
        <span>app.xingzhi.work/w/{slug}</span>
      </div>
      <div className="chrome-spacer">{s.hostOnline ? "host 127.0.0.1:17890" : "offline fixture"}</div>
    </div>
  );
}

function WinChrome() {
  const s = useWorkbench();
  return (
    <div className="chrome-win">
      <div className="title">
        <span className="mark">行</span>
        <span>行知 Agent 工作台</span>
        <span className="sub">— {s.workspace?.name || "未打开工作区"}</span>
      </div>
      <div className="caption-buttons">
        <button type="button" title="最小化">
          <IconMinimize />
        </button>
        <button type="button" title="最大化">
          <IconMaximize />
        </button>
        <button type="button" className="close" title="关闭">
          <IconWinClose />
        </button>
      </div>
    </div>
  );
}

function TabBar() {
  const s = useWorkbench();
  const run = s.run;
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
      {s.tabs.map((t) => {
        const label = t.key === "chat" ? s.session?.title || "会话" : t.label;
        const dirty = t.view === "code" && t.path === s.openFile && s.dirty;
        return (
          <div
            key={t.key}
            className={`tab ${s.activeTab === t.key ? "active" : ""}`}
            onClick={() => s.setActiveTab(t.key)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && s.setActiveTab(t.key)}
            title={t.path || label}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{label}</span>
            {dirty && <span className="dirty" />}
            {t.closable && (
              <button
                type="button"
                className="close"
                onClick={(e) => {
                  e.stopPropagation();
                  s.closeTab(t.key);
                }}
              >
                <IconClose />
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className="tab-add" title="新建会话" onClick={() => void s.newSession()}>
        <IconPlus />
      </button>

      <div className="tabs-right">
        <span className={`run-pill ${tone}`}>
          <i />
          {run ? `${run.id} · ${run.planProgress || RUN_STATUS_LABELS[run.status as RunStatus] || run.status}` : "idle"}
        </span>
        <button
          type="button"
          className="panel-toggle"
          onClick={s.toggleRight}
          title="切换右侧栏"
        >
          <IconPanelRight />
        </button>
      </div>
    </div>
  );
}

function ChatHeader() {
  const s = useWorkbench();
  const run = s.run;
  const started = run ? new Date(run.createdAt || "") : null;
  const startedLabel =
    started && !Number.isNaN(started.getTime())
      ? started.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "—";

  return (
    <div className="chat-head">
      <div style={{ minWidth: 0 }}>
        <div className="chat-title">{s.session?.title || "新会话"}</div>
        <div className="chat-meta">
          {run?.id || "—"} · {s.workspace?.name || "—"} · 开始于 {startedLabel} · {s.providerId}
          {s.demoMode ? " · demo" : ""}
        </div>
      </div>
      <div className="head-actions">
        <button type="button" className="ghost-btn" onClick={s.togglePalette}>
          命令
          <span className="kbd">{s.platform.commandHint}</span>
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={!run}
          onClick={() => void s.cancelRun()}
        >
          暂停
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={!run}
          onClick={() => void s.continueRun()}
        >
          继续运行
        </button>
        <button type="button" className="ghost-btn square" title="更多">
          <IconMore />
        </button>
      </div>
    </div>
  );
}

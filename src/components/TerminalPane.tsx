import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ArrowClockwise, Check, Plus, TerminalWindow, X } from "@phosphor-icons/react";
import { hostApi, type TerminalEvent } from "../host/client";
import { useWorkbench, type ResolvedTheme } from "../store/workbench";
import { PageEmpty } from "./pageElements";

type Session = { id: string; title: string };

export function TerminalPane() {
  const [sessions, setSessions] = useState<Session[]>(() => [
    { id: crypto.randomUUID(), title: "终端 1" },
  ]);
  const [active, setActive] = useState(sessions[0].id);

  const add = () => {
    const session = { id: crypto.randomUUID(), title: `终端 ${sessions.length + 1}` };
    setSessions((current) => [...current, session]);
    setActive(session.id);
  };

  const close = (id: string) => {
    setSessions((current) => {
      const next = current.filter((item) => item.id !== id);
      if (!next.length) {
        const replacement = { id: crypto.randomUUID(), title: "终端 1" };
        setActive(replacement.id);
        return [replacement];
      }
      if (active === id) setActive(next[0].id);
      return next;
    });
  };

  return (
    <div className="terminal-view">
      <div className="terminal-tabs">
        <div className="terminal-label">
          <TerminalWindow size={15} />
          终端
        </div>
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={`terminal-tab ${active === session.id ? "active" : ""}`}
            onClick={() => setActive(session.id)}
          >
            <span>{session.title}</span>
            <X
              size={12}
              onClick={(event) => {
                event.stopPropagation();
                close(session.id);
              }}
            />
          </button>
        ))}
        <button type="button" className="icon-btn" onClick={add} title="新建终端">
          <Plus size={14} />
        </button>
      </div>
      <div className="terminal-panels">
        {sessions.map((session) => (
          <TerminalSession key={session.id} visible={active === session.id} />
        ))}
      </div>
    </div>
  );
}

function TerminalSession({ visible }: { visible: boolean }) {
  const workspace = useWorkbench((state) => state.workspace);
  const shell = useWorkbench((state) => state.settings.terminalShell);
  const resolvedTheme = useWorkbench((state) => state.resolvedTheme);
  const setError = (message: string) => useWorkbench.setState({ error: message });
  const containerRef = useRef<HTMLDivElement>(null);
  const remoteId = useRef<string | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // assistant-ui terminal-block: the header owns the command and the exit status.
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !workspace) return;
    let disposed = false;
    setExitCode(null);
    const terminal = createTerminal(resolvedTheme);
    const fit = new FitAddon();
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    const channel = new Channel<TerminalEvent>();
    channel.onmessage = (event) => {
      if (event.eventType === "output") terminal.write(event.data);
      if (event.eventType === "exit") setExitCode(event.exitCode ?? 0);
    };
    void hostApi
      .openTerminal(workspace.id, shell || undefined, terminal.cols, terminal.rows, channel)
      .then((id) => {
        if (disposed) void hostApi.closeTerminal(id);
        else remoteId.current = id;
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      });
    const input = terminal.onData((data) => {
      if (remoteId.current) void hostApi.writeTerminal(remoteId.current, data);
    });
    const observer = new ResizeObserver(() => {
      if (!visibleRef.current) return;
      fit.fit();
      if (remoteId.current)
        void hostApi.resizeTerminal(remoteId.current, terminal.cols, terminal.rows);
    });
    observer.observe(container);
    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      if (remoteId.current) void hostApi.closeTerminal(remoteId.current);
      remoteId.current = null;
      terminalRef.current = null;
      fitRef.current = null;
      terminal.dispose();
    };
  }, [shell, workspace?.id, generation]);

  // Repaint in place rather than dropping the shell when the app theme flips.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.theme = terminalTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const fit = fitRef.current;
      if (!terminal || !fit) return;
      fit.fit();
      if (remoteId.current) {
        void hostApi.resizeTerminal(remoteId.current, terminal.cols, terminal.rows);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  if (!workspace)
    return (
      <div className={`terminal-session ${visible ? "visible" : ""}`}>
        <PageEmpty
          title="还没有打开工作区"
          body="本地终端跟随工作区目录启动。打开一个文件夹后，这里会给出该目录下的 Shell。"
        />
      </div>
    );

  return (
    <div className={`terminal-session ${visible ? "visible" : ""}`}>
      <div className="aui-term-head" data-slot="terminal-block">
        <span className="mono">{shell || "系统默认 Shell"}</span>
        {exitCode === null ? (
          <span className="aui-term-live">
            <i className="run-dot running" />
            运行中
          </span>
        ) : (
          <>
            <span className={`aui-term-exit${exitCode === 0 ? " ok" : " bad"}`}>
              {exitCode === 0 && <Check size={11} weight="bold" />}
              <em className="mono">exit {exitCode}</em>
            </span>
            <button type="button" onClick={() => setGeneration((n) => n + 1)}>
              <ArrowClockwise size={11} />
              重新启动
            </button>
          </>
        )}
      </div>
      <div ref={containerRef} className="terminal-surface" />
    </div>
  );
}

function terminalTheme(resolved: ResolvedTheme): ITheme {
  if (resolved === "dark") {
    return {
      background: "#161614",
      foreground: "#e7e5e0",
      cursor: "#e7e5e0",
      selectionBackground: "#3a4257",
      black: "#161614",
      green: "#8fbd7a",
      yellow: "#d9b061",
      red: "#e0857a",
      blue: "#8aa4e8",
    };
  }
  return {
    background: "#fbfaf8",
    foreground: "#292824",
    cursor: "#292824",
    selectionBackground: "#d9e1f2",
    black: "#292824",
    green: "#5f7d51",
    yellow: "#a97921",
    red: "#a7473b",
    blue: "#4865a8",
  };
}

function createTerminal(resolved: ResolvedTheme): Terminal {
  return new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    lineHeight: 1.35,
    theme: terminalTheme(resolved),
  });
}

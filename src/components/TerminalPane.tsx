import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, TerminalWindow, X } from "@phosphor-icons/react";
import { hostApi, type TerminalEvent } from "../host/client";
import { useWorkbench } from "../store/workbench";

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
  const setError = (message: string) => useWorkbench.setState({ error: message });
  const containerRef = useRef<HTMLDivElement>(null);
  const remoteId = useRef<string | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !workspace) return;
    let disposed = false;
    const terminal = createTerminal();
    const fit = new FitAddon();
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    const channel = new Channel<TerminalEvent>();
    channel.onmessage = (event) => {
      if (event.eventType === "output") terminal.write(event.data);
      if (event.eventType === "exit") terminal.writeln("\r\n[进程已结束]");
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
  }, [shell, workspace?.id]);

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
        <div className="empty-hint">打开工作区后可启动本地终端。</div>
      </div>
    );
  return <div ref={containerRef} className={`terminal-session ${visible ? "visible" : ""}`} />;
}

function createTerminal(): Terminal {
  return new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    lineHeight: 1.35,
    theme: {
      background: "#fbfaf8",
      foreground: "#292824",
      cursor: "#292824",
      selectionBackground: "#d9e1f2",
      black: "#292824",
      green: "#5f7d51",
      yellow: "#a97921",
      red: "#a7473b",
      blue: "#4865a8",
    },
  });
}

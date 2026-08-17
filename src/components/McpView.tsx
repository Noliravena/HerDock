import { useState } from "react";
import { CaretDown, CaretRight, Plus } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { hostApi } from "../host/client";
import { useWorkbench } from "../store/workbench";
import { TypingDots } from "./GenerationLoader";
import { ConsoleShell, ErrorBanner, PageEmpty, StatusPill, ToolRows } from "./pageElements";

const STATUS_LABEL: Record<string, string> = {
  ready: "运行中",
  connected: "运行中",
  starting: "启动中",
  stopped: "已停止",
  disconnected: "已停止",
  error: "错误",
  expired: "授权过期",
};

function pillOf(status?: string): "working" | "waiting" | "done" | "failed" {
  if (status === "ready" || status === "connected") return "done";
  if (status === "starting") return "working";
  if (status === "error" || status === "expired") return "failed";
  return "waiting";
}

export function McpView() {
  return <GrokMcp />;
}

function GrokMcp() {
  const state = useWorkbench(
    useShallow((s) => ({
      hostOnline: s.hostOnline,
      mcpServers: s.mcpServers,
      selectedMcpIds: s.selectedMcpIds,
      setSettingsOpen: s.setSettingsOpen,
      toggleMcpRuntime: s.toggleMcpRuntime,
      toggleMcpSelection: s.toggleMcpSelection,
      workspaces: s.workspaces,
    })),
  );
  const [probed, setProbed] = useState<Record<string, string[]>>({});
  const [probeError, setProbeError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const probe = async (id: string) => {
    setBusy(id);
    setProbeError((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      setProbed((current) => ({ ...current, [id]: [] }));
      const tools = await hostApi.testMcp(id);
      setProbed((current) => ({ ...current, [id]: tools }));
      setOpenId(id);
    } catch (error) {
      setProbeError((current) => ({ ...current, [id]: String(error) }));
      setOpenId(id);
    } finally {
      setBusy(null);
    }
  };

  const scopeOf = (workspaceId?: string) =>
    workspaceId ? state.workspaces.find((w) => w.id === workspaceId)?.name || "工作区" : "全局";

  return (
    <ConsoleShell
      title="MCP"
      hostOnline={state.hostOnline}
      actions={
        <button type="button" className="g-head-btn" onClick={() => state.setSettingsOpen(true)}>
          <Plus size={14} />
          添加
        </button>
      }
    >
      {!state.mcpServers.length && (
        <PageEmpty
          title="还没有本地连接"
          body="在设置里添加 MCP 服务器后，可以在这里启停、探测工具，并勾选用于本次运行。"
          action={{ label: "添加", onClick: () => state.setSettingsOpen(true) }}
        />
      )}
      {state.mcpServers.map((server) => {
        const running = server.status === "ready" || server.status === "connected";
        const tools = probed[server.id]?.length ? probed[server.id] : server.tools;
        const selected = state.selectedMcpIds.includes(server.id);
        const open = openId === server.id;
        const probing = busy === server.id;
        return (
          <article
            className={`aui-server ${open ? "on" : ""}`}
            key={server.id}
            data-slot="mcp-server-panel"
          >
            <div className="aui-server-head">
              <button
                type="button"
                className="aui-server-toggle"
                onClick={() => setOpenId(open ? null : server.id)}
                aria-expanded={open}
              >
                {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
              </button>
              <span className="aui-server-copy">
                <strong>{server.name}</strong>
                <small className="mono">
                  {`${server.command} · ${scopeOf(server.workspaceId)}`}
                </small>
              </span>
              <StatusPill
                state={pillOf(server.status)}
                label={STATUS_LABEL[server.status || ""] || (server.enabled ? "已启用" : "已停止")}
              />
              <button
                type="button"
                className={`g-switch ${selected ? "on" : ""}`}
                role="switch"
                aria-checked={selected}
                disabled={!running}
                title="用于下次运行"
                onClick={() => state.toggleMcpSelection(server.id)}
              >
                <i />
              </button>
            </div>
            {open && (
              <div className="aui-server-panel">
                {probing && (
                  <div className="aui-probe">
                    <TypingDots />
                    <span className="think-label">正在探测工具</span>
                  </div>
                )}
                {probeError[server.id] && (
                  <ErrorBanner
                    title="探测失败"
                    detail={probeError[server.id]}
                    onRetry={() => void probe(server.id)}
                  />
                )}
                {!probing && !probeError[server.id] && (
                  <ToolRows
                    items={(tools || []).map((tool) => ({
                      id: tool,
                      name: tool,
                    }))}
                  />
                )}
                {!probing && !probeError[server.id] && !tools.length && (
                  <p className="g-muted">尚未探测到工具</p>
                )}
                <p className="g-muted">命令由 Rust 直接启动，不经过 Shell。</p>
                <div className="g-row-actions">
                  <button type="button" disabled={probing} onClick={() => void probe(server.id)}>
                    {probing ? "检查中…" : "检查工具"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void state.toggleMcpRuntime(server.id, !running)}
                  >
                    {running ? "停止" : "启动"}
                  </button>
                  <button type="button" onClick={() => state.setSettingsOpen(true)}>
                    编辑
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </ConsoleShell>
  );
}

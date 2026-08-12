import { useState } from "react";
import { PlugsConnected, Plus } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { hostApi } from "../host/client";
import { useWorkbench } from "../store/workbench";

const STATUS_LABEL: Record<string, string> = {
  ready: "运行中",
  connected: "运行中",
  starting: "启动中",
  stopped: "已停止",
  disconnected: "已停止",
  error: "错误",
  expired: "授权过期",
};

function statusTone(status?: string): string {
  if (status === "ready" || status === "connected") return "ready";
  if (status === "error" || status === "expired") return "missing";
  return "limited";
}

export function McpView() {
  const state = useWorkbench(
    useShallow((s) => ({
      mcpServers: s.mcpServers,
      selectedMcpIds: s.selectedMcpIds,
      setSettingsOpen: s.setSettingsOpen,
      toggleMcpRuntime: s.toggleMcpRuntime,
      toggleMcpSelection: s.toggleMcpSelection,
      workspaces: s.workspaces,
    })),
  );
  const [probed, setProbed] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const probe = async (id: string) => {
    setBusy(id);
    try {
      setProbed((current) => ({ ...current, [id]: [] }));
      const tools = await hostApi.testMcp(id);
      setProbed((current) => ({ ...current, [id]: tools }));
    } catch (error) {
      useWorkbench.setState({ error: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const scopeOf = (workspaceId?: string) =>
    workspaceId
      ? `工作区 ${state.workspaces.find((w) => w.id === workspaceId)?.name || workspaceId}`
      : "全局";

  return (
    <div className="console-view">
      <header className="console-head stacked">
        <span className="console-eyebrow">STDIO SERVERS</span>
        <h1>本地 MCP</h1>
        <button
          type="button"
          className="ghost-btn head-action"
          onClick={() => state.setSettingsOpen(true)}
        >
          <Plus size={12} />
          添加连接
        </button>
      </header>

      <div className="console-scroll">
        <div className="mcp-list">
          {state.mcpServers.map((server) => {
            const running = server.status === "ready" || server.status === "connected";
            const tools = probed[server.id]?.length ? probed[server.id] : server.tools;
            return (
              <div className="mcp-card" key={server.id}>
                <div className="mcp-card-head">
                  <span className="mcp-icon">
                    <PlugsConnected size={15} />
                  </span>
                  <span className="mcp-name">{server.name}</span>
                  <span className="mono mcp-cmd">
                    {server.command} · {tools.length} tools
                  </span>
                  <span className={`st ${statusTone(server.status)}`}>
                    {STATUS_LABEL[server.status || ""] || (server.enabled ? "已启用" : "已停止")}
                  </span>
                  <span className="mcp-scope">{scopeOf(server.workspaceId)}</span>
                </div>
                <div className="mcp-tools">
                  {tools.map((tool) => (
                    <span className="mono tool-chip" key={tool}>
                      {tool}
                    </span>
                  ))}
                  {!tools.length && <span className="empty-inline">尚未探测到工具</span>}
                </div>
                <div className="mcp-card-foot">
                  <label className="mcp-use">
                    <input
                      type="checkbox"
                      checked={state.selectedMcpIds.includes(server.id)}
                      disabled={!running}
                      onChange={() => state.toggleMcpSelection(server.id)}
                    />
                    用于下次运行
                  </label>
                  <span className="mcp-note">命令由 Rust 直接启动，不经过 Shell</span>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy === server.id}
                    onClick={() => void probe(server.id)}
                  >
                    {busy === server.id ? "检查中…" : "检查工具"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void state.toggleMcpRuntime(server.id, !running)}
                  >
                    {running ? "停止" : "启动"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => state.setSettingsOpen(true)}
                  >
                    编辑
                  </button>
                </div>
              </div>
            );
          })}
          {!state.mcpServers.length && (
            <div className="empty-hint">还没有本地 MCP 连接，可在设置里添加一个 stdio 服务。</div>
          )}
        </div>
      </div>
    </div>
  );
}

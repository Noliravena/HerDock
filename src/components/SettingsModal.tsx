import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  Check,
  DeviceMobile,
  Key,
  Plug,
  ShieldCheck,
  SignIn,
  SignOut,
  SlidersHorizontal,
  Stop,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import {
  hostApi,
  type GrokAuthStatus,
  type McpServer,
  type ProviderProfile,
  type SaveProviderRequest,
} from "../host/client";
import { useWorkbench } from "../store/workbench";

type Tab = "providers" | "mcp" | "security" | "updates" | "general";

export function SettingsModal() {
  const { mcpServers, providerProfiles, setSettingsOpen, settingsOpen } = useWorkbench(
    useShallow((state) => ({
      mcpServers: state.mcpServers,
      providerProfiles: state.providerProfiles,
      setSettingsOpen: state.setSettingsOpen,
      settingsOpen: state.settingsOpen,
    })),
  );
  const [tab, setTab] = useState<Tab>("providers");
  if (!settingsOpen) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="HerDock 设置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-head">
          <div>
            <div className="settings-title">设置</div>
            <div className="settings-subtitle">本地 Provider、MCP 与桌面行为</div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSettingsOpen(false)}
            title="关闭"
          >
            <X size={16} />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            <button
              type="button"
              className={tab === "providers" ? "active" : ""}
              onClick={() => setTab("providers")}
            >
              <Key size={16} />
              Provider
            </button>
            <button
              type="button"
              className={tab === "mcp" ? "active" : ""}
              onClick={() => setTab("mcp")}
            >
              <Plug size={16} />
              本地 MCP
            </button>
            <button
              type="button"
              className={tab === "security" ? "active" : ""}
              onClick={() => setTab("security")}
            >
              <ShieldCheck size={16} />
              安全规则
            </button>
            <button
              type="button"
              className={tab === "updates" ? "active" : ""}
              onClick={() => setTab("updates")}
            >
              <ArrowClockwise size={16} />
              应用更新
            </button>
            <button
              type="button"
              className={tab === "general" ? "active" : ""}
              onClick={() => setTab("general")}
            >
              <SlidersHorizontal size={16} />
              通用
            </button>
          </nav>
          <div className="settings-content">
            {tab === "providers" && <ProviderSettings profiles={providerProfiles} />}
            {tab === "mcp" && <McpSettings servers={mcpServers} />}
            {tab === "security" && <SecuritySettings />}
            {tab === "updates" && <UpdateSettings />}
            {tab === "general" && <GeneralSettings />}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProviderSettings({ profiles }: { profiles: ProviderProfile[] }) {
  const [drafts, setDrafts] = useState<Record<string, SaveProviderRequest>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const reload = useWorkbench((state) => state.reloadProviders);
  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        profiles.map((profile) => [
          profile.id,
          {
            id: profile.id,
            providerType: profile.providerType,
            displayName: profile.displayName,
            model: profile.model || "",
            baseUrl: profile.baseUrl || "",
            executable: profile.executable || "",
            apiKey: "",
            candidateModels: (profile.config.candidateModels as string[] | undefined) || [],
            enabled: profile.enabled,
          },
        ]),
      ),
    );
  }, [profiles]);
  const update = (id: string, patch: Partial<SaveProviderRequest>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const save = async (id: string) => {
    setStatus((current) => ({ ...current, [id]: "保存中" }));
    try {
      await hostApi.saveProvider(drafts[id]);
      await reload();
      setStatus((current) => ({ ...current, [id]: "已保存" }));
    } catch (error) {
      setStatus((current) => ({ ...current, [id]: String(error) }));
    }
  };
  const validate = async (id: string) => {
    setStatus((current) => ({ ...current, [id]: "测试中" }));
    try {
      const result = await hostApi.validateProvider(id);
      setStatus((current) => ({ ...current, [id]: result || "连接成功" }));
    } catch (error) {
      setStatus((current) => ({ ...current, [id]: String(error) }));
    }
  };
  return (
    <div className="settings-stack">
      {profiles.map((profile) => {
        const draft = drafts[profile.id];
        if (!draft) return null;
        const cli = profile.providerType === "cli";
        return (
          <section className="settings-section" key={profile.id}>
            <div className="settings-section-head">
              <div>
                <b>{profile.displayName}</b>
                <span>
                  {cli
                    ? "本机 CLI"
                    : profile.providerType === "anthropic"
                      ? "Anthropic Messages"
                      : "OpenAI-compatible"}
                </span>
              </div>
              <label className="switch-label">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => update(profile.id, { enabled: event.target.checked })}
                />
                启用
              </label>
            </div>
            <div className="form-grid">
              {cli && (
                <label>
                  可执行文件
                  <input
                    value={draft.executable || ""}
                    onChange={(event) => update(profile.id, { executable: event.target.value })}
                    placeholder={`从 PATH 查找 ${profile.id}`}
                  />
                </label>
              )}
              <label>
                模型
                <input
                  value={draft.model || ""}
                  onChange={(event) => update(profile.id, { model: event.target.value })}
                />
              </label>
              {!cli && (
                <label>
                  Base URL
                  <input
                    value={draft.baseUrl || ""}
                    onChange={(event) => update(profile.id, { baseUrl: event.target.value })}
                  />
                </label>
              )}
              <label className="full">
                候选模型
                <input
                  value={draft.candidateModels.join(", ")}
                  onChange={(event) =>
                    update(profile.id, {
                      candidateModels: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="模型名称以逗号分隔，不从远程拉取"
                />
              </label>
              {!cli && (
                <label className="full">
                  API Key
                  <input
                    type="password"
                    value={draft.apiKey || ""}
                    onChange={(event) => update(profile.id, { apiKey: event.target.value })}
                    placeholder={
                      profile.credentialRef
                        ? "已保存在系统钥匙串，留空保持不变"
                        : "保存到系统钥匙串"
                    }
                  />
                </label>
              )}
            </div>
            {profile.id === "grok" && <GrokAuthPanel onProviderReload={reload} />}
            <div className="settings-actions">
              <span className="settings-status">{status[profile.id]}</span>
              <button type="button" onClick={() => void validate(profile.id)}>
                测试连接
              </button>
              <button type="button" className="primary" onClick={() => void save(profile.id)}>
                <Check size={14} />
                保存
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GrokAuthPanel({ onProviderReload }: { onProviderReload: () => Promise<void> }) {
  const [auth, setAuth] = useState<GrokAuthStatus | null>(null);
  const [action, setAction] = useState<"oauth" | "device" | "logout" | null>(null);
  const [status, setStatus] = useState("正在读取本机登录状态");
  const [code, setCode] = useState("");
  const [deviceCode, setDeviceCode] = useState("");

  const refresh = async () => {
    try {
      const next = await hostApi.grokAuthStatus();
      setAuth(next);
      setStatus(next.detail);
    } catch (error) {
      setStatus(String(error));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const login = async (method: "oauth" | "device") => {
    setAction(method);
    setDeviceCode("");
    setStatus(method === "oauth" ? "正在打开官方 OAuth 登录" : "正在申请设备验证码");
    try {
      const result = await hostApi.grokLogin(method, (event) => {
        setStatus(event.message);
        if (event.code) setDeviceCode(event.code);
      });
      setAuth(result.status);
      setStatus(result.message);
      if (result.deviceCode) setDeviceCode(result.deviceCode);
      await onProviderReload();
    } catch (error) {
      setStatus(String(error));
      await refresh();
    } finally {
      setAction(null);
    }
  };

  const cancel = async () => {
    try {
      await hostApi.grokCancelLogin();
      setStatus("正在取消 Grok Build 登录");
    } catch (error) {
      setStatus(String(error));
    }
  };

  const submitCode = async () => {
    try {
      await hostApi.grokSubmitCode(code);
      setCode("");
      setStatus("验证码已提交，正在等待 Grok Build 完成登录");
    } catch (error) {
      setStatus(String(error));
    }
  };

  const logout = async () => {
    if (!window.confirm("退出本机 Grok Build CLI 登录？")) return;
    setAction("logout");
    try {
      const next = await hostApi.grokLogout();
      setAuth(next);
      setStatus(next.detail);
      await onProviderReload();
    } catch (error) {
      setStatus(String(error));
    } finally {
      setAction(null);
    }
  };

  const busy = action === "oauth" || action === "device" || auth?.loginRunning;
  return (
    <div className="grok-auth-panel" aria-label="Grok Build 本机登录">
      <div className="grok-auth-head">
        <div>
          <b>Grok Build 本机登录</b>
          <span>{auth?.cliPath || "等待 CLI 检测"}</span>
        </div>
        <span className={`st ${auth?.signedIn ? "ready" : auth?.expired ? "expired" : "missing"}`}>
          {auth?.signedIn ? "已登录" : auth?.expired ? "已过期" : "未登录"}
        </span>
      </div>
      {auth?.signedIn && (
        <div className="grok-account-line">
          <span>{auth.displayName || auth.email || "Grok Build 用户"}</span>
          <code>
            {auth.authMode || "oauth"}
            {auth.version ? ` · ${auth.version}` : ""}
          </code>
        </div>
      )}
      {(busy || deviceCode) && (
        <div className="grok-code-row">
          <input
            aria-label="Grok Build 验证码"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={deviceCode || "粘贴浏览器显示的验证码"}
          />
          <button type="button" disabled={!code.trim()} onClick={() => void submitCode()}>
            <Check size={13} />
            提交
          </button>
        </div>
      )}
      <div className="grok-auth-actions">
        <span>{status}</span>
        {busy ? (
          <button type="button" onClick={() => void cancel()}>
            <Stop size={13} />
            取消
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={!auth?.cliFound || auth.signedIn}
              onClick={() => void login("oauth")}
            >
              <SignIn size={13} />
              OAuth 登录
            </button>
            <button
              type="button"
              disabled={!auth?.cliFound || auth.signedIn}
              onClick={() => void login("device")}
            >
              <DeviceMobile size={13} />
              设备码
            </button>
            {auth?.signedIn && (
              <button type="button" disabled={action === "logout"} onClick={() => void logout()}>
                <SignOut size={13} />
                退出
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="icon-btn small"
          title="刷新登录状态"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <ArrowClockwise size={13} />
        </button>
      </div>
    </div>
  );
}

function McpSettings({ servers }: { servers: McpServer[] }) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [status, setStatus] = useState("");
  const refresh = async () => {
    const values = await hostApi.mcpServers();
    useWorkbench.setState({
      mcpServers: values,
      connectors: values.map((server) => ({
        id: server.id,
        name: server.name,
        status: server.enabled ? "connected" : "disconnected",
        scopes: server.tools,
        detail: server.command,
      })),
    });
  };
  const add = async () => {
    try {
      await hostApi.saveMcp({
        name: name || command,
        command,
        args: parseArgs(args),
        env: parseEnv(env),
        enabled: true,
      });
      setName("");
      setCommand("");
      setArgs("");
      setEnv("");
      await refresh();
    } catch (error) {
      setStatus(String(error));
    }
  };
  return (
    <div className="settings-stack">
      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <b>添加 stdio 服务</b>
            <span>命令由 Rust 直接启动，不经过 Shell</span>
          </div>
        </div>
        <div className="form-grid">
          <label>
            名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Filesystem"
            />
          </label>
          <label>
            命令
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="npx"
            />
          </label>
          <label className="full">
            参数数组
            <input
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder={'["-y", "@modelcontextprotocol/server-filesystem"]'}
            />
          </label>
          <label className="full">
            敏感环境变量
            <textarea
              value={env}
              onChange={(event) => setEnv(event.target.value)}
              placeholder={"TOKEN=secret\nAPI_KEY=secret"}
              rows={3}
            />
          </label>
        </div>
        <div className="settings-actions">
          <span className="settings-status">{status}</span>
          <button
            type="button"
            className="primary"
            disabled={!command.trim()}
            onClick={() => void add()}
          >
            添加连接
          </button>
        </div>
      </section>
      {servers.map((server) => (
        <McpServerEditor key={server.id} server={server} onRefresh={refresh} />
      ))}
    </div>
  );
}

function McpServerEditor({
  server,
  onRefresh,
}: {
  server: McpServer;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    name: server.name,
    command: server.command,
    args: JSON.stringify(server.args),
    env: Object.keys(server.env)
      .map((key) => `${key}=********`)
      .join("\n"),
  });
  const [status, setStatus] = useState("");
  useEffect(
    () =>
      setDraft({
        name: server.name,
        command: server.command,
        args: JSON.stringify(server.args),
        env: Object.keys(server.env)
          .map((key) => `${key}=********`)
          .join("\n"),
      }),
    [server],
  );
  const saveServer = async () => {
    try {
      setStatus("保存中");
      await hostApi.saveMcp({
        id: server.id,
        name: draft.name,
        command: draft.command,
        args: parseArgs(draft.args),
        env: parseEnv(draft.env),
        enabled: server.enabled,
        workspaceId: server.workspaceId,
      });
      await onRefresh();
      setStatus("已保存");
    } catch (error) {
      setStatus(String(error));
    }
  };
  const test = async () => {
    try {
      setStatus("检查中");
      const tools = await hostApi.testMcp(server.id);
      await onRefresh();
      setStatus(`发现 ${tools.length} 个工具`);
    } catch (error) {
      setStatus(String(error));
    }
  };
  const toggle = async () => {
    try {
      server.enabled ? await hostApi.stopMcp(server.id) : await hostApi.startMcp(server.id);
      await onRefresh();
    } catch (error) {
      setStatus(String(error));
    }
  };
  return (
    <section className="settings-section compact">
      <div className="settings-section-head">
        <div>
          <b>{server.name}</b>
          <span>
            {server.status || (server.enabled ? "ready" : "stopped")} · {server.tools.length} tools
          </span>
        </div>
        <span
          className={`st ${server.status === "ready" ? "ready" : server.status === "error" ? "failed" : "missing"}`}
        >
          {server.status === "ready" ? "运行中" : server.status === "error" ? "错误" : "已停止"}
        </span>
      </div>
      <details className="settings-editor">
        <summary>编辑连接</summary>
        <div className="form-grid">
          <label>
            名称
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            命令
            <input
              value={draft.command}
              onChange={(event) => setDraft({ ...draft, command: event.target.value })}
            />
          </label>
          <label className="full">
            参数
            <input
              value={draft.args}
              onChange={(event) => setDraft({ ...draft, args: event.target.value })}
            />
          </label>
          <label className="full">
            敏感环境变量
            <textarea
              value={draft.env}
              onChange={(event) => setDraft({ ...draft, env: event.target.value })}
              rows={3}
            />
          </label>
        </div>
        <div className="settings-actions">
          <button type="button" className="primary" onClick={() => void saveServer()}>
            <Check size={13} />
            保存
          </button>
        </div>
      </details>
      {server.tools.length > 0 && (
        <div className="tool-list">
          {server.tools.map((tool) => (
            <code key={tool}>{tool}</code>
          ))}
        </div>
      )}
      <div className="settings-actions">
        <span className="settings-status">{status}</span>
        <button type="button" onClick={() => void test()}>
          检查工具
        </button>
        <button type="button" onClick={() => void toggle()}>
          {server.enabled ? "停止" : "启动"}
        </button>
        <button
          type="button"
          onClick={() =>
            window.confirm(`删除 ${server.name}？`) &&
            void hostApi.deleteMcp(server.id).then(onRefresh)
          }
        >
          <Trash size={13} />
          删除
        </button>
      </div>
    </section>
  );
}

function SecuritySettings() {
  const policyRules = useWorkbench((state) => state.policyRules);
  const deletePolicyRule = useWorkbench((state) => state.deletePolicyRule);
  return (
    <div className="settings-stack">
      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <b>持久化允许规则</b>
            <span>仅精确匹配工作区、Provider、工具或命令范围</span>
          </div>
        </div>
        {policyRules.map((rule) => (
          <div className="policy-row" key={rule.id}>
            <div>
              <b>{rule.ruleType}</b>
              <code>{rule.scopeKey}</code>
            </div>
            <span>{rule.effect}</span>
            <button
              type="button"
              className="icon-btn small"
              title="撤销规则"
              onClick={() => void deletePolicyRule(rule.id)}
            >
              <Trash size={13} />
            </button>
          </div>
        ))}
        {!policyRules.length && (
          <div className="empty-hint">暂无持久化规则。审批时选择“始终允许”后会显示在这里。</div>
        )}
      </section>
    </div>
  );
}

function UpdateSettings() {
  const { checkUpdate, installUpdate, settings, update } = useWorkbench(
    useShallow((state) => ({
      checkUpdate: state.checkUpdate,
      installUpdate: state.installUpdate,
      settings: state.settings,
      update: state.updateStatus,
    })),
  );
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <div>
          <b>HerDock 更新</b>
          <span>
            {update?.channel || settings.updateChannel} · 当前 {update?.currentVersion || "—"}
          </span>
        </div>
        <span className={`st ${update?.enabled ? "ready" : "limited"}`}>
          {update?.enabled ? update.state : "未启用"}
        </span>
      </div>
      <p className="settings-copy">{update?.message || "正在读取此构建的更新配置。"}</p>
      {update?.availableVersion && (
        <div className="update-version">
          可用版本 <b>{update.availableVersion}</b>
        </div>
      )}
      <div className="settings-actions">
        <button type="button" disabled={!update?.enabled} onClick={() => void checkUpdate()}>
          <ArrowClockwise size={13} />
          检查更新
        </button>
        <button
          type="button"
          className="primary"
          disabled={!update?.enabled || !update.availableVersion}
          onClick={() => void installUpdate()}
        >
          安装并重启
        </button>
      </div>
    </section>
  );
}

function parseEnv(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const split = line.indexOf("=");
        return split < 1 ? [line, ""] : [line.slice(0, split).trim(), line.slice(split + 1)];
      }),
  );
}

function parseArgs(value: string): string[] {
  const parsed: unknown = JSON.parse(value || "[]");
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
    throw new Error("参数必须是 JSON 字符串数组");
  return parsed;
}

function GeneralSettings() {
  const settings = useWorkbench((state) => state.settings);
  const providers = useWorkbench((state) => state.providers);
  const saveSettings = useWorkbench((state) => state.saveSettings);
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <section className="settings-section">
      <div className="form-grid">
        <label>
          默认 Provider
          <select
            value={draft.defaultProvider}
            onChange={(event) => setDraft({ ...draft, defaultProvider: event.target.value })}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          审批策略
          <select
            value={draft.autoExecute}
            onChange={(event) => setDraft({ ...draft, autoExecute: event.target.value })}
          >
            <option value="ask_always">每次询问</option>
            <option value="ask_risky">变更与风险操作询问</option>
            <option value="auto_workspace">工作区内自动</option>
            <option value="auto_all">全部自动</option>
          </select>
        </label>
        <label className="full">
          终端 Shell
          <input
            value={draft.terminalShell}
            onChange={(event) => setDraft({ ...draft, terminalShell: event.target.value })}
            placeholder="留空使用系统默认 Shell"
          />
        </label>
        <label className="full">
          全局快捷键
          <input
            value={draft.launchShortcut}
            onChange={(event) => setDraft({ ...draft, launchShortcut: event.target.value })}
            placeholder="CommandOrControl+Shift+Space"
          />
        </label>
        <label>
          更新通道
          <select
            value={draft.updateChannel}
            onChange={(event) => setDraft({ ...draft, updateChannel: event.target.value })}
          >
            <option value="stable">Stable</option>
            <option value="preview">Preview</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.closeToTray}
            onChange={(event) => setDraft({ ...draft, closeToTray: event.target.checked })}
          />
          关闭窗口后保留托盘运行
        </label>
      </div>
      <div className="settings-actions">
        <button type="button" className="primary" onClick={() => void saveSettings(draft)}>
          <Check size={14} />
          保存设置
        </button>
      </div>
    </section>
  );
}

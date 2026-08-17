import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  Check,
  DeviceMobile,
  FirstAid,
  Key,
  MagnifyingGlass,
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
  type ProbeResult,
  type ProviderHealth,
  type ProviderProfile,
  type SaveProviderRequest,
} from "../host/client";
import {
  searchSettingsEntries,
  SETTINGS_NAV,
  type SettingsEntry,
  type SettingsTab,
} from "../lib/settingsCatalog";
import { useWorkbench } from "../store/workbench";
import { DoctorSettings } from "./DoctorSettings";
import {
  ErrorBanner,
  ModelPickerList,
  PageEmpty,
  SegmentedField,
  SpecSheet,
  StatusPill,
  Switch,
  ToggleRow,
  ToolRows,
  useConfirm,
} from "./pageElements";

const NAV_ICON: Record<SettingsTab, typeof Key> = {
  providers: Key,
  mcp: Plug,
  security: ShieldCheck,
  updates: ArrowClockwise,
  general: SlidersHorizontal,
  doctor: FirstAid,
};

export function SettingsModal() {
  const {
    mcpServers,
    providerProfiles,
    providers,
    openSettings,
    setSettingsOpen,
    settingsFocus,
    settingsOpen,
    settingsTab,
    clearSettingsFocus,
  } = useWorkbench(
    useShallow((state) => ({
      mcpServers: state.mcpServers,
      providerProfiles: state.providerProfiles,
      providers: state.providers,
      openSettings: state.openSettings,
      setSettingsOpen: state.setSettingsOpen,
      settingsFocus: state.settingsFocus,
      settingsOpen: state.settingsOpen,
      settingsTab: state.settingsTab,
      clearSettingsFocus: state.clearSettingsFocus,
    })),
  );
  const [query, setQuery] = useState("");
  const extraEntries = useMemo<SettingsEntry[]>(
    () =>
      providerProfiles.map((profile) => ({
        id: `provider-${profile.id}`,
        tab: "providers" as const,
        anchorId: `provider-${profile.id}`,
        label: profile.displayName,
        description: profile.providerType,
        keywords: [profile.id, profile.providerType, "provider"],
      })),
    [providerProfiles],
  );
  const searchHits = useMemo(
    () => searchSettingsEntries(query, extraEntries),
    [query, extraEntries],
  );

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, setSettingsOpen]);

  useEffect(() => {
    if (!settingsFocus) return;
    const frame = window.requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(
        `[data-settings-id="${CSS.escape(settingsFocus)}"]`,
      );
      if (!node) return;
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      node.classList.add("settings-anchor-hit");
      window.setTimeout(() => {
        node.classList.remove("settings-anchor-hit");
        clearSettingsFocus();
      }, 1600);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settingsFocus, settingsTab, clearSettingsFocus]);

  if (!settingsOpen) return null;
  const tab = settingsTab;
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
            <div className="settings-subtitle">本地 Provider、MCP、代理与诊断</div>
          </div>
          <div className="settings-head-tools">
            <label className="settings-search">
              <MagnifyingGlass size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索设置"
                aria-label="搜索设置"
              />
            </label>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSettingsOpen(false)}
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            {SETTINGS_NAV.map((item) => {
              const Icon = NAV_ICON[item.id];
              return (
                <button
                  type="button"
                  key={item.id}
                  className={tab === item.id ? "active" : ""}
                  onClick={() => {
                    setQuery("");
                    openSettings({ tab: item.id });
                  }}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="settings-content">
            {query.trim() ? (
              <div className="settings-stack">
                {searchHits.length === 0 && (
                  <p className="settings-copy">没有匹配「{query.trim()}」的设置项。</p>
                )}
                {searchHits.map((entry) => (
                  <button
                    type="button"
                    className="settings-search-hit"
                    key={entry.id}
                    onClick={() => {
                      setQuery("");
                      openSettings({ tab: entry.tab, focus: entry.anchorId });
                    }}
                  >
                    <strong>{entry.label}</strong>
                    <span>
                      {SETTINGS_NAV.find((item) => item.id === entry.tab)?.label} ·{" "}
                      {entry.description}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {tab === "providers" && (
                  <ProviderSettings profiles={providerProfiles} providers={providers} />
                )}
                {tab === "mcp" && <McpSettings servers={mcpServers} />}
                {tab === "security" && <SecuritySettings />}
                {tab === "updates" && <UpdateSettings />}
                {tab === "general" && <GeneralSettings />}
                {tab === "doctor" && <DoctorSettings />}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProviderSettings({
  profiles,
  providers,
}: {
  profiles: ProviderProfile[];
  providers: ProviderHealth[];
}) {
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
    <div className="settings-stack" data-settings-id="providers">
      <p className="settings-copy settings-lead">
        对话界面以模型名称选择对象（如
        gpt-5.4-codex、claude-sonnet-4-6）。本页管理模型背后的连接：CLI 可执行文件与登录、API Key
        与端点。
      </p>
      {profiles.map((profile) => {
        const draft = drafts[profile.id];
        if (!draft) return null;
        const cli = profile.providerType === "cli";
        const health = providers.find((item) => item.id === profile.id);
        return (
          <section
            className="settings-section"
            key={profile.id}
            data-settings-id={`provider-${profile.id}`}
          >
            <div className="settings-section-head">
              <div>
                <b>{profile.displayName}</b>
                <span>
                  {cli
                    ? "本机 CLI"
                    : profile.providerType === "anthropic"
                      ? "Anthropic Messages"
                      : "OpenAI-compatible"}
                  {health?.version ? ` · ${health.version}` : ""}
                </span>
              </div>
              <div className="settings-head-actions">
                <StatusPill
                  state={health?.available ? "done" : "waiting"}
                  label={health?.available ? "已连接" : "未连接"}
                />
                <Switch
                  label={`启用 ${profile.displayName}`}
                  on={draft.enabled}
                  onToggle={(enabled) => update(profile.id, { enabled })}
                />
              </div>
            </div>
            {health && !health.available && health.detail && (
              <ErrorBanner
                title="这个连接暂时用不了"
                detail={health.detail}
                onRetry={() => void validate(profile.id)}
              />
            )}
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
  const [askConfirm, confirmLayer] = useConfirm();

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
        <StatusPill
          state={auth?.signedIn ? "done" : auth?.expired ? "failed" : "waiting"}
          label={auth?.signedIn ? "已登录" : auth?.expired ? "已过期" : "未登录"}
        />
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
              <button
                type="button"
                disabled={action === "logout"}
                onClick={() =>
                  void askConfirm({
                    title: "退出本机 Grok Build 登录？",
                    body: "会清掉本机 CLI 的登录态，之后需要重新走 OAuth 或设备码。",
                    confirmLabel: "退出登录",
                    danger: true,
                  }).then((ok) => {
                    if (ok) void logout();
                  })
                }
              >
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
      {confirmLayer}
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
      <section className="settings-section" data-settings-id="mcp-add">
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
  const [askConfirm, confirmLayer] = useConfirm();
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
        <StatusPill
          state={
            server.status === "ready" ? "working" : server.status === "error" ? "failed" : "waiting"
          }
          label={
            server.status === "ready" ? "运行中" : server.status === "error" ? "错误" : "已停止"
          }
        />
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
        <ToolRows
          items={server.tools.map((tool) => ({
            id: tool,
            name: tool,
            tone: server.status === "ready" ? "ok" : undefined,
          }))}
        />
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
            void askConfirm({
              title: `删除「${server.name}」？`,
              body: "这条 stdio 连接和它带来的工具会从本机配置里去掉，之后可以重新添加。",
              confirmLabel: "删除连接",
              danger: true,
            }).then((ok) => {
              if (ok) void hostApi.deleteMcp(server.id).then(onRefresh);
            })
          }
        >
          <Trash size={13} />
          删除
        </button>
      </div>
      {confirmLayer}
    </section>
  );
}

const RULE_KIND_LABEL: Record<string, string> = {
  shell: "执行命令",
  workspace_write: "写入工作区",
  network: "网络访问",
  browser: "浏览器操作",
  destructive: "破坏性操作",
  provider_cli: "运行 Provider CLI",
  mcp: "MCP 工具调用",
};

function SecuritySettings() {
  const policyRules = useWorkbench((state) => state.policyRules);
  const deletePolicyRule = useWorkbench((state) => state.deletePolicyRule);
  return (
    <div className="settings-stack">
      <section className="settings-section" data-settings-id="security-rules">
        <div className="settings-section-head">
          <div>
            <b>持久化允许规则</b>
            <span>仅精确匹配工作区、Provider、工具或命令范围</span>
          </div>
        </div>
        {policyRules.map((rule) => (
          <div className="aui-rule" key={rule.id}>
            <SpecSheet
              title={RULE_KIND_LABEL[rule.ruleType] || rule.ruleType}
              rows={[
                { label: "范围", value: rule.scopeKey, emphasis: true },
                {
                  label: "效果",
                  value:
                    rule.effect === "allow" ? "允许" : rule.effect === "deny" ? "拒绝" : "询问",
                },
                { label: "写入", value: new Date(rule.createdAt).toLocaleDateString() },
              ]}
            />
            <button
              type="button"
              className="aui-rule-del"
              title="撤销规则"
              onClick={() => void deletePolicyRule(rule.id)}
            >
              <Trash size={13} />
            </button>
          </div>
        ))}
        {!policyRules.length && (
          <PageEmpty
            title="还没有持久化规则"
            body="审批时选择「始终允许」，这条授权会记在这里，随时可以撤销。"
          />
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
    <section className="settings-section" data-settings-id="updates">
      <div className="settings-section-head">
        <div>
          <b>HerDock 更新</b>
          <span>
            {update?.channel || settings.updateChannel} · 当前 {update?.currentVersion || "—"}
          </span>
        </div>
        <StatusPill
          state={update?.enabled ? "working" : "waiting"}
          label={update?.enabled ? update.state : "未启用"}
        />
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
  const persistSettings = useWorkbench((state) => state.persistSettings);
  const theme = useWorkbench((state) => state.theme);
  const setTheme = useWorkbench((state) => state.setTheme);
  const [draft, setDraft] = useState(settings);
  const [probeStatus, setProbeStatus] = useState("");
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  useEffect(() => setDraft(settings), [settings]);
  const testProxy = async () => {
    setProbeStatus("正在探测…");
    try {
      await persistSettings({ ...settings, httpProxy: draft.httpProxy ?? "" });
      const results = await hostApi.probeNetwork();
      setProbes(results);
      const failed = results.filter((item) => item.status === "fail").length;
      setProbeStatus(
        failed === results.length && results.length
          ? "探测全部失败。办公网可能需要 HTTP 代理。"
          : "探测完成。401/403 表示网络路径正常。",
      );
    } catch (error) {
      setProbeStatus(String(error));
    }
  };
  return (
    <section className="settings-section">
      <div data-settings-id="theme">
        <SegmentedField
          label="外观"
          value={theme}
          onChange={(mode) => setTheme(mode as typeof theme)}
          options={[
            { value: "light", label: "浅色" },
            { value: "dark", label: "深色" },
            { value: "system", label: "跟随系统" },
          ]}
        />
      </div>

      <div className="aui-field" data-settings-id="default-provider">
        <span className="mono">默认连接</span>
        <ModelPickerList
          selectedId={draft.defaultProvider}
          onSelect={(id) => setDraft({ ...draft, defaultProvider: id })}
          items={providers.map((provider) => ({
            id: provider.id,
            name: provider.displayName,
            family: provider.available ? "已连接" : "未连接",
            capabilities: provider.capabilities,
            meta: provider.model,
            muted: !provider.available,
          }))}
        />
      </div>

      <div data-settings-id="policy">
        <SegmentedField
          label="新工作区默认审批策略"
          value={draft.autoExecute}
          onChange={(autoExecute) => setDraft({ ...draft, autoExecute })}
          options={[
            { value: "ask_always", label: "每次询问" },
            { value: "ask_risky", label: "风险操作" },
            { value: "auto_workspace", label: "工作区内自动" },
            { value: "auto_all", label: "全部自动" },
          ]}
        />
      </div>

      <SegmentedField
        label="更新通道"
        value={draft.updateChannel}
        onChange={(updateChannel) => setDraft({ ...draft, updateChannel })}
        options={[
          { value: "stable", label: "Stable" },
          { value: "preview", label: "Preview" },
        ]}
      />

      <div className="form-grid">
        <label className="full" data-settings-id="shell">
          终端 Shell
          <input
            value={draft.terminalShell}
            onChange={(event) => setDraft({ ...draft, terminalShell: event.target.value })}
            placeholder="留空使用系统默认 Shell"
          />
        </label>
        <label className="full" data-settings-id="shortcut">
          全局快捷键
          <input
            value={draft.launchShortcut}
            onChange={(event) => setDraft({ ...draft, launchShortcut: event.target.value })}
            placeholder="CommandOrControl+Shift+Space"
          />
        </label>
        <label className="full" data-settings-id="proxy">
          HTTP 代理
          <input
            value={draft.httpProxy ?? ""}
            onChange={(event) => setDraft({ ...draft, httpProxy: event.target.value })}
            placeholder="http://127.0.0.1:7890"
          />
        </label>
      </div>
      <p className="settings-copy">
        用于应用内 API 连通测试与请求。CLI Provider 仍读取系统 HTTP_PROXY。401/403 视为可达。
      </p>
      <div className="settings-actions">
        <span className="settings-status">{probeStatus}</span>
        <button type="button" onClick={() => void testProxy()}>
          测试连通
        </button>
      </div>
      {probes?.map((probe) => (
        <div className="doctor-probe" key={probe.url}>
          <span className="mono">{probe.status}</span>
          <code>{probe.url}</code>
          <span>{probe.detail}</span>
        </div>
      ))}

      <div data-settings-id="tray">
        <ToggleRow
          label="关闭窗口后保留托盘运行"
          detail="后台运行继续推进，托盘图标可以把窗口叫回来"
          on={draft.closeToTray}
          onToggle={(closeToTray) => setDraft({ ...draft, closeToTray })}
        />
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

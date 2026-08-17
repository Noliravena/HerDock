export const SETTINGS_TABS = [
  "providers",
  "mcp",
  "security",
  "updates",
  "general",
  "doctor",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type SettingsEntry = {
  id: string;
  tab: SettingsTab;
  anchorId: string;
  label: string;
  description: string;
  keywords: string[];
};

export const SETTINGS_NAV: { id: SettingsTab; label: string }[] = [
  { id: "providers", label: "Provider" },
  { id: "mcp", label: "本地 MCP" },
  { id: "security", label: "安全规则" },
  { id: "updates", label: "应用更新" },
  { id: "general", label: "通用" },
  { id: "doctor", label: "诊断" },
];

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  {
    id: "providers",
    tab: "providers",
    anchorId: "providers",
    label: "Provider 连接",
    description: "CLI 可执行文件、API Key 与端点",
    keywords: ["provider", "模型", "api", "key", "cli", "grok", "claude", "codex", "openai"],
  },
  {
    id: "mcp",
    tab: "mcp",
    anchorId: "mcp-add",
    label: "本地 MCP",
    description: "添加 stdio 服务",
    keywords: ["mcp", "stdio", "工具", "npx"],
  },
  {
    id: "security",
    tab: "security",
    anchorId: "security-rules",
    label: "持久化允许规则",
    description: "审批时选择始终允许后记在这里",
    keywords: ["安全", "审批", "规则", "允许", "policy"],
  },
  {
    id: "updates",
    tab: "updates",
    anchorId: "updates",
    label: "应用更新",
    description: "检查与安装 HerDock 更新",
    keywords: ["更新", "upgrade", "channel", "preview"],
  },
  {
    id: "theme",
    tab: "general",
    anchorId: "theme",
    label: "外观",
    description: "浅色、深色或跟随系统",
    keywords: ["主题", "theme", "dark", "light", "外观"],
  },
  {
    id: "default-provider",
    tab: "general",
    anchorId: "default-provider",
    label: "默认连接",
    description: "新会话使用的 Provider",
    keywords: ["默认", "provider", "模型"],
  },
  {
    id: "policy",
    tab: "general",
    anchorId: "policy",
    label: "新工作区默认审批策略",
    description: "新工作区的默认策略；已打开的工作区可在对话输入框单独设置",
    keywords: ["审批", "auto", "execute", "策略"],
  },
  {
    id: "shell",
    tab: "general",
    anchorId: "shell",
    label: "终端 Shell",
    description: "内置终端使用的 Shell",
    keywords: ["terminal", "powershell", "zsh", "shell"],
  },
  {
    id: "shortcut",
    tab: "general",
    anchorId: "shortcut",
    label: "全局快捷键",
    description: "唤起主窗口",
    keywords: ["shortcut", "热键", "tray"],
  },
  {
    id: "tray",
    tab: "general",
    anchorId: "tray",
    label: "关闭窗口后保留托盘运行",
    description: "后台继续推进",
    keywords: ["托盘", "tray", "后台"],
  },
  {
    id: "proxy",
    tab: "general",
    anchorId: "proxy",
    label: "HTTP 代理",
    description: "办公网访问公网 API 时使用",
    keywords: ["proxy", "代理", "办公网", "http_proxy", "vpn"],
  },
  {
    id: "doctor",
    tab: "doctor",
    anchorId: "doctor",
    label: "环境诊断",
    description: "数据目录、Provider、MCP、代理与网络探测",
    keywords: ["doctor", "诊断", "连通", "probe", "zip"],
  },
];

export function isSettingsTab(value: string): value is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value);
}

export function parseSettingsHash(hash: string): { tab: SettingsTab; focus?: string } | null {
  const parts = hash
    .replace(/^#/, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts[0] !== "settings") return null;
  const tab = parts[1] && isSettingsTab(parts[1]) ? parts[1] : "providers";
  const focus = parts[2] || undefined;
  return { tab, focus };
}

export function buildSettingsHash(tab: SettingsTab, focus?: string): string {
  return focus ? `#/settings/${tab}/${encodeURIComponent(focus)}` : `#/settings/${tab}`;
}

export function writeSettingsHash(tab: SettingsTab, focus?: string) {
  if (typeof window === "undefined") return;
  const next = buildSettingsHash(tab, focus);
  if (window.location.hash === next) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
}

export function clearSettingsHash() {
  if (typeof window === "undefined") return;
  if (!window.location.hash.startsWith("#/settings")) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

export function searchSettingsEntries(query: string, extra: SettingsEntry[] = []): SettingsEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return [...SETTINGS_ENTRIES, ...extra].filter((entry) =>
    [entry.label, entry.description, entry.tab, ...entry.keywords].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  );
}

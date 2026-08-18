import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const now = "2026-08-10T10:24:00+08:00";
const workspace = {
  id: "ws_preview",
  name: "herdock-retail",
  rootPath: "C:\\work\\herdock-retail",
  branch: "feature/order-audit",
  dirtySummary: "2 个文件",
  autoExecute: null as string | null,
  createdAt: now,
  updatedAt: now,
};
const sessions: Array<{
  id: string;
  workspaceId: string;
  title: string;
  kind: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}> = [
  {
    id: "sess_preview",
    workspaceId: workspace.id,
    title: "订单异常分析",
    kind: "mixed",
    providerId: "codex",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "sess_2",
    workspaceId: workspace.id,
    title: "修复结算页类型错误",
    kind: "coding",
    providerId: "claude",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "sess_3",
    workspaceId: workspace.id,
    title: "整理数据校验规则",
    kind: "analysis",
    providerId: "openai",
    createdAt: now,
    updatedAt: now,
  },
];
const run = {
  id: "RUN-8F2A1C4D",
  sessionId: sessions[0].id,
  workspaceId: workspace.id,
  providerId: "codex",
  model: "gpt-5.4-codex",
  status: "waiting_approval",
  prompt: "分析门店销售数据，定位异常订单并生成修复计划。",
  planProgress: "2/3",
  tokenUsage: { input: 4260, output: 1180, total: 5440 },
  createdAt: now,
  updatedAt: now,
};
const designRun = {
  id: "RUN-DESIGN-42",
  sessionId: sessions[0].id,
  workspaceId: workspace.id,
  providerId: "codex",
  model: "gpt-5.4-codex",
  status: "waiting_approval",
  prompt: "为 HerDock 设计一套清晰、克制的一体化产品首页，并给出两个可比较方案。",
  planProgress: "3/4",
  tokenUsage: { input: 3280, output: 960, total: 4240 },
  createdAt: now,
  updatedAt: now,
};
const designEvents = [
  {
    id: "design_evt_1",
    runId: designRun.id,
    type: "message.user",
    ts: now,
    seq: 1,
    text: designRun.prompt,
  },
  {
    id: "design_evt_2",
    runId: designRun.id,
    type: "message.assistant",
    ts: now,
    seq: 2,
    text: "已生成首个可运行方案。你可以在中间画布切换设备尺寸，或继续描述要调整的层级与视觉气质。",
  },
];
const events = [
  {
    id: "evt_0a",
    runId: run.id,
    type: "message.user",
    ts: "2026-08-15T18:40:00+08:00",
    seq: -2,
    text: "先把上个月的异常订单跑一遍基线报告，我晚点回来看。",
  },
  {
    id: "evt_0b",
    runId: run.id,
    type: "message.assistant",
    ts: "2026-08-15T18:42:00+08:00",
    seq: -1,
    text: "基线报告已生成到 `out/baseline-aug.csv`，共 214 单命中校验规则，其中 3 单需要人工确认。\n\n抽样复核结论如下：金额偏差集中在满减叠加区间，门店状态切换存在 2 小时窗口期，历史回放脚本已覆盖 92% 的场景。以下明细按门店分组，供后续对照：\n\n- 上海静安：12 单偏差超过 10%，其中 3 单同时触发状态校验\n- 杭州滨江：7 单偏差为负向，疑似重复满减\n- 深圳南山：4 单正向偏差，属正常促销口径\n\n基线口径与上月一致，未引入新的校验规则变更，回放产物位于 `out/replay-aug/`。",
  },
  { id: "evt_1", runId: run.id, type: "message.user", ts: now, seq: 1, text: run.prompt },
  {
    id: "evt_2",
    runId: run.id,
    type: "plan.updated",
    ts: now,
    seq: 2,
    steps: [
      { id: "1", title: "读取订单规则与门店数据", state: "done", durationMs: 1240 },
      { id: "2", title: "运行校验并定位异常记录", state: "done", durationMs: 2860 },
      { id: "3", title: "生成修复补丁与分析产物", state: "running" },
    ],
  },
  {
    id: "evt_3",
    runId: run.id,
    type: "message.assistant",
    ts: now,
    seq: 3,
    text: "已完成数据口径核对。3 条订单同时触发金额与门店状态校验，下面是本地验证结果。",
  },
  {
    id: "evt_3b",
    runId: run.id,
    type: "message.assistant",
    ts: now,
    seq: 13,
    text: [
      "### 修复方案",
      "",
      "异常集中在金额校验规则 `validateOrderTotal`，建议分三步处理：",
      "",
      "1. 把门店状态并入校验上下文",
      "2. 对历史订单回放新规则",
      "3. 生成对比报告确认无回归",
      "",
      "核心改动如下：",
      "",
      "```ts",
      "export function validateOrderTotal(order: Order, ctx: AuditContext) {",
      "  const expected = order.lines.reduce((sum, l) => sum + l.price * l.qty, 0);",
      "  if (Math.abs(order.total - expected) > ctx.tolerance) {",
      '    return { ok: false, reason: "total-mismatch" };',
      "  }",
      "  return { ok: true };",
      "}",
      "```",
      "",
      "> 注意：回放会写入 `out/replay.csv`，执行前请确认磁盘空间充足。",
    ]
      .join("\n")
      .replace(/^/, "\n\n"),
  },
  {
    id: "evt_tool_1",
    runId: run.id,
    type: "tool.requested",
    ts: now,
    seq: 14,
    toolCallId: "call_grep_1",
    name: "grep",
    arguments: { pattern: "validateOrderTotal", path: "src/rules" },
  },
  {
    id: "evt_tool_2",
    runId: run.id,
    type: "tool.output",
    ts: now,
    seq: 15,
    toolCallId: "call_grep_1",
    output:
      "src/rules/order-audit.ts:42: export function validateOrderTotal(order: Order) {\nsrc/rules/order-audit.ts:88:   if (!validateOrderTotal(order)) throw new AuditError(order.id);",
    failed: false,
  },
  {
    id: "evt_4",
    runId: run.id,
    type: "shell.start",
    ts: now,
    seq: 4,
    command: "pnpm test -- order-audit",
    cwd: workspace.rootPath,
    class: "read_only",
  },
  {
    id: "evt_5",
    runId: run.id,
    type: "shell.output",
    ts: now,
    seq: 5,
    stream: "stdout",
    text: "PASS src/order-audit.test.ts\n12 checks passed\n",
  },
  {
    id: "evt_6",
    runId: run.id,
    type: "shell.exit",
    ts: now,
    seq: 6,
    exitCode: 0,
    durationMs: 1920,
  },
  {
    id: "evt_7",
    runId: run.id,
    type: "file.edit_applied",
    ts: now,
    seq: 7,
    path: "src/rules/order-audit.ts",
    kind: "M",
    additions: 18,
    deletions: 4,
  },
  {
    id: "evt_8",
    runId: run.id,
    type: "file.edit_applied",
    ts: now,
    seq: 8,
    path: "out/order-anomalies.csv",
    kind: "A",
    additions: 4,
    deletions: 0,
  },
  {
    id: "evt_9",
    runId: run.id,
    type: "checkpoint.created",
    ts: now,
    seq: 9,
    checkpointId: "CP-38A2",
    label: "应用订单校验补丁前",
    snapshotRef: "local://CP-38A2",
  },
  {
    id: "evt_9b",
    runId: run.id,
    type: "checkpoint.created",
    ts: now,
    seq: 16,
    checkpointId: "CP-40C1",
    label: "生成报表前",
    snapshotRef: "local://CP-40C1",
  },
  {
    id: "evt_10",
    runId: run.id,
    type: "table.result",
    ts: now,
    seq: 10,
    caption: "异常订单",
    columns: [
      { key: "order", label: "订单" },
      { key: "store", label: "门店" },
      { key: "delta", label: "偏差" },
      { key: "status", label: "状态" },
    ],
    rows: [
      { order: "A-10482", store: "上海静安", delta: "+18.2%", status: "待确认" },
      { order: "A-10507", store: "杭州滨江", delta: "-12.8%", status: "异常" },
      { order: "A-10611", store: "深圳南山", delta: "+9.4%", status: "正向" },
    ],
  },
  {
    id: "evt_11",
    runId: run.id,
    type: "human.decision",
    ts: now,
    seq: 11,
    question: "是否应用修复规则并重新生成订单报表？",
    options: [
      { id: "apply", label: "应用并继续", primary: true },
      { id: "review", label: "先查看差异" },
    ],
  },
  {
    id: "evt_12",
    runId: run.id,
    type: "error",
    ts: now,
    seq: 17,
    message: "调用上游接口超时（60s），本次运行已中断，可重试恢复。",
    retriable: true,
  },
];
const providers = [
  {
    id: "codex",
    displayName: "Codex CLI",
    providerType: "cli",
    available: true,
    path: "codex.exe",
    version: "codex 1.0",
    auth: "cli",
    model: "gpt-5.4-codex",
    capabilities: ["chat", "workspace", "stream"],
  },
  {
    id: "claude",
    displayName: "Claude CLI",
    providerType: "cli",
    available: true,
    path: "claude.exe",
    version: "claude 1.0",
    auth: "cli",
    model: "claude-sonnet-4-6",
    capabilities: ["chat", "workspace", "stream"],
  },
  {
    id: "grok",
    displayName: "Grok Build CLI",
    providerType: "cli",
    available: true,
    path: "C:\\Users\\developer\\.grok\\bin\\grok.exe",
    version: "grok 1.0.0",
    auth: "oauth",
    model: "grok-4",
    detail: "已登录 developer@example.com",
    capabilities: ["chat", "workspace", "stream", "usage"],
  },
  {
    id: "openai",
    displayName: "OpenAI",
    providerType: "openai",
    available: true,
    auth: "keychain",
    model: "gpt-5.4",
    baseUrl: "https://api.openai.com",
    capabilities: ["chat", "tools", "usage"],
  },
];
const PREVIEW_CANDIDATE_MODELS: Record<string, string[]> = {
  codex: ["gpt-5.4-codex", "gpt-5.4", "gpt-5.4-mini"],
  claude: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-6"],
  grok: ["grok-4", "grok-4-fast", "grok-code-fast-1"],
  openai: ["gpt-5.4", "gpt-5.4-mini"],
};
const profiles = providers.map((provider) => ({
  id: provider.id,
  providerType: provider.providerType,
  displayName: provider.displayName,
  model: provider.model,
  baseUrl: provider.baseUrl,
  executable: provider.path,
  credentialRef: provider.providerType === "cli" ? undefined : `provider:${provider.id}`,
  enabled: true,
  config: { candidateModels: PREVIEW_CANDIDATE_MODELS[provider.id] || [] },
}));
const tree = [
  {
    name: "src",
    path: "src",
    kind: "dir",
    children: [
      {
        name: "rules",
        path: "src/rules",
        kind: "dir",
        children: [
          {
            name: "order-audit.ts",
            path: "src/rules/order-audit.ts",
            kind: "file",
            gitStatus: "M",
          },
        ],
      },
      { name: "index.ts", path: "src/index.ts", kind: "file" },
    ],
  },
  {
    name: "data",
    path: "data",
    kind: "dir",
    children: [
      { name: "stores.csv", path: "data/stores.csv", kind: "file" },
      { name: "orders.csv", path: "data/orders.csv", kind: "file" },
    ],
  },
  {
    name: "out",
    path: "out",
    kind: "dir",
    children: [
      {
        name: "order-anomalies.csv",
        path: "out/order-anomalies.csv",
        kind: "file",
        gitStatus: "A",
      },
    ],
  },
  { name: "AGENTS.md", path: "AGENTS.md", kind: "file" },
  { name: "herdock.yml", path: "herdock.yml", kind: "file" },
];
const fileContents: Record<string, string> = {
  "src/rules/order-audit.ts":
    "export function isAnomalous(total: number, expected: number) {\n  const delta = Math.abs(total - expected) / expected;\n  return delta > 0.08;\n}\n",
  "out/order-anomalies.csv":
    "order,store,delta,status\nA-10482,上海静安,18.2%,review\nA-10507,杭州滨江,-12.8%,error\n",
  "AGENTS.md": "# Workspace rules\n\nRead data files before editing validation rules.\n",
};
const previewDesignSystems: Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  scope: string;
  hasTokens: boolean;
}> = [
  {
    id: "default",
    name: "Neutral Modern",
    category: "Starter",
    description: "HerDock 内置的中性、清晰、产品化设计基线。",
    scope: "builtin",
    hasTokens: true,
  },
];

export function installDesignPreview() {
  mockWindows("main");
  mockIPC(
    (command, payload = {}) => {
      const args = payload as Record<string, unknown>;
      switch (command) {
        // ?design-preview&platform=mac renders the macOS chrome instead.
        case "app_platform":
          return new URLSearchParams(window.location.search).get("platform") === "mac"
            ? {
                os: "macos",
                arch: "aarch64",
                desktop: true,
                dataDir: "/Users/developer/Library/Application Support/HerDock",
                pathSeparator: "/",
                modifierKey: "⌘",
                commandHint: "⌘K",
                newHint: "⌘N",
                submitHint: "⌘↵",
                defaultShell: "zsh",
                windowControl: "macos",
              }
            : {
                os: "windows",
                arch: "x86_64",
                desktop: true,
                dataDir: "C:\\Users\\developer\\AppData\\Roaming\\HerDock",
                pathSeparator: "\\",
                modifierKey: "Ctrl",
                commandHint: "Ctrl K",
                newHint: "Ctrl N",
                submitHint: "Ctrl ↵",
                defaultShell: "PowerShell",
                windowControl: "windows",
              };
        case "settings_get":
          return {
            defaultProvider: "codex",
            defaultModel: "gpt-5.4-codex",
            autoExecute: "ask_risky",
            terminalShell: "",
            closeToTray: true,
            launchShortcut: "CommandOrControl+Shift+Space",
            updateChannel: "stable",
            httpProxy: "",
            setupComplete: true,
          };
        case "settings_save":
          return args.settings;
        case "doctor_run":
          return {
            generatedAt: now,
            checks: [
              {
                id: "data_dir",
                title: "数据目录",
                status: "ok",
                detail: "C:\\Users\\developer\\AppData\\Roaming\\HerDock",
              },
              {
                id: "proxy",
                title: "HTTP 代理",
                status: "warn",
                detail: "未配置。办公网访问公网 API 时可能需要在设置里填写 HTTP 代理。",
              },
              { id: "workspace", title: "工作区", status: "ok", detail: "已记录 1 个工作区" },
              { id: "providers", title: "Provider", status: "ok", detail: "3 个可用 / 4 个已启用" },
              { id: "network", title: "网络连通", status: "ok", detail: "已探测 3 个地址" },
            ],
            probes: [
              {
                url: "https://api.x.ai",
                status: "ok",
                detail: "可达（未授权，网络路径正常）",
                statusCode: 401,
                elapsedMs: 128,
              },
              {
                url: "https://api.openai.com",
                status: "ok",
                detail: "可达（未授权，网络路径正常）",
                statusCode: 401,
                elapsedMs: 142,
              },
              {
                url: "https://api.anthropic.com",
                status: "ok",
                detail: "可达（未授权，网络路径正常）",
                statusCode: 401,
                elapsedMs: 119,
              },
            ],
          };
        case "network_probe":
          return [
            {
              url: "https://api.x.ai",
              status: "ok",
              detail: "可达（未授权，网络路径正常）",
              statusCode: 401,
              elapsedMs: 128,
            },
            {
              url: "https://api.openai.com",
              status: "ok",
              detail: "可达（未授权，网络路径正常）",
              statusCode: 401,
              elapsedMs: 142,
            },
          ];
        case "doctor_export":
          return (
            (typeof args.destPath === "string" && args.destPath) ||
            "C:\\Users\\developer\\AppData\\Roaming\\HerDock\\diagnostics\\herdock-doctor.zip"
          );
        case "provider_list":
          return providers;
        case "provider_profiles":
          return profiles;
        case "provider_save":
          return args.request;
        case "provider_validate":
          return "连接成功";
        case "grok_auth_status":
          return {
            cliFound: true,
            cliPath: "C:\\Users\\developer\\.grok\\bin\\grok.exe",
            version: "grok 1.0.0",
            signedIn: true,
            expired: false,
            authMode: "oauth",
            email: "developer@example.com",
            displayName: "Xingzhi Dev",
            expiresAt: "2026-09-10T00:00:00Z",
            loginRunning: false,
            detail: "已通过官方 CLI 登录：developer@example.com",
          };
        case "grok_login":
          return {
            ok: true,
            method: args.method,
            message: "已登录 Grok Build：developer@example.com",
            timedOut: false,
            status: {
              cliFound: true,
              cliPath: "C:\\Users\\developer\\.grok\\bin\\grok.exe",
              version: "grok 1.0.0",
              signedIn: true,
              expired: false,
              authMode: "oauth",
              email: "developer@example.com",
              displayName: "Xingzhi Dev",
              loginRunning: false,
              detail: "已通过官方 CLI 登录：developer@example.com",
            },
          };
        case "grok_login_submit_code":
        case "grok_login_cancel":
          return null;
        case "grok_logout":
          return {
            cliFound: true,
            cliPath: "C:\\Users\\developer\\.grok\\bin\\grok.exe",
            version: "grok 1.0.0",
            signedIn: false,
            expired: false,
            loginRunning: false,
            detail: "尚未登录 Grok Build",
          };
        case "mcp_list":
          return [
            {
              id: "mcp_fs",
              name: "Workspace Files",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem"],
              env: { MCP_TOKEN: "********" },
              enabled: true,
              status: "ready",
              tools: ["read_file", "list_directory"],
            },
          ];
        case "mcp_test":
          return ["read_file", "list_directory"];
        case "mcp_start":
          return {
            id: args.id,
            name: "Workspace Files",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
            env: {},
            enabled: true,
            status: "ready",
            tools: ["read_file", "list_directory"],
          };
        case "mcp_stop":
          return {
            id: args.id,
            name: "Workspace Files",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
            env: {},
            enabled: false,
            status: "stopped",
            tools: ["read_file", "list_directory"],
          };
        case "mcp_save":
          return args.request;
        case "mcp_delete":
          return null;
        case "workspace_list":
          return [workspace];
        case "workspace_open":
        case "workspace_ensure_default":
          return workspace;
        case "workspace_delete":
          return null;
        case "workspace_set_auto_execute":
          workspace.autoExecute = (args.autoExecute as string | null | undefined) ?? null;
          return { ...workspace };
        case "workspace_tree":
          return tree;
        case "session_list":
          return sessions;
        case "session_rename": {
          const target = sessions.find((item) => item.id === args.id) || sessions[0];
          target.title = String(args.title || target.title);
          return { ...target };
        }
        case "session_delete": {
          const index = sessions.findIndex((item) => item.id === args.id);
          if (index >= 0) sessions.splice(index, 1);
          return null;
        }
        case "session_archive": {
          const target = sessions.find((item) => item.id === args.id);
          if (target) target.archivedAt = now;
          return target ? { ...target } : null;
        }
        case "session_unarchive": {
          const target = sessions.find((item) => item.id === args.id);
          if (target) target.archivedAt = undefined;
          return target ? { ...target } : null;
        }
        case "session_create": {
          const created = {
            id: `sess_${Date.now()}`,
            workspaceId: String(args.workspaceId || workspace.id),
            title: String(args.title || "新会话"),
            kind: String(args.kind || "mixed"),
            providerId: String(args.providerId || "codex"),
            createdAt: now,
            updatedAt: now,
          };
          sessions.unshift(created);
          return created;
        }
        case "session_fork": {
          const source = sessions.find((item) => item.id === args.id) || sessions[0];
          const created = {
            ...source,
            id: `sess_fork_${Date.now()}`,
            title: `${source.title} · 分叉`,
            createdAt: now,
            updatedAt: now,
            archivedAt: undefined,
          };
          sessions.unshift(created);
          return created;
        }
        case "file_reveal":
        case "workspace_reveal":
          return null;
        case "run_recent":
          return [designRun, run];
        case "run_list":
          return [designRun, run];
        case "run_events":
          return events;
        case "run_events_page":
          return { events: args.runId === designRun.id ? designEvents : events, hasMore: false };
        case "browser_create":
        case "browser_navigate":
        case "browser_search":
        case "browser_status":
          return {
            id: args.id,
            url: args.url || args.target || "https://www.bing.com/",
            title: "Browser Preview",
          };
        case "browser_snapshot":
          return {
            ok: true,
            url: "https://www.bing.com/",
            title: "Browser Preview",
            text: "Design preview browser surface",
            interactive: [],
          };
        case "browser_show":
        case "browser_set_bounds":
        case "browser_hide":
        case "browser_close":
        case "browser_back":
        case "browser_forward":
        case "browser_reload":
          return null;
        case "run_inputs":
          return {
            model: "",
            contextItemIds: [],
            skillIds: ["skill_review"],
            mcpServerIds: ["mcp_fs"],
          };
        case "run_checkpoints":
          return args.runId === designRun.id
            ? [
                {
                  id: "CP-DESIGN-1",
                  runId: designRun.id,
                  label: "生成初始首页方案",
                  snapshotRef: "local://CP-DESIGN-1",
                  createdAt: now,
                },
              ]
            : [
                {
                  id: "CP-38A2",
                  runId: run.id,
                  label: "应用订单校验补丁前",
                  snapshotRef: "local://CP-38A2",
                  createdAt: now,
                },
              ];
        case "checkpoint_preview":
          return {
            checkpointId: args.checkpointId,
            scope: "workspace",
            sizeBytes: 1536,
            files: [
              {
                path: "src/rules/order-audit.ts",
                kind: "modified",
                diff: "--- checkpoint/src/rules/order-audit.ts\n+++ src/rules/order-audit.ts\n@@ -1 +1 @@\n-return delta > 0.1;\n+return delta > 0.08;",
              },
            ],
          };
        case "approval_list":
          return [
            {
              approvalId: "approval_preview",
              runId: designRun.id,
              title: "写入工作区文件",
              detail: "src/rules/order-audit.ts",
              risk: "medium",
              kind: "workspace_write",
              scopeKey: "write_file:src/rules/order-audit.ts",
              createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
            },
            {
              approvalId: "approval_preview_2",
              runId: run.id,
              title: "执行 shell 命令",
              detail: "pnpm test --filter order-audit",
              risk: "high",
              kind: "shell",
              scopeKey: "run_command:pnpm test",
              createdAt: new Date(Date.now() - 42 * 1000).toISOString(),
            },
            {
              approvalId: "approval_preview_3",
              runId: run.id,
              title: "访问外部域名",
              detail: "docs.internal.example.com/order-spec",
              risk: "low",
              kind: "network",
              scopeKey: "network:docs.internal.example.com",
              createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
            },
          ];
        case "skill_list":
          return [
            {
              id: "skill_review",
              glyph: "R",
              name: "Code Review",
              status: "enabled",
              detail: "检查补丁风险与测试覆盖",
              path: ".agents/skills/review/SKILL.md",
              scope: "workspace",
            },
          ];
        case "schedule_list":
          return [
            {
              id: "schedule_1",
              workspaceId: workspace.id,
              name: "工作日订单检查",
              cron: "0 9 * * 1-5",
              prompt: "检查昨日订单异常",
              providerId: "codex",
              enabled: true,
              nextRunAt: "2026-08-11T09:00:00+08:00",
            },
          ];
        case "workspace_context":
          return {
            files: [
              { path: "AGENTS.md", kind: "rule", size: "86 B" },
              { path: "data/orders.csv", kind: "data", size: "24.8 KB" },
            ],
            rules: ["AGENTS.md"],
            outputDir: "out",
            testCommand: "pnpm test",
            autoExecute: "ask_risky",
          };
        case "context_list":
          return [
            {
              id: "ctx_orders",
              workspaceId: workspace.id,
              sourceKind: "workspace",
              displayName: "brand-tokens.css",
              relativePath: "styles/brand-tokens.css",
              mimeType: "text/css; charset=utf-8",
              sizeBytes: 25400,
              sha256: "preview",
              createdAt: now,
            },
          ];
        case "context_import":
          return (args.request as { paths: string[] }).paths.map((path, index) => ({
            id: `ctx_import_${index}`,
            workspaceId: workspace.id,
            sourceKind: "imported",
            displayName: path.split(/[\\/]/).pop(),
            storedPath: path,
            mimeType: String(path).toLowerCase().endsWith(".svg")
              ? "image/svg+xml; charset=utf-8"
              : String(path).toLowerCase().endsWith(".css")
                ? "text/css; charset=utf-8"
                : "text/plain; charset=utf-8",
            sizeBytes: 1200,
            sha256: `preview_${index}`,
            createdAt: now,
          }));
        case "context_import_bytes": {
          const request = args.request as {
            fileName: string;
            mimeType: string;
            bytesBase64: string;
          };
          return [
            {
              id: "ctx_import_bytes",
              workspaceId: workspace.id,
              sourceKind: "imported",
              displayName: request.fileName,
              storedPath: `preview/${request.fileName}`,
              mimeType: request.mimeType,
              sizeBytes: Math.floor((request.bytesBase64.length * 3) / 4),
              sha256: "preview_bytes",
              createdAt: now,
            },
          ];
        }
        case "context_remove":
          return null;
        case "usage_get":
          return {
            buckets: [{ key: "codex", label: "Codex CLI", tokens: 5440, runs: 1, calls: 1 }],
            context: { used: 4260, limit: 32000 },
          };
        case "usage_series": {
          const providers = ["codex", "claude", "openai"];
          const days: {
            day: string;
            providerId: string;
            inputTokens: number;
            outputTokens: number;
            calls: number;
          }[] = [];
          for (let back = 6; back >= 0; back -= 1) {
            const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
            providers.forEach((providerId, index) => {
              days.push({
                day,
                providerId,
                inputTokens: 18000 - back * 900 - index * 4200,
                outputTokens: 4200 - back * 180 - index * 700,
                calls: 12 - back - index * 3,
              });
            });
          }
          return {
            days,
            previousTokens: 268000,
            previousRuns: 41,
            topRuns: [
              {
                id: "RUN-311",
                title: "Q3 投放渠道 ROI 复盘",
                providerId: "openai",
                tokens: 102000,
                createdAt: now,
              },
              {
                id: run.id,
                title: run.prompt,
                providerId: "codex",
                tokens: 18600,
                createdAt: now,
              },
              {
                id: "RUN-330",
                title: "供应商合同风险初筛",
                providerId: "claude",
                tokens: 14200,
                createdAt: now,
              },
            ],
          };
        }
        case "run_queue":
          return [
            {
              runId: designRun.id,
              name: "HerDock 产品首页设计",
              workspaceId: workspace.id,
              status: "waiting_approval",
              meta: `${designRun.id} · 3/4`,
            },
          ];
        case "artifact_list":
          return [
            {
              id: "artifact_design",
              runId: designRun.id,
              workspaceId: workspace.id,
              path: "out/design/herdock-home/index.html",
              entryPath: "out/design/herdock-home/index.html",
              name: "HerDock 产品首页",
              ext: "html",
              kind: "html",
              renderer: "html",
              status: "complete",
              manifest: {
                schemaVersion: "herdock.design-artifact/v1",
                id: "herdock-home",
              },
              sizeBytes: 4820,
              createdAt: now,
            },
            {
              id: "artifact_1",
              runId: run.id,
              workspaceId: workspace.id,
              path: "out/order-anomalies.csv",
              name: "order-anomalies.csv",
              ext: "csv",
              kind: "file",
              status: "complete",
              manifest: {},
              sizeBytes: 1280,
              createdAt: now,
            },
          ];
        case "design_system_list":
          return previewDesignSystems;
        case "design_system_read": {
          const id = String(args.id || "default");
          const system =
            previewDesignSystems.find((item) => item.id === id) || previewDesignSystems[0];
          return {
            system,
            designMarkdown:
              fileContents[`.herdock/design-systems/${id}/DESIGN.md`] ||
              `# ${system.name}\n\nClear, calm product interface.`,
            tokensCss:
              fileContents[`.herdock/design-systems/${id}/tokens.css`] ||
              ":root { --accent: #3b5ba5; }",
          };
        }
        case "artifact_preview":
          return {
            path: String(args.path),
            html: "<!doctype html><html><head><style>body{margin:0;font:16px system-ui;background:#f5f2ea;color:#222}.hero{min-height:100vh;display:grid;place-items:center}.card{padding:48px;border:1px solid #ddd;background:white;border-radius:20px;box-shadow:0 20px 50px #0002}h1{font-size:48px;margin:0 0 12px}</style></head><body><main class='hero'><section class='card'><h1>HerDock Design</h1><p>Agent-native design workspace preview.</p></section></main></body></html>",
          };
        case "file_read": {
          const path = String(args.path);
          return {
            path,
            content: fileContents[path] || "",
            binary: false,
            language: path.endsWith(".ts") ? "typescript" : undefined,
          };
        }
        case "file_write": {
          const path = String(args.path);
          fileContents[path] = String(args.content);
          const match = /\.herdock\/design-systems\/([^/]+)\/DESIGN\.md$/.exec(path);
          if (match && !previewDesignSystems.some((item) => item.id === match[1])) {
            previewDesignSystems.push({
              id: match[1],
              name: match[1],
              category: "Workspace",
              description: "工作区设计系统",
              scope: "workspace",
              hasTokens: true,
            });
          }
          return null;
        }
        case "file_search":
          return [
            { path: "src/rules/order-audit.ts", line: 1, preview: "export function isAnomalous" },
          ];
        case "git_diff":
          return "diff --git a/src/rules/order-audit.ts b/src/rules/order-audit.ts\n+  return delta > 0.08;\n";
        case "file_preview": {
          const path = String(args.path || "");
          const ext = path.split(".").pop()?.toLowerCase() || "";
          if (ext === "pdf") {
            return {
              path,
              kind: "pdf",
              mime: "application/pdf",
              bytesBase64: null,
              tooLarge: false,
            };
          }
          if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) {
            return {
              path,
              kind: "image",
              mime: "image/png",
              bytesBase64:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              tooLarge: false,
            };
          }
          if (["docx", "xlsx", "pptx"].includes(ext)) {
            return {
              path,
              kind: ext,
              mime: "application/octet-stream",
              text: "设计预览：从 Office 文档抽出的纯文本。",
              tooLarge: false,
            };
          }
          return { path, kind: "unsupported", mime: "application/octet-stream", tooLarge: false };
        }
        case "git_worktree_list":
          return {
            available: true,
            items: [
              {
                path: workspace.rootPath,
                branch: "feature/order-audit",
                head: "8f2a1c4",
                bare: false,
                detached: false,
                locked: false,
                prunable: false,
                isMain: true,
                isCurrent: true,
              },
              {
                path: "C:\\work\\herdock-retail-hotfix",
                branch: "hotfix",
                head: "1a9e22b",
                bare: false,
                detached: false,
                locked: false,
                prunable: false,
                isMain: false,
                isCurrent: false,
              },
            ],
          };
        case "git_worktree_add":
          return {
            path: `C:\\work\\herdock-retail-${String(args.name || "branch")}`,
            branch: String(args.name || "branch"),
            head: "8f2a1c4",
            bare: false,
            detached: false,
            locked: false,
            prunable: false,
            isMain: false,
            isCurrent: false,
          };
        case "git_worktree_remove":
          return null;
        case "git_worktree_prune":
          return "Pruned 0 worktrees.";
        case "run_start":
          setTimeout(() => {
            for (const event of events.slice(0, 4)) void emit("run-event", event);
          }, 80);
          return { ...run, status: "running" };
        case "run_continue":
          return { ...run, id: "RUN-CONTINUE", status: "running" };
        case "run_retry":
          return { ...run, id: "RUN-RETRY", status: "queued" };
        case "policy_rule_list":
          return [
            {
              id: "rule_preview",
              ruleType: "provider_cli",
              scopeKey: `provider_cli:codex:${workspace.rootPath}`,
              effect: "allow",
              createdAt: now,
            },
          ];
        case "policy_rule_delete":
          return null;
        case "update_status":
          return {
            enabled: false,
            channel: "stable",
            currentVersion: "1.0.0",
            state: "disabled",
            message: "此构建未启用更新",
          };
        case "update_check":
        case "update_install":
          return {
            enabled: false,
            channel: "stable",
            currentVersion: "1.0.0",
            state: "disabled",
            message: "此构建未启用更新",
          };
        case "terminal_open":
          return "term_preview";
        case "terminal_write":
        case "terminal_resize":
        case "terminal_close":
          return null;
        case "run_cancel":
        case "approval_resolve":
        case "checkpoint_restore":
        case "schedule_delete":
        case "artifact_reveal":
        case "artifact_export":
          return null;
        case "schedule_toggle":
          return { ...args, id: args.id, enabled: args.enabled };
        case "schedule_save":
          return {
            ...(args.request as object),
            id: "schedule_new",
            nextRunAt: "2026-08-11T09:00:00+08:00",
          };
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}

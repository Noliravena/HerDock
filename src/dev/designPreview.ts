import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const now = "2026-08-10T10:24:00+08:00";
const workspace = {
  id: "ws_preview",
  name: "herdock-retail",
  rootPath: "C:\\work\\herdock-retail",
  branch: "feature/order-audit",
  dirtySummary: "2 个文件",
  createdAt: now,
  updatedAt: now,
};
const sessions = [
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
  status: "waiting_approval",
  prompt: "分析门店销售数据，定位异常订单并生成修复计划。",
  planProgress: "2/3",
  tokenUsage: { input: 4260, output: 1180, total: 5440 },
  createdAt: now,
  updatedAt: now,
};
const events = [
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
const profiles = providers.map((provider) => ({
  id: provider.id,
  providerType: provider.providerType,
  displayName: provider.displayName,
  model: provider.model,
  baseUrl: provider.baseUrl,
  executable: provider.path,
  credentialRef: provider.providerType === "cli" ? undefined : `provider:${provider.id}`,
  enabled: true,
  config: { candidateModels: provider.id === "openai" ? ["gpt-5.4", "gpt-5.4-mini"] : [] },
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

export function installDesignPreview() {
  mockWindows("main");
  mockIPC(
    (command, payload = {}) => {
      const args = payload as Record<string, unknown>;
      switch (command) {
        case "app_platform":
          return {
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
            defaultModel: "",
            autoExecute: "ask_risky",
            terminalShell: "",
            closeToTray: true,
            launchShortcut: "CommandOrControl+Shift+Space",
            updateChannel: "stable",
          };
        case "settings_save":
          return args.settings;
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
          return workspace;
        case "workspace_tree":
          return tree;
        case "session_list":
          return sessions;
        case "run_recent":
          return [run];
        case "run_list":
          return [run];
        case "run_events":
          return events;
        case "run_events_page":
          return { events, hasMore: false };
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
          return [
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
              runId: run.id,
              title: "写入工作区文件",
              detail: "src/rules/order-audit.ts",
              risk: "medium",
              kind: "write_path",
              scopeKey: "write_file:src/rules/order-audit.ts",
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
              displayName: "orders.csv",
              relativePath: "data/orders.csv",
              mimeType: "text/plain",
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
            mimeType: "text/plain",
            sizeBytes: 1200,
            sha256: `preview_${index}`,
            createdAt: now,
          }));
        case "context_remove":
          return null;
        case "usage_get":
          return {
            buckets: [{ key: "codex", label: "Codex CLI", tokens: 5440, runs: 1, calls: 1 }],
            context: { used: 4260, limit: 32000 },
          };
        case "run_queue":
          return [
            {
              runId: run.id,
              name: "订单异常分析",
              workspaceId: workspace.id,
              status: "waiting_approval",
              meta: `${run.id} · 2/3`,
            },
          ];
        case "artifact_list":
          return [
            {
              id: "artifact_1",
              runId: run.id,
              workspaceId: workspace.id,
              path: "out/order-anomalies.csv",
              name: "order-anomalies.csv",
              ext: "csv",
              sizeBytes: 1280,
              createdAt: now,
            },
          ];
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
          fileContents[String(args.path)] = String(args.content);
          return null;
        }
        case "file_search":
          return [
            { path: "src/rules/order-audit.ts", line: 1, preview: "export function isAnomalous" },
          ];
        case "git_diff":
          return "diff --git a/src/rules/order-audit.ts b/src/rules/order-audit.ts\n+  return delta > 0.08;\n";
        case "session_create":
          return sessions[0];
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

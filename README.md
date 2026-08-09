# her-dock · 行知 Agent 工作台

本地优先的 **Agent Developer Workbench**（员工版「开发者模式」）。

| 能力 | 状态 |
|------|------|
| Coding + 数据分析同一工作台 | ✅ UI |
| 桌面本地 shell / 无云端执行 | ✅ Host |
| Codex / Claude / Grok CLI | ✅ 探测 + 非交互 runner |
| 人手改文件 + Continue Run（磁盘优先） | ✅ |
| 组织策略 + 连接器 OAuth 模型 | ✅ 策略门禁 + demo connectors |
| 员工版入口 | ✅ `/developer` |

## 快速开始

```powershell
# 终端 1：本地 Host（:17890）
pnpm dev:host
# 或
.\artifacts\her-dock-host.exe -addr 127.0.0.1:17890

# 终端 2：Workbench UI（:5173）
pnpm install
pnpm dev:web
```

浏览器打开 <http://127.0.0.1:5173>：

1. **打开工作区**（例如 `examples/sample-workspace` 绝对路径）
2. 勾选 **Demo** 可无 API Key 演示 PLAN/TERMINAL/EDITS/TABLE/HITL
3. 取消 Demo 则调用本机 `codex` / `claude` / `grok`
4. 在代码 Tab 用 Monaco **人手修改** → **Continue Run**

Host 离线时 UI 自动回落设计稿 fixture。

## 结构

```text
apps/
  web/                 Workbench UI（三栏 + Monaco + SSE）
  desktop/             Go Host（FS / shell / providers / sqlite / policy）
packages/
  agent-protocol/      事件与 Host 契约
  policy/              策略求值
  shared/
schemas/               JSON Schema + fixtures
examples/sample-workspace/
docs/
```

## 命令

| 命令 | 说明 |
|------|------|
| `pnpm dev:host` | 启动本地 Host |
| `pnpm dev:web` | 启动 UI |
| `pnpm build` | 构建 TS 包与 web |
| `pnpm build:host` | 编译 `artifacts/her-dock-host.exe` |
| `pnpm typecheck` | 全仓类型检查 |

## 员工版

`what-herstaff-project` 侧栏已增加 **开发者模式** → `/developer`，说明如何启动 her-dock。

## 文档

- [架构](./docs/architecture.md)
- [Provider 矩阵](./docs/provider-matrix.md)
- [员工版对接](./docs/herstaff-integration.md)
- [开发者模式入口](./docs/developer-mode-entry.md)
- [Host API](./apps/desktop/README.md)

## 验收对照

- [x] 仅本地 Host 执行 Agent；无云端执行路径  
- [x] 三 Provider 探测；runner 可调用  
- [x] Continue Run + HumanEditSummary / git diff  
- [x] 组织策略写拒绝（.env / secrets）  
- [x] 连接器列表 + 审批 UI  
- [x] 员工版开发者模式入口  
- [x] Coding / 分析 quick prompts + 样例工作区  

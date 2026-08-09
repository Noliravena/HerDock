# her-dock · 行知 Agent 工作台

本地优先的 **Agent Developer Workbench**（员工版「开发者模式」）。

| 能力 | 状态 |
|------|------|
| Coding + 数据分析同一工作台 | ✅ UI |
| 「行知 Agent 工作台」设计稿视觉体系 | ✅ Web + 桌面同一套 UI |
| 平台外壳差异（浏览器 / macOS / Windows） | ✅ 由 Host `/v1/platform` 驱动 |
| 桌面本地 shell / 无云端执行 | ✅ Host |
| Codex / Claude / Grok CLI | ✅ 探测 + 非交互 runner |
| 人手改文件 + Continue Run（磁盘优先） | ✅ |
| 组织策略 + 连接器 OAuth 模型 | ✅ 策略门禁 + demo connectors |
| 技能 / 上下文 / 用量 / 定时任务面板 | ✅ Host 接口 + 右侧栏 |
| 员工版入口 | ✅ `/developer` |

## 界面（对照设计稿）

| 区域 | 内容 |
|------|------|
| 平台外壳 | 网页版地址栏；macOS 交通灯嵌在侧栏顶部；Windows 标题栏 + 最小化/最大化/关闭 |
| 左侧栏 230px | 品牌 + 搜索、新建会话 / 活动、工作区分组（按时间/状态/名称，可折叠）、技能 / 连接器 / 产物库、用户卡片与 credits |
| 中央 | 标签栏（会话 / 文件 / 差异 / 活动，可关闭，脏标记）+ 运行胶囊；会话视图为 PLAN / TERMINAL / EDITS / CHECKPOINTS / TABLE / RELATED RUNS / 「需要你决定」卡片流 |
| 输入区 | 快捷指令 chip、@ 引用文件、自动执行 / 会话类型 / Provider / Demo、圆形发送键 |
| 右侧栏 322px | 工作区文件树、审批 + 连接器、上下文（已加载文件 / 工作区规则 / 上下文占用）、技能、用量（算力 / 运行环境 / 定时任务 / 产物） |
| 状态栏 26px | 运行队列弹层、工作区与分支、未采纳差异、本地文件夹（桌面）、tokens、credits |
| 命令面板 | `⌘K` / `Ctrl K`，跳转（会话 + 文件）与动作两组 |

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
4. 在代码 Tab 用 Monaco **人手修改** → **采纳并继续**

桌面形态：先 `pnpm --filter @her-dock/web build`，再启动 Host，直接访问
<http://127.0.0.1:17890> —— Host 会把同一套 UI 挂在根路径，并按宿主系统渲染
macOS / Windows 原生窗口外壳；浏览器标签页始终保持网页版外壳。

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

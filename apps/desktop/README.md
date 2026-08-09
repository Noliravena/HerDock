# her-dock Host（本地运行时）

本地 HTTP Host：工作区 FS、shell、CLI Provider、sqlite、策略门禁、SSE 事件。

## 运行

```powershell
cd apps/desktop
go run . -addr 127.0.0.1:17890
```

或使用仓库根目录：

```powershell
pnpm dev:host
```

数据目录默认：`%USERPROFILE%\.her-dock\`

## 运行 Workbench UI（桌面形态）

Host 会自动挂载已构建的 UI（`apps/web/dist`、`./ui`，或 `-ui <dir>` 指定），
访问 `http://127.0.0.1:17890` 即可得到与网页版同一套「行知 Agent 工作台」界面，
并按 `runtime.GOOS` 渲染 macOS / Windows 原生窗口外壳。

```powershell
pnpm --filter @her-dock/web build
go run -C apps/desktop . -addr 127.0.0.1:17890
```

## API 摘要

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/v1/platform` | 宿主 OS、窗口外壳、快捷键提示（驱动 UI 平台差异） |
| GET | `/v1/providers` | 探测 codex/claude/grok |
| GET | `/v1/policy` | 组织策略（demo） |
| GET | `/v1/connectors` | 连接器列表 |
| GET | `/v1/skills` | 技能面板（`?workspaceId=` 合并 xingzhi.yml 声明） |
| GET | `/v1/queue` | 状态栏「运行队列」 |
| GET | `/v1/usage` | 用量面板（`?runId=` 含本次会话） |
| GET/POST | `/v1/schedules` | 定时任务列表 / 创建更新（cron 计算下次触发） |
| DELETE | `/v1/schedules/{id}` | 删除定时任务 |
| POST | `/v1/workspaces` | `{ "path": "D:\\work\\repo" }` 打开工作区 |
| GET | `/v1/workspaces/{id}/tree` | 文件树 |
| GET/PUT | `/v1/workspaces/{id}/file` | 读/写文件 |
| GET | `/v1/workspaces/{id}/file-diff` | 单文件 `git diff HEAD`（差异视图） |
| GET | `/v1/workspaces/{id}/context` | 上下文文件 + 工作区规则（解析 xingzhi.yml） |
| GET | `/v1/workspaces/{id}/artifacts` | 产物库 |
| POST | `/v1/runs` | 启动 run（`demo:true` 可无 CLI key） |
| POST | `/v1/runs/{id}/continue` | 人手改后继续 |
| POST | `/v1/runs/{id}/decision` | 回答「需要你决定」卡片 |
| GET | `/v1/runs/{id}/usage` | 单次 run 的 token 统计 |
| GET | `/v1/events` | SSE `run:event` |

## 与 Wails

当前以 **HTTP Host** 为主运行时，便于 Vite 热更新联调。后续可用 Wails 嵌入同一 `internal/host` 并绑定等价方法。

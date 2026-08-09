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

## API 摘要

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/v1/providers` | 探测 codex/claude/grok |
| GET | `/v1/policy` | 组织策略（demo） |
| POST | `/v1/workspaces` | `{ "path": "D:\\work\\repo" }` 打开工作区 |
| GET | `/v1/workspaces/{id}/tree` | 文件树 |
| GET/PUT | `/v1/workspaces/{id}/file` | 读/写文件 |
| POST | `/v1/runs` | 启动 run（`demo:true` 可无 CLI key） |
| POST | `/v1/runs/{id}/continue` | 人手改后继续 |
| GET | `/v1/events` | SSE `run:event` |

## 与 Wails

当前以 **HTTP Host** 为主运行时，便于 Vite 热更新联调。后续可用 Wails 嵌入同一 `internal/host` 并绑定等价方法。

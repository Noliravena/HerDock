# 与行知员工版（what-herstaff）对接草案

## 产品关系

- **同一产品**：员工版侧栏/设置增加「开发者模式 / Agent 工作台」
- **执行隔离**：Agent 只在 her-dock 桌面 Host 本地跑；员工版 Web 不 spawn CLI
- **身份复用**：同一组织 Session / 桌面 keyring，不另建账号体系

## 入口

| 端 | 行为 |
|----|------|
| 员工版 Desktop | 打开/聚焦 her-dock，传入 launch payload |
| 员工版 Web | 显示「请使用桌面端」+ 打开协议 / 下载说明 |
| her-dock 冷启动 | 可独立打开本地工作区；策略拉取失败则用 offline strict default |

### Launch payload

见 `@her-dock/agent-protocol` → `DeveloperModeLaunchPayload`：

```json
{
  "orgId": "org_xxx",
  "accessToken": "<short-lived>",
  "apiBaseUrl": "https://app.xingzhi.work",
  "workspacePath": "D:\\\\work\\\\northlake-crm",
  "preferredProvider": "codex"
}
```

建议 URL scheme：`xingzhi://workbench?payload=<base64url-json>`（实现阶段再定签名）。

## 最小 API 集（员工版 backend）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/auth/desktop/exchange` | 换取短时 access token（可复用现有 session 机制） |
| GET | `/api/v1/orgs/{orgId}/policies` | 返回 `PolicyBundle` JSON |
| GET | `/api/v1/orgs/{orgId}/connectors` | 连接器列表与状态 |
| POST | `/api/v1/orgs/{orgId}/connectors/{id}/oauth/start` | 开始 OAuth |
| POST | `/api/v1/orgs/{orgId}/connectors/{id}/oauth/refresh` | 刷新 token |
| POST | `/api/v1/audit/agent-runs` | **可选**，仅元数据审计，默认关，不上传源码 |

Phase 0–2 可用 **mock policy server** 或静态 JSON；不阻塞本地 CLI 打通。

## PolicyBundle 字段

与 `@her-dock/agent-protocol` 的 `PolicyBundle` 对齐：

- `version`, `orgId`, `maxAutoExecute`
- `forceApprovalClasses`, `readAllow`, `writeAllow`, `writeDeny`
- `networkAllow`, `networkDefaultDeny`, `enabledConnectors`

## 一期不做

- 将 herstaff 整仓合并进 her-dock monorepo  
- 云端执行 Agent / 远端 sandbox worker  
- 在员工版 Web 内嵌完整 IDE  

# her-dock 架构说明

## 定位

行知 **员工版** 中的「开发者模式」：本地优先的 Agent Developer Workbench。

- 通用 Coding Agent + 数据/业务分析 Agent 同一 UI
- 执行仅限 **桌面本地 shell**，无云端 Agent 执行
- 推理引擎：本机 **Codex / Claude / Grok CLI**
- 权限：**组织策略 + 连接器 OAuth**（本地写/ shell 也受门禁）
- 编辑器可人手修改，**Continue Run** 以磁盘内容为准并注入改动摘要

## 进程边界

| 进程 | 技术 | 职责 |
|------|------|------|
| Workbench UI | React + Vite（`apps/web`） | Thread、Monaco、审批、命令面板 |
| Desktop Host | Wails + Go（`apps/desktop`，Phase 1） | FS、shell、CLI spawn、sqlite、keyring、策略执行 |
| 员工版 API | 现有 herstaff backend | 登录、PolicyBundle、连接器 OAuth |

浏览器单独打开 UI 时 **不能** 跑 CLI；仅展示 mock/历史与安装桌面端引导。

## 包结构

```text
packages/agent-protocol  事件 / Run / Provider / HostBridge 契约
packages/policy          策略求值（write/shell/network + autoExecute clamp）
packages/shared          通用常量与轻量共享
apps/web                 Workbench UI
apps/desktop             本地 Host（待脚手架）
schemas/                 JSON Schema + fixtures
```

## 事件流

```text
CLI (codex|claude|grok)
  → desktop adapter (normalize)
  → AgentEvent
  → Wails event "run:event"
  → UI Thread cards (PLAN / TERMINAL / EDITS / …)
```

UI **禁止**解析各 CLI 私有日志格式。

## Continue Run

1. Run → `waiting_human` 或用户 Pause  
2. Monaco 保存改动到磁盘  
3. Host 生成 `HumanEditSummary`（paths + diff 摘要，`diskWins: true`）  
4. `continueRun`：优先 provider resume，否则摘要重开  
5. 与未采纳 Agent patch 冲突时弹出列表，**磁盘优先**

## 策略优先级

1. 组织 `PolicyBundle`（不可被工作区放宽）  
2. `xingzhi.yml` 仅可收紧 `autoExecute`、补充 writeAllow（仍过 org 校验）  
3. 用户「始终允许」每次仍走 `evaluate*`  
4. 连接器 OAuth scope 门禁外部 API

## 员工版集成

- 入口：侧栏/用户菜单「开发者模式」  
- 桌面：deep-link / 启动 her-dock，携带 `DeveloperModeLaunchPayload`  
- Web：提示使用桌面端  
- 一期 **不合并** herstaff monorepo，仅 API 契约对接

## 相关文档

- [Provider 能力矩阵](./provider-matrix.md)
- 设计稿：`artifacts/design-handoff/.../行知 Agent 工作台.dc.html`

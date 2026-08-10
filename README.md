# HerDock · 行知

HerDock 是一个本地优先、开源的桌面 Agent Development Environment（ADE）。应用只提供 Windows 与 macOS 桌面版本，不包含账号、组织、额度、分享、云同步、远程执行或 HerDock Cloud。

## 能力

- 三栏工作台：会话、Monaco 编辑器、Git Diff、活动、审批与上下文
- 动态工作标签：通过 `+` 创建浏览器、Agent、终端、编辑器或活动视图
- 内置原生浏览器：多标签、地址导航、网页搜索、前进后退、刷新与页面结构读取
- Browser Use：LLM 可读取页面、搜索、导航、点击和输入，副作用操作进入统一审批
- 工作区文件树、搜索、新建、重命名、删除、保存与二进制只读提示
- Rust PTY：Windows ConPTY、macOS PTY、多终端与尺寸同步
- Agent Run：计划、流式回复、工具调用、审批、检查点、usage、取消与本地历史
- Provider：Codex CLI、Claude CLI、Grok Build CLI、OpenAI、Anthropic、xAI、自定义 OpenAI-compatible API
- 本地连接：项目/全局 `SKILL.md` 与 MCP stdio 服务
- 本地产物、活动、Cron 定时任务、托盘、通知与全局快捷键

## 技术栈

`React 19 + TypeScript + Vite + Tauri 2 + Rust + SQLite`

前端只通过 Tauri Commands 和有序 Channel 调用 Rust。前端通信不包含 REST、SSE、CORS 或 localhost 业务服务，项目也不包含 Go sidecar 或 Web 发布入口。

## 开发

要求 Node.js 20.19+、pnpm 10.26+、Rust 1.77.2+，并安装对应平台的 Tauri 系统依赖。

```powershell
pnpm install
pnpm desktop
```

常用命令：

```powershell
pnpm dev             # 仅启动 Vite，用于界面开发
pnpm check           # TypeScript 类型检查
pnpm build           # 前端生产构建
pnpm build:desktop   # 当前平台桌面安装包
```

Provider 的默认模型和本地候选模型均在设置中维护；Composer 可为单次 Run 覆盖模型，应用不会远程抓取模型目录。

Grok Build CLI 支持在 Provider 设置中直接完成官方 OAuth 或设备码登录、粘贴浏览器验证码、取消登录和退出。HerDock 只展示 `~/.grok/auth.json` 中的非敏感账号资料，token 不会写入 SQLite、日志或 RunEvent。

## 数据与凭据

- 新数据库位于 Tauri 应用数据目录中的 `herdock-v1.db`。
- 不读取、迁移或删除旧 Go 版本数据库。
- API Key 仅保存到 Windows Credential Manager 或 macOS Keychain；SQLite 只保存引用。
- 工作区路径会被规范化，并拒绝 `..`、绝对路径和符号链接逃逸。
- 外部文本附件复制到应用数据目录并按 SHA-256 去重；拒绝二进制文件和超过 2 MiB 的单文件。

## 文档

- [架构](./docs/architecture.md)
- [Provider 矩阵](./docs/provider-matrix.md)
- [安全模型](./docs/security.md)
- [构建与发布](./docs/distribution.md)
- [性能边界](./docs/performance.md)
- [Browser Use](./docs/browser-use.md)
- [设计验收](./docs/design-qa.md)

## License

[MIT](./LICENSE)

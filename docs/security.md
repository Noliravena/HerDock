# 安全模型

## 工作区隔离

- 业务命令接收相对路径，拒绝绝对路径与 `..`。
- 读取目标必须先 canonicalize，并保持在工作区 canonical root 内。
- 新文件写入会检查最近已存在祖先，阻止符号链接逃逸。
- 写入采用同目录临时文件替换，降低部分写入风险。

## 进程

- Provider CLI、MCP 与工具命令全部使用 executable + args 数组。
- 不提供任意 Shell 字符串命令接口。
- PTY 是用户显式打开的独立终端，不与 Agent 子进程共享句柄。
- 活动 Run 使用 cancellation token；API 请求 future 被丢弃，CLI 子进程被终止。
- Grok Build 登录同样使用独立进程组；取消、超时和应用退出都会终止完整登录进程树。

## 审批

修改类动作默认进入审批：允许一次、按精确 `scope_key` 始终允许或拒绝。永久规则保存在 SQLite，但每次仍按精确规则匹配。

## 浏览器

- 浏览器仅允许 `http` 与 `https`，拒绝 `javascript:`、`file:` 和其他协议。
- 远程网页不配置 Tauri remote capability，不能直接调用 HerDock Commands。
- LLM 只能调用预定义的页面快照、导航、搜索、点击与输入工具，不能提交任意 JavaScript。
- 页面内容始终视为不可信输入，不得覆盖系统指令，也不得诱导 Agent 读取或泄露本地凭据。
- 导航、搜索、点击和输入均进入审批；输入正文不会写入审批详情，规则只保存短哈希。
- 页面快照和脚本返回值有大小限制，避免超大 DOM 持续占用 Run 上下文和内存。

## 凭据

API Key 写入 Windows Credential Manager 或 macOS Keychain。数据库中的 `provider_profiles.credential_ref` 只保存键名。Grok Build OAuth 凭据由官方 CLI 保存在 `~/.grok/auth.json`，HerDock 只将 token 是否存在归约为布尔登录状态。日志、Channel、RunEvent 和导出数据均不得包含密钥或 token。

## 报告问题

请按 [SECURITY.md](../SECURITY.md) 进行私下披露，不要在公开 Issue 中提交密钥、数据库或工作区内容。

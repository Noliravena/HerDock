# Provider 能力矩阵

本机探测（开发环境）：

| CLI | 路径示例 |
|-----|----------|
| codex | `%LocalAppData%\Programs\OpenAI\Codex\bin\codex.exe` |
| claude | `%USERPROFILE%\.local\bin\claude.exe` |
| grok | `%USERPROFILE%\.grok\bin\grok.exe` |

## 能力

| 能力 | Codex | Claude | Grok |
|------|-------|--------|------|
| 非交互执行 | `codex exec` | `claude -p` | prompt + flags |
| 会话继续 | 支持（session/app-server） | resume / continue | `-c` / continue |
| 结构化流 | app-server / exec 输出 | stream-json（若启用） | TUI/agent 事件（适配层解析） |
| 原生 apply diff | `codex apply` | 无（Host 写盘） | 无（Host 写盘） |
| 策略规则注入 | sandbox / policy | permission flags | `--allow` 等 |
| 工作目录 | cwd | `--add-dir` / cwd | `--cwd` |

`packages/agent-protocol` 中 `DEFAULT_CAPABILITIES` 与上表一致，适配器 `detect()` 可覆盖。

## 归一事件

所有 Provider 必须产出 `AgentEvent`（见 `schemas/agent-events.schema.json`）：

- `message.*` · `plan.updated` · `shell.*` · `file.edit_*`
- `approval.*` · `checkpoint.created` · `artifact.created`
- `run.status` · `usage.tokens` · `table.result` · `human.decision` · `error`

## 接入顺序建议

1. **Phase 1**：选本机最稳的一条（Codex `exec` 或 Grok non-interactive）端到端  
2. **Phase 3**：补齐其余两个 + 设置页健康检查  
3. 自定义 Provider：实现同一 `AgentProvider` 接口即可

## 失败与降级

| 情况 | 行为 |
|------|------|
| CLI 未安装 | `ProviderHealth.available=false`，设置页引导安装 |
| 未登录 | `auth=logged_out`，引导 `login` 子命令 |
| 流式协议变更 | 适配器隔离；fixture 契约测试兜底 |
| continue 不支持 | 使用 HumanEditSummary + 新 session 重开 |

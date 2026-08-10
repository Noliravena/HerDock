# Provider 能力矩阵

| Provider | 类型 | 流式输出 | 工具调用 | Usage | 取消 | 凭据 |
|---|---|---:|---:|---:|---:|---|
| Codex | 本机 CLI | JSONL | CLI 内部并记录 | 是 | 进程树终止 | CLI 登录态 |
| Claude | 本机 CLI | `stream-json` | CLI 内部并记录 | 是 | 进程树终止 | CLI 登录态 |
| Grok Build | 本机 CLI | `streaming-json` | CLI 内部并记录 | 是 | 进程树终止 | 官方 OAuth / 设备码 |
| OpenAI | Direct API | SSE | 是 | 是 | 请求取消 | 系统密钥库 |
| Anthropic | Direct API | SSE | 是 | 是 | 请求取消 | 系统密钥库 |
| xAI | OpenAI-compatible | SSE | 是 | 服务端支持时 | 请求取消 | 系统密钥库 |
| 自定义兼容端点 | OpenAI-compatible | SSE | 是 | 服务端支持时 | 请求取消 | 可选系统密钥库 |

## CLI 调用

CLI 适配器只使用 executable 和参数数组，不经过 Shell，也不拼接可执行命令字符串。可执行文件路径可在设置中覆盖，否则从 `PATH` 探测。Grok Build 还会探测 Windows 的 `~/.grok/bin/grok.exe` 以及 macOS 常见安装目录。

CLI 机器输出统一映射为消息、计划、工具、usage 与结构化错误 RunEvent。HerDock 不拦截 CLI 内部每一次工具审批；它通过运行级精确审批、工作区 sandbox、预运行检查点和最终 Diff 控制风险。

## Grok Build 登录

Provider 设置提供 OAuth 与设备码两种官方 CLI 登录方式，对应 `grok login --oauth` 和 `grok login --device-auth`。HerDock 会立即打开 CLI 输出的官方 `x.ai` / `grok.com` 登录地址，也支持把浏览器显示的反向验证码写入登录进程 stdin；登录可取消，并设有 120 秒超时。

凭据仍由 Grok Build CLI 保存到 `~/.grok/auth.json`。HerDock 只读取登录方式、邮箱、姓名和过期时间等非敏感字段，绝不返回、记录或复制 access token 与 refresh token。退出使用 `grok logout`，不会自行删除其他 Grok 配置文件。

登录完成后，Run 继续使用每次独立的 `grok --single --output-format streaming-json --permission-mode acceptEdits --sandbox workspace-write --no-memory` 进程。这与 HerDock 的运行级审批、取消和检查点生命周期保持一致。

## API 工具

统一工具集为 `read_file`、`list_files`、`search_files`、`write_file`、`run_command` 和 `git_diff`。所有路径均限制在当前工作区；`run_command` 的 program 与 args 分离。

## 兼容端点

自定义端点需要填写 Base URL 和模型名。Base URL 可以包含或省略 `/v1`。服务端需兼容 Chat Completions SSE 与 OpenAI tool calls；HerDock 不假定服务端支持 `stream_options`。

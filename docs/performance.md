# 性能边界

HerDock 对长会话采用有界加载与增量传输，避免历史总量直接决定启动、IPC 和 DOM 成本。

## 长会话

- 打开 Run 时只读取最近 500 条 `RunEvent`，更早内容通过 `seq` 游标继续加载。
- 前台实时窗口最多保留 2,000 条事件；超过后保留最新事件并显示历史加载入口。
- API 与 CLI 文本增量按 80 ms 或 4 KiB 合并后写入 SQLite 并发送到前端。
- CLI 机器输出不再逐行重复写入事件；诊断尾部最多保留 64 KiB。
- Provider 上下文由 SQLite 直接读取最近 24 条消息，不先加载整个 session。
- `run_events(run_id, seq)` 与 `messages(session_id, created_at)` 均有顺序索引。

## 渲染边界

- 终端默认挂载最近 400 行。
- 表格默认挂载前 200 行。
- 正文超过 40,000 字符、工具参数或结果超过 20,000 字符时显示首尾预览。
- 所有折叠内容均可手动完整展开；屏幕外 Turn 使用 `content-visibility: auto` 跳过布局与绘制。
- Store 使用字段级浅比较订阅，流式事件不会触发侧栏、设置、状态栏和非活动视图的无关刷新。

## 启动与分包

终端、Monaco 编辑器、Diff、Activity 与设置按需加载。2026-08-10 的本地生产构建中，首屏 JavaScript 从 770.28 kB（gzip 207.19 kB）降至约 377 kB（gzip 约 107 kB）；xterm.js 所在终端块只在打开终端时加载。

相关回归由 `Thread.performance.test.tsx`、`workbench.performance.test.ts` 和数据库分页测试覆盖，完整门禁使用 `pnpm check`。

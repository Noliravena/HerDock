# assistant-ui Elements 全量评审（122 个组件 → HerDock 落点）

来源：<https://www.assistant-ui.com/elements>（Reasoning 7 / Messages 16 / Tool use 13 /
Knowledge 9 / Structured output 13 / Agents 12 / Observability 3 / Composer 12 / Voice 2 /
Thread 13 / Generative 22，共 122）。

图例：**新增** = 本次按元素实现；**替换** = 用元素的模式重做既有表面；**已有** =
此前已按该元素的模式实现；**不适用** = 项目无对应数据源或平台，附原因。

说明：Elements 官方组件为 Tailwind 复制粘贴件并需接入其 headless runtime；本项目为
自写 CSS + 自有事件流，因此按每个元素的 DOM 解剖与交互模式在本项目体系内落地，
类名沿用 `chat.css` 中的 `bui-* / cm-* / gen-*` 系列。

## Reasoning（7）

| #   | 元素                      | 状态   | HerDock 落点                                                                             |
| --- | ------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| 1   | Loading state（像素矩阵） | 新增   | `GenerationLoader`（3×3 像素钟，tick 驱动）：Thread 等待首字阶段、Suspense `ViewLoading` |
| 2   | Thinking indicator        | 已有   | `ThinkingIndicator`：脉冲点 + shimmer 标签 + 计时（composer 状态条）                     |
| 3   | Reasoning panel           | 已有   | `bui-trace` 思考面板（可折叠步骤、live shimmer、耗时）                                   |
| 4   | Streaming text            | 已有   | `stream-words`：新词着色淡入、光标脉冲                                                   |
| 5   | Typing indicator（三点）  | 新增   | `TypingDots`：加载更早历史时的轻量等待态                                                 |
| 6   | Reasoning effort          | 不适用 | 后端无思考预算（budget/spent）数据                                                       |
| 7   | Guardrail notice          | 不适用 | 策略拦截走审批流（`human.decision` 卡片），无独立拒绝文案事件                            |

## Messages（16）

| #   | 元素                          | 状态   | HerDock 落点                                                      |
| --- | ----------------------------- | ------ | ----------------------------------------------------------------- |
| 8   | Message pair                  | 已有   | 用户右对齐气泡 + 助手通栏（`turn.user` / `turn`）                 |
| 9   | Message branches              | 不适用 | 运行模型为线性 run，无消息分支                                    |
| 10  | Message actions               | 替换   | `TurnActions`：复制（✓ 原位确认）+ 重试（进行中态），悬停显示     |
| 11  | Follow-up suggestions         | 替换   | 追问建议移到助手回合尾部（`thread-followups`），不再挤占 composer |
| 12  | Error state                   | 已有   | `bui-error` 静默横幅 + 重试                                       |
| 13  | Message queue                 | 已有   | 队列状态（store `queue`）+ ActivityView 运行列表                  |
| 14  | Attachments in a message      | 已有   | composer 上下文 chips（`ref-chip`，含移除）                       |
| 15  | Edit a sent message           | 新增   | 用户气泡内联编辑（textarea + 取消/保存，保存填回输入框）          |
| 16  | Quote reply                   | 不适用 | 选区浮动工具栏暂缺（后续可加）                                    |
| 17  | Feedback dialog               | 不适用 | 无反馈上报通道                                                    |
| 18  | Stopped run                   | 新增   | `stopped-note`：运行已停止说明 + 「继续」（continueRun）          |
| 19  | Timing footer                 | 新增   | `turn-timing`：时长 + in/out/total tokens                         |
| 20  | Timestamps / day separator    | 已有   | `msg-time` + `day-sep`                                            |
| 21  | Speaker identity              | 已有   | `turn-speaker`：模型名（等宽小标 + 状态点）                       |
| 22  | Regenerate with another model | 部分   | 重试沿用当前模型；换模型走模型菜单后重试                          |
| 23  | Confidence markers            | 不适用 | 无置信度数据                                                      |

## Tool use（13）

| #   | 元素             | 状态   | HerDock 落点                                       |
| --- | ---------------- | ------ | -------------------------------------------------- |
| 24  | Tool call        | 已有   | `bui-chip` ToolCard（图标推断、状态点、参数/输出） |
| 25  | Tool timeline    | 不适用 | 工具调用内联于消息流，时间线视图暂无对应面         |
| 26  | Terminal block   | 已有   | TerminalCard（命令头 + 输出折叠 + 行数上限）       |
| 27  | Code diff        | 已有   | EditsChip + DiffView 中央差异面板                  |
| 28  | Reviewable diff  | 不适用 | 逐 hunk 采纳/丢弃需要后端补丁粒度 API              |
| 29  | File tree        | 已有   | FilesPanel / FileTree                              |
| 30  | Elicitation form | 已有   | `human.decision` 决策卡（选项 + 自定义回复）       |
| 31  | MCP server panel | 已有   | McpView + 设置页 MCP 管理                          |
| 32  | Parallel tools   | 不适用 | 事件流顺序渲染，暂无并行分组需求                   |
| 33  | Tool failure     | 已有   | 工具卡 failed 态（红环 + 错误输出）                |
| 34  | Permission grant | 已有   | 审批卡 + ApprovalsView + Toasts                    |
| 35  | Computer use     | 不适用 | BrowserView 为内置预览，非模型驱动的计算机操作     |
| 36  | Code runner      | 已有   | TerminalPane                                       |

## Knowledge（9）

| #   | 元素               | 状态   | HerDock 落点                              |
| --- | ------------------ | ------ | ----------------------------------------- |
| 37  | Web search         | 不适用 | 后端无搜索事件                            |
| 38  | Sources            | 不适用 | 同上                                      |
| 39  | Inline citation    | 不适用 | 无引用元数据                              |
| 40  | Image generation   | 不适用 | 无图像生成事件                            |
| 41  | Retrieval chunks   | 不适用 | 无检索管线                                |
| 42  | Document reference | 已有   | `@` 文件引用（mention chips）             |
| 43  | Memory chips       | 已有   | 上下文附件 chips（`ref-chip attachment`） |
| 44  | Research report    | 不适用 | 无对应事件                                |
| 45  | Map answer         | 不适用 | 无对应事件                                |

## Structured output（13）

| #   | 元素              | 状态   | HerDock 落点                                           |
| --- | ----------------- | ------ | ------------------------------------------------------ |
| 46  | Data table        | 已有   | TableChip（表头吸附、数值右对齐、行上限）              |
| 47  | Number ticker     | 新增   | UsageView 指标卡数值入场动画（`stat-pop`，值变化重放） |
| 48  | Chart             | 已有   | UsageView 每日 token 堆叠柱状图                        |
| 49  | Web preview       | 已有   | BrowserView                                            |
| 50  | Diagram           | 不适用 | 无对应事件                                             |
| 51  | Flow graph        | 不适用 | 无对应事件                                             |
| 52  | Activity graph    | 不适用 | 无对应事件                                             |
| 53  | Math block        | 不适用 | 无对应事件                                             |
| 54  | Spec sheet        | 不适用 | 生成型示例，无固定数据契约                             |
| 55  | Comparison card   | 不适用 | 同上                                                   |
| 56  | Timeline          | 不适用 | 同上                                                   |
| 57  | Long job progress | 已有   | plan trace + ThinkingIndicator 计时                    |
| 58  | Score breakdown   | 不适用 | 无评分数据                                             |

## Agents（12）

| #   | 元素                  | 状态   | HerDock 落点                            |
| --- | --------------------- | ------ | --------------------------------------- |
| 59  | Agent plan            | 已有   | PlanTrace（步骤状态 + 耗时 + 自动折叠） |
| 60  | Subagent list         | 不适用 | 无子代理                                |
| 61  | Agent status pill     | 已有   | 运行状态点（`run-dot`）+ 状态标签       |
| 62  | Approval card         | 已有   | `bui-approval` + ApprovalsView          |
| 63  | Recommendation card   | 不适用 | 无对应事件                              |
| 64  | Artifact card         | 已有   | ArtifactsView + 设计画布                |
| 65  | Todo list             | 已有   | plan steps 即 todo 呈现                 |
| 66  | Agent card            | 不适用 | 对话对象是模型名，非人格卡片            |
| 67  | Handoff               | 不适用 | 无交接流                                |
| 68  | Background runs inbox | 已有   | ActivityView 运行收件箱（列表/看板）    |
| 69  | Checkpoints           | 已有   | CheckpointsChip + 回滚预览对话框        |
| 70  | Schedule              | 已有   | schedules 开关（ActivityView）          |

## Observability（3）

| #   | 元素            | 状态   | HerDock 落点                                 |
| --- | --------------- | ------ | -------------------------------------------- |
| 71  | Trace waterfall | 不适用 | 无调用链追踪数据                             |
| 72  | Cost meter      | 部分   | UsageView 有 token 用量；无单价/成本换算数据 |
| 73  | Quota banner    | 不适用 | 无配额上限数据                               |

## Composer（12）

| #   | 元素                | 状态   | HerDock 落点                                                     |
| --- | ------------------- | ------ | ---------------------------------------------------------------- |
| 74  | Composer            | 替换   | 按 ComposerBar/Toolbar/Actions 解剖重做（22px 单表面、无分割线） |
| 75  | Slash commands      | 新增   | 输入 `/` 唤起：追问提示 + 视图/会话/设置命令                     |
| 76  | Mentions            | 已有   | `@` 文件引用（弹出列表 + 键盘导航）                              |
| 77  | Attachments         | 已有   | `+` 菜单上传 + 上下文 chips                                      |
| 78  | Model picker (rail) | 替换   | composer 内模型药丸（状态点 + 模型名）                           |
| 79  | Voice waveform      | 不适用 | 无语音管线                                                       |
| 80  | Context token ring  | 不适用 | 仅有 run 级 tokenUsage，无实时上下文占用                         |
| 81  | Draft restore       | 新增   | 草稿按会话持久化（localStorage），重载/切会话可恢复              |
| 82  | Full model picker   | 替换   | `cm-model` 菜单：模型名 + via 连接 + 会话类型 + 审批策略         |
| 83  | Context breakdown   | 不适用 | 同 80                                                            |
| 84  | Prompt library      | 新增   | `+` 菜单「最近提示词」（本地历史，一键复用）                     |
| 85  | Command palette     | 已有   | CommandPalette（Ctrl K）                                         |

## Voice（2）

| #   | 元素               | 状态   | HerDock 落点        |
| --- | ------------------ | ------ | ------------------- |
| 86  | Voice conversation | 不适用 | 无语音输入/输出管线 |
| 87  | Read aloud         | 不适用 | 同上                |

## Thread（13）

| #   | 元素                   | 状态   | HerDock 落点                           |
| --- | ---------------------- | ------ | -------------------------------------- |
| 88  | Chat panel             | 已有   | SimpleChat                             |
| 89  | Empty state            | 已有   | `g-welcome` 品牌欢迎面                 |
| 90  | Thread list            | 已有   | Sidebar 会话列表（按工作区分组）       |
| 91  | Scroll anchor          | 已有   | ThreadViewport + 未读跳底药丸          |
| 92  | Canvas split           | 已有   | DesignView 画布 + 会话/检查器分栏      |
| 93  | Connection state       | 新增   | `conn-banner`：本地核心断连横幅        |
| 94  | Shared conversation    | 不适用 | 无分享/导出链接管线                    |
| 95  | In-conversation search | 已有   | ChatFindBar（Ctrl F）+ 命中高亮        |
| 96  | Thread search          | 已有   | 历史/Activity 视图的搜索对话、搜索 Run |
| 97  | Launcher bubble        | 不适用 | 桌面应用无浮动球入口                   |
| 98  | Settings               | 已有   | SettingsModal（连接管理模型优先）      |
| 99  | Onboarding             | 不适用 | 空态已有引导文案；无多步向导需求       |
| 100 | Mobile composer        | 不适用 | 桌面端布局                             |

## Generative（22）

| #   | 元素              | 状态   | 说明                                           |
| --- | ----------------- | ------ | ---------------------------------------------- |
| 101 | Stay card         | 不适用 | 生成型演示件：模型产出对应结构化数据时才有意义 |
| 102 | Reservation form  | 不适用 | 同上                                           |
| 103 | Order status      | 不适用 | 同上                                           |
| 104 | Flight tracker    | 不适用 | 同上                                           |
| 105 | Portfolio         | 不适用 | 同上                                           |
| 106 | Create event      | 不适用 | 同上                                           |
| 107 | View event        | 不适用 | 同上                                           |
| 108 | Weather           | 不适用 | 同上                                           |
| 109 | Ride status       | 不适用 | 同上                                           |
| 110 | Draft email       | 不适用 | 同上                                           |
| 111 | Cart              | 不适用 | 同上                                           |
| 112 | Playlist          | 不适用 | 同上                                           |
| 113 | Channel message   | 不适用 | 同上                                           |
| 114 | Receipt           | 不适用 | 同上                                           |
| 115 | Area chart        | 不适用 | 同上（UsageView 已有应用内柱状图）             |
| 116 | Line chart        | 不适用 | 同上                                           |
| 117 | Bar charts        | 不适用 | 同上                                           |
| 118 | Player card       | 不适用 | 同上                                           |
| 119 | Session card      | 不适用 | 同上                                           |
| 120 | Confirm dialog    | 已有   | 检查点恢复等处使用系统确认对话框               |
| 121 | Create task       | 不适用 | 无任务实体                                     |
| 122 | Software purchase | 不适用 | 无购买流                                       |

## 汇总

- 新增 11：Loading state、Typing indicator、Message actions（升级）、Follow-up
  suggestions（迁移）、Edit a sent message、Stopped run、Timing footer、Number ticker、
  Slash commands、Draft restore、Prompt library、Connection state（12 项落地，含替换）
- 替换/对齐 5：Composer、Model picker、Full model picker、Message actions、Follow-ups
- 已有等效 40+：消息对、流式文本、思考面板、错误态、工具/终端/表格卡、审批、
  检查点、产物、滚动锚点、页内搜索、命令面板、设置、空态、会话列表等
- 不适用 60+：主要集中在 Knowledge / Generative / Voice / 观测类 —— 均为
  “数据源不存在”或“平台不符”，而非样式缺口；一旦后端产出对应事件，可按
  Elements 的同款解剖直接在 `chat.css` 体系内补齐。

## 第二轮：设计页（DesignView）补充应用

针对设计表面（画布 / 会话栏 / 检查器）再过一遍 122 个元素后落地的项：

| 元素                  | 设计页落点                                                                   |
| --------------------- | ---------------------------------------------------------------------------- |
| Loading state         | 首次生成且画布为空时，舞台中央显示 `GenerationLoader`（正在生成设计 + 计时） |
| Thinking indicator    | 编辑卡无计划步骤时显示 shimmer 计时行（正在编辑 / 等待审批）                 |
| Timing footer         | 运行完成后会话栏显示时长 + in/out tokens（`lib/runMetrics` 与聊天页共享）    |
| Stopped run           | 取消后的静默通知条，提示可在下方继续描述接着迭代                             |
| Follow-up suggestions | 有方案且输入为空时，composer 上方显示 4 条设计迭代建议 chips                 |
| Draft restore         | 设计 brief 按工作区持久化（localStorage），重载不丢                          |
| Speaker identity      | 设计回复气泡头部显示模型名 + 状态点（与聊天页一致）                          |
| Message actions       | 设计回复悬停显示复制按钮（✓ 原位确认）                                       |

设计页其余元素核对结论：Canvas split / Web preview / Artifact card / Approval
card / Checkpoints / Spec sheet（检查器）/ Comparison card（并排方案）/ Empty
state 均已有等效实现；Knowledge、Voice、Generative 类在设计页同样无数据落点。

## 第三轮：设计页按 122 个元素逐项落地（2026-08-17）

对照 <https://www.assistant-ui.com/elements> 左侧目录从头到尾读完源码后，把
**设计页有数据源的表面**全部换成对应元素的解剖。实现放在 `designElements.tsx`，
由 `DesignView` 组装；仍是自写 CSS，不引入 Tailwind / assistant-ui runtime。

### 本轮新替换 / 加深

| #                      | 元素                                                 | 设计页落点                                     |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| 1                      | Loading state                                        | 空画布首次生成：`GenerationLoader`             |
| 2                      | Thinking indicator                                   | 无计划步骤时的 shimmer 行                      |
| 3                      | Reasoning panel / 59 Agent plan / 65 Todo list       | 可折叠计划 + 进度条 + 步骤勾选                 |
| 4                      | Streaming text                                       | 助手气泡在 `assistant_delta` 时新词着色 + 光标 |
| 5                      | Typing indicator                                     | 等待首字：三点 bubble                          |
| 8                      | Message pair                                         | 用户右对齐气泡 + 助手通栏                      |
| 10                     | Message actions                                      | 复制 + 重试                                    |
| 11                     | Follow-up suggestions                                | composer 上方迭代 chips                        |
| 12                     | Error state                                          | 失败横幅 + 重试                                |
| 13                     | Message queue                                        | `queued` 排队说明                              |
| 15                     | Edit a sent message                                  | 用户气泡铅笔，填回 composer                    |
| 18                     | Stopped run                                          | 停止条 +「继续」                               |
| 19                     | Timing footer                                        | 时长 / tokens                                  |
| 20                     | Timestamps                                           | 气泡时间戳 + 日分隔                            |
| 21                     | Speaker identity                                     | 模型名 + 状态点                                |
| 22                     | Regenerate                                           | 助手气泡重试（当前模型）                       |
| 24 / 25 / 33           | Tool call / timeline / failure                       | 会话栏工具行                                   |
| 27                     | Code diff                                            | 文件改动 +/- 列表，点开源文件                  |
| 29                     | File tree                                            | 检查器 FILES 路径树                            |
| 34 / 62                | Permission grant / Approval card                     | 拒绝 / 永久允许 / 批准一次 + 命令区            |
| 42 / 43 / 77           | Document reference / Memory chips / Attachments      | composer chips + 导入素材                      |
| 47                     | Number ticker                                        | 检查器数值入场                                 |
| 49                     | Web preview                                          | 预览条 origin + 刷新 + 放大                    |
| 54                     | Spec sheet                                           | 检查器标题/副标题 + 行表                       |
| 55                     | Comparison                                           | 2–3 个方案并排 pick                            |
| 57                     | Long job progress                                    | 排队/生成/写入/预览 + 取消                     |
| 61                     | Agent status                                         | 会话头状态药丸                                 |
| 63                     | Recommendation card                                  | 「采用这一版继续迭代？」                       |
| 64                     | Artifact card                                        | 项目封面下的产物卡；素材库列表                 |
| 69                     | Checkpoints                                          | 版本页检查点卡                                 |
| 72                     | Cost meter                                           | 检查器 in/out token 条                         |
| 74 / 75 / 76 / 81 / 84 | Composer / slash / mentions / draft / prompt library | `/` 命令、`@` 设计系统、草稿恢复、最近提示词   |
| 88 / 91 / 92           | Chat panel / Scroll anchor / Canvas split            | 会话栏跳底药丸 + 既有分栏                      |
| 89 / 99                | Empty state / Onboarding                             | 画布/会话问候 + 三条起步建议                   |
| 93                     | Connection state                                     | 设计页顶部断连横幅                             |
| 98                     | Settings                                             | 检查器调整页（开关/密度/主色）                 |
| 105                    | Portfolio                                            | 项目网格封面 + 产物卡                          |
| 118                    | Confirm dialog                                       | 未保存时打开源文件的确认层                     |

### 设计页仍不适用（无数据源或平台不符）

6 Reasoning effort、7 Guardrail、9 Message branches、16 Quote reply、17 Feedback、
23 Confidence、26 Terminal block、28 Reviewable diff、31 MCP panel、32 Parallel tools、
35 Computer use、36 Code runner、37–41 / 44–45 Knowledge、46 Data table、48 Chart、
50–53 Diagram/Flow/Activity/Math、56 Timeline（生成型示例）、58 Score、60 Subagent、
66 Agent card、67 Handoff、68 Background inbox（活动页已有）、70 Schedule、
71 Trace waterfall、73 Quota、78–80 / 82–83 模型选择与上下文环（设计会话沿用当前模型）、
79 / 86–87 Voice、90 Thread list、94 Shared conversation、95–97 会话内搜索 / 启动球、
100 Mobile composer、101–104 / 106–117 / 119–122 其余 Generative 演示件。

这些不是样式缺口：一旦后端产出对应事件，可按同一套 `design-*` 解剖补上。

## 第四轮：整窗页（历史 → 活动 → 审批 → 用量 → 技能 → MCP → 产物）

设计页完成后，按侧栏顺序把 7 个 `CONSOLE_VIEWS` 整窗页换成同一套解剖。可复用件从
`designElements.tsx` 抽到 [`src/components/pageElements.tsx`](src/components/pageElements.tsx)
（`PageEmpty` / `ErrorBanner` / `StatusPill` / `ArtifactCard` / `SpecSheet` /
`CostMeter` / `ToolRows` / `ApprovalCard` / `JobBar` / `ConsoleShell`），设计页改为
thin wrapper，避免控制台去 import `Design*`。样式写在 `grok-pages.css` 的 `aui-*`。
断连时各页顶部复用 `conn-banner`。不为 Knowledge / Voice / 机票购物车等无数据元素造假数据。

| 页   | 元素                                                                         | 落点                                                                                                                      |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 历史 | thread-list / thread-search / empty-state / day-separator / timestamps       | 13px 行标题、等宽时间戳、状态点、当前会话 `on`；今天/昨天/更早为 day-separator；空态「新建会话」；搜索无命中单独 empty    |
| 活动 | background-inbox / agent-status / job-progress / error-state / message-queue | inbox 卡 + 状态药丸；有 `planProgress`（如 `2/5`）才画细进度条；失败 ErrorBanner 重试；看板列头计数；筛选空态「查看全部」 |
| 审批 | approval-card / permission-grant / empty-state / spec-sheet                  | 图标 + 标题 + mono 命令区；拒绝 / 本次运行内允许 / 永久允许 / 批准一次；规则为 spec 行（范围、写入日、撤销）              |
| 用量 | number-ticker / chart / cost-meter / data-table / empty-state                | KPI `stat-pop`；无数据不画空柱；in/out 份额条（无美元）；最贵 Run 表头吸附、数值右对齐                                    |
| 技能 | document-reference / memory-chips / empty-state / tool-call                  | reference 卡 + 范围芯片 + 开关；选中即 chip 高亮；Browser Use 只读 tool rows（无需审批 / 网络 / 高风险色点）              |
| MCP  | mcp-server-panel / agent-status / empty-state / tool-call                    | 空态「添加」进设置；状态药丸 + 启停 + 探测；探测中 typing/shimmer，失败 error-state；`selectedMcpIds` 勾选保留            |
| 产物 | artifact-card / empty-state / thread-search                                  | 生成中 pulse / 完成 meta；空态区分「还没有产物」与「没有匹配的文件」；`out/design` html/deck-html 走 `openDesignArtifact` |

会话/Composer、设计画布、设置弹窗、Diff、终端本轮不改。

## 第五轮：设置弹窗 → Diff → 终端 → 命令面板（2026-08-17）

第四轮明确留下的五个表面里，会话/Composer 与设计画布在第一至三轮已按元素重做，
本轮收尾剩下的三个，外加同属"应用外壳"的命令面板。再次从
<https://www.assistant-ui.com/elements> 左栏 122 个 slug 逐个读源码后落地，新增的
可复用件仍放在 `pageElements.tsx`（`ConfirmCard` / `Switch` / `ToggleRow` /
`SegmentedField` / `ModelPickerList` / `FileTreeCard` + `buildFileTree`），样式写在
`grok-pages.css` 的 `aui-*`。

| 表面     | 元素                                                              | 落点                                                                                                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 设置弹窗 | 98 Settings / 82 Model picker / 120 Confirm / 54 Spec sheet       | mono 微标 + 分段轨道（外观 / 审批策略 / 更新通道）；真开关（`role="switch"`）替掉裸 checkbox；默认连接换成按"已连接/未连接"分组的完整模型选择器，能力芯片来自 `capabilities`，右列是模型名（无单价数据就不画）；安全规则改成 spec 行（范围 / 效果 / 写入日） |
| 设置弹窗 | 12 Error state / 61 Agent status / 24 Tool call / 89 Empty state  | Provider 不可用时静默红条 + 重试（原来是一行灰字）；`st` 徽章统一成 StatusPill；MCP 工具列表换成 tool rows；无持久化规则时走 empty-state                                                                                                                     |
| 设置弹窗 | 120 Confirm dialog                                                | 删除 MCP 连接、退出 Grok 登录不再弹 `window.confirm`，改为应用内确认卡（danger 变体，Esc 只关确认层不关设置）                                                                                                                                                |
| Diff     | 27 Code diff / 28 Reviewable diff / 29 File tree / 89 Empty state | 顶部 file-tree 卡（N 个文件改动 + 每文件 churn，点文件名跳编辑器）；每个文件成卡片，行内「稍后 / 已复核」决定，稍后的整卡降透明度；底部复核条读出"还有 N 个文件待复核"；无改动时 empty-state                                                                 |
| 终端     | 26 Terminal block / 89 Empty state                                | 会话头显示命令（Shell）+ 退出态：运行中是脉冲点，结束是 `exit N` + 「重新启动」；`terminal_exit` 的 `exitCode` 接上了（原来只往终端里写一行"[进程已结束]"）；无工作区时 empty-state                                                                          |
| 终端     | 26 Terminal block 的 paper/ink 变体                               | xterm 主题跟随 `resolvedTheme`，切主题就地重绘不掉 PTY；顺带修掉 `.terminal-panels` 写死的 `#fbfaf8`                                                                                                                                                         |
| 命令面板 | 85 Command palette                                                | combobox / listbox / option 语义 + `aria-activedescendant`；动作组的快捷键拆成一枚一 `kbd`，跳转组保留纯文本 meta；无命中时引用查询词                                                                                                                        |

顺带补的底层：`--ok-row` / `--ok-ink` / `--danger-ink` 之前只有浅色定义，深色下
diff 增行是一条刺眼的亮绿带；这一轮补齐了深浅两套 token。

### 本轮核对为不适用

25 Tool timeline（Diff 面按文件而非按调用组织）、31 MCP server panel 的连接向导
（设置页已是完整管理面，不再叠一层）、36 Code runner（终端是交互式 PTY，没有
"片段 + 运行按钮"这种一次性执行单元）、46 Data table / 48 Chart（这几个表面无表格
与序列数据）、79 / 86–87 Voice、101–122 Generative 演示件（除 120 Confirm 已用）。
28 Reviewable diff 只落地到"逐文件复核"这一层：后端没有逐 hunk 丢弃的补丁 API，
也没有 `git checkout -- <path>`，所以不做假的「丢弃」按钮，复核状态只作读数、
不拦截「采纳并继续」。

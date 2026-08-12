# Design QA

## Baseline

- Source: `行知 Agent 工作台.dc.html`
- Viewport: 1520 x 980
- Reference: [design-reference-1520x980.png](./images/design-reference-1520x980.png)
- Implementation: [implementation-1520x980.png](./images/implementation-1520x980.png)
- Side-by-side: [comparison-1520x980.png](./images/comparison-1520x980.png)
- Settings: [settings-1520x980.png](./images/settings-1520x980.png)
- Minimum window: [implementation-1100x700.png](./images/implementation-1100x700.png)
- Minimum-window settings: [settings-1100x700.png](./images/settings-1100x700.png)

## Visual comparison

- Left rail, center workbench and right inspector retain the reference proportions (230 px / fluid / 322 px).
- Tabs, run status, conversation width, PLAN/TERMINAL/EDITS/CHECKPOINTS cards, composer and status bar follow the source spacing and hierarchy.
- Font sizes, borders, surface contrast, status colors and overflow were checked at 1520 x 980 and the packaged 1100 x 700 minimum.
- Cards use an 8 px maximum radius; quick actions and icon controls use Phosphor icons.
- The 1100 px desktop minimum uses a 280 px inspector and wrapping Composer controls; body width remained exactly 1100 px with no horizontal overflow. Below 980 px the inspector is hidden for development preview only. Packaged windows enforce the 1100 x 700 minimum.
- QA found and fixed a `.right` class collision that caused Run card metadata to inherit the inspector's 322 px width. The inspector now uses the scoped `.right-panel` class.

## Intentional scope differences

- Removed the Web/macOS/Windows mode selector and browser address bar.
- Replaced `行知` with the dual product name `HerDock · 行知` while retaining the visual mark.
- Removed Share, account, credits, organization policy, Cloud and hosted connector controls.
- Replaced connectors with local MCP stdio management and local-core status.

## Interaction checks

- Workspace tree opens a Monaco file tab and renders editable source.
- Diff and Activity tabs render persisted Run data.
- Command palette filters sessions and files.
- Provider/MCP settings modal opens and exposes editable local configuration.
- Grok Build Provider exposes the official CLI login state, OAuth/device-code actions, verification-code input, cancel, refresh and logout without introducing a HerDock account surface; the signed-in desktop state was checked for clipping and overflow.
- MCP, security-rule and updater settings tabs switch to real state; updater actions are disabled with “此构建未启用更新” when build-time signing configuration is absent.
- `Ctrl+Backtick` opens the multi-terminal view.
- Browser console contained no runtime errors during the checks.

Final result: Windows design preview passed. macOS visual and packaged-window validation remains a CI requirement and was not run on this Windows host.

## 编辑器手稿（行知Agent编辑器.dc.html）

第二轮设计交付把侧栏从「三个入口 + 菜单」扩展成完整的目的地列表，并为其中五个入口补上了整窗页面。

### 结构变化

- 侧栏顶部：新建会话、设计、活动、审批中心、搜索、打开文件夹；底部：技能、本地 MCP、用量与成本、产物库、设置。
- 侧栏底部的账号卡换成本地核心状态条（连接状态 · Provider 数量 · 版本号）。HerDock 没有账号，卡片形态会误导。
- 活动、审批中心、用量与成本、技能、本地 MCP、产物库是「整窗目的地」：进入时不显示工作标签页与右侧栏，离开时会话标签保持原样。
- 工作标签固定为「Agent 会话 + 差异」，活动不再占一个标签；新建标签页把「活动」换成「差异」。
- 右侧栏收敛为工作区 / 审批 / 上下文 / 用量四个页签，技能与本地 MCP 交给整窗页面。
- 活动支持列表与看板两种布局，看板按排队 / 执行中 / 待审批 / 已完成 / 失败中断分列。

### 数据来源

- 用量与成本读取新增的 `usage_series` 命令：`usage_daily` 的逐日逐 Provider 明细、上一周期对比值，以及按 token 排序的 Run。全部来自本机 `herdock-v1.db`。
- 审批中心的等待时长来自新增的 `Approval.createdAt`。

### 与手稿的差异

- 手稿用美元展示成本。HerDock 不保存价目表，也不向 Provider 查询账单，因此该页按 token 与调用次数计量，不折算金额。
- 手稿的「批准范围」有四项。本地内核实际支持三种语义：仅本次、本次运行内允许（新增 `allow_run`，只存在内存里，运行结束或应用重启即失效）、永久允许该范围。第四项「允许但每次先建快照」被省略：执行命令与写工作区前本来就会写检查点。
- 手稿中的示例数据（门店销售场景）只作为版式参考，界面一律渲染真实的本地数据。

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

- 手稿用美元展示成本。HerDock 不保存价目表，也不向 Provider 查询账单，因此该页按 token 与调用次数计量，不折算金额；手稿的「月度预算」卡片相应换成「上下文窗口」。
- 手稿的「批准范围」有四项。本地内核实际支持三种语义：仅本次、本次运行内允许（新增 `allow_run`，只存在内存里，运行结束或应用重启即失效）、永久允许该范围。第四项「允许但每次先建快照」被省略：执行命令与写工作区前本来就会写检查点。
- 手稿审批详情的第三个按钮是「修改后执行」，内核没有这个能力，实现为「查看运行」。
- 手稿的权限规则行显示工作区 / 全局归属。规则统一存在本机数据库里，因此该位置显示写入日期。
- 手稿中的示例数据（门店销售场景）只作为版式参考，界面一律渲染真实的本地数据。

### 第三轮逐页核对

在 1520 x 950 下逐页对照手稿，补齐了以下差距：

- 设计页：整块重写为画布路由（会话面板 / 画布 / 检查面板），并补上项目、设计系统、素材库三个路由。
- 侧栏：移除「设计」上多出的产物计数，回到手稿的干净状态；其余导航项的快捷键提示与徽标已一致。
- 用量与成本：四张 KPI 卡都补上手稿的副行（记录天数、Provider、上下文占比），并把「最贵的 Run」的「导出 CSV」接成真实动作——写入 `out/usage/top-runs-<区间>-<时间>.csv` 后在文件管理器中定位，带 BOM 以便 Excel 正确读中文。
- 审批中心：「批准并继续」补上手稿的快捷键提示，并把 `Ctrl/⌘ + Enter` 在审批页接成批准当前请求（其它页面仍是发送消息）。
- 输入区：审批策略从「运行设置」弹层里独立成一枚 pill，旁边跟着当前策略的说明；Provider pill 补上可用状态圆点。
- 设置弹窗：尺寸从 920 x 720 收到手稿的 900 x 600，左侧导航去掉底色、改用细分割线。
- 活动（列表与看板）、技能、本地 MCP、产物库、命令面板、右侧栏与手稿一致，无需改动。

### 字体自托管

之前 `index.html` 跟手稿一样从 Google Fonts 取字体，但打包后的 CSP 是 `style-src 'self' 'unsafe-inline'` 与 `font-src 'self' data:`——样式表和 woff2 都会被拦掉，界面于是退回微软雅黑 / Consolas，字号对了字形却不对。浏览器里做设计预览时有网络，所以这个问题在截图里看不出来。

- 三套字体改为随包分发（`@fontsource/schibsted-grotesk`、`noto-sans-sc`、`jetbrains-mono`），字重与手稿的字体请求一致：Schibsted Grotesk 400/500/600/700、Noto Sans SC 400/500/700、JetBrains Mono 400/500/600。
- `vite.config.ts` 里的 `herdock:woff2-only` 插件去掉 @fontsource 附带的 `.woff` 回退——WebView2 与 WKWebView 都支持 woff2，保留回退会让字体体积翻倍（16.3 MB → 7.2 MB）。
- 运行时只有同源字体请求，离线启动与断网都不再影响字形。生成的设计产物本来就被 prompt 禁止引用远程字体，现在应用自身也遵守同一条规则。

### 字号与字重核对

逐元素量了一遍计算样式，与手稿的取值比对：

- 字号沿用手稿的半像素梯度（9.5 / 10.5 / 11.5 / 12.5 / 13.5 …），正文 13.5px/1.85、mono 说明 9.5px、`.06em`/`.12em`/`.14em` 的字距都与手稿一致。
- 字重里的 620 / 650 归到手稿只用的 400/500/600/700。字体文件是离散字重，620 按 CSS 匹配规则会向上取到 700，比手稿的 600 更重。
- 侧栏「工作区」分组标题此前没有样式，按浏览器默认的 16px 渲染；补成手稿的 9.5px mono、字距 `.14em`。
- 设置里 Provider 的「启用」标签同样是 16px 默认值，改成 10.5px 说明字号，并按手稿把复选框换成开关轨道（34 x 19，15px 圆钮）。
- 顺带把新建会话的列表写入去重，与设计运行那条路径一致，控制台不再报重复 key。

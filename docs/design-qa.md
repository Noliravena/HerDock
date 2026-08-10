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

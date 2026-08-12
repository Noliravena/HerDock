import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../store/workbench";

const SKILL_STATUS: Record<string, string> = {
  enabled: "已启用",
  readonly: "只读",
  limited: "受限",
  disabled: "已停用",
};

/** The fixed Browser Use surface: a closed tool list, not arbitrary scripting. */
const BROWSER_TOOLS: { name: string; tag: string; tone: "ok" | "warn" | "bad" }[] = [
  { name: "browser_tabs", tag: "无需审批", tone: "ok" },
  { name: "browser_snapshot", tag: "无需审批", tone: "ok" },
  { name: "browser_navigate", tag: "网络审批", tone: "warn" },
  { name: "browser_search", tag: "网络审批", tone: "warn" },
  { name: "browser_click", tag: "高风险", tone: "bad" },
  { name: "browser_type", tag: "高风险", tone: "bad" },
];

export function SkillsView() {
  const { openPath, selectedSkillIds, skills, toggleSkill } = useWorkbench(
    useShallow((state) => ({
      openPath: state.openPath,
      selectedSkillIds: state.selectedSkillIds,
      skills: state.skills,
      toggleSkill: state.toggleSkill,
    })),
  );

  return (
    <div className="console-view">
      <header className="console-head stacked">
        <span className="console-eyebrow">SKILL.MD · TOOLS</span>
        <h1>技能</h1>
        <span className="console-meta">项目与全局 SKILL.md 在每次 Run 开始时注入上下文</span>
      </header>

      <div className="console-scroll">
        <div className="skill-grid">
          {skills.map((skill) => (
            <div
              className={`skill-tile ${selectedSkillIds.includes(skill.id) ? "selected" : ""}`}
              key={skill.id}
            >
              <button
                type="button"
                className="skill-tile-main"
                onClick={() => toggleSkill(skill.id)}
                title={selectedSkillIds.includes(skill.id) ? "从本次运行中移除" : "加入本次运行"}
              >
                <span className="skill-tile-head">
                  <span className="skill-glyph">{skill.glyph}</span>
                  <span className="skill-name">{skill.name}</span>
                  <span className={`st ${skill.status}`}>
                    {SKILL_STATUS[skill.status] || skill.status}
                  </span>
                </span>
                <span className="skill-desc">{skill.detail}</span>
              </button>
              <div className="skill-tile-foot">
                <span className="mono path">{skill.path}</span>
                <span className="scope">{skill.scope === "global" ? "全局" : "工作区"}</span>
                {skill.scope !== "global" && (
                  <button type="button" className="link" onClick={() => void openPath(skill.path)}>
                    打开
                  </button>
                )}
              </div>
            </div>
          ))}
          {!skills.length && (
            <div className="empty-hint">
              在工作区的 SKILL.md 或 HerDock 全局目录中添加技能后会出现在这里。
            </div>
          )}
        </div>

        <section className="panel-block flush">
          <div className="panel-block-head padded">
            <strong>Browser Use · 固定工具</strong>
            <span className="sub">不向 Provider 提供任意 JavaScript 执行能力</span>
          </div>
          {BROWSER_TOOLS.map((tool) => (
            <div className="tool-row" key={tool.name}>
              <span className="mono name">{tool.name}</span>
              <span className={`tool-tag ${tool.tone}`}>{tool.tag}</span>
            </div>
          ))}
          <p className="console-foot padded">
            页面内容按数据处理，不会当成指令；点击与输入这类副作用操作先进入统一审批。
          </p>
        </section>
      </div>
    </div>
  );
}

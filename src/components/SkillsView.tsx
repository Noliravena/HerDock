import { ArrowClockwise } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "../store/workbench";
import { ConsoleShell, PageEmpty, ToolRows } from "./pageElements";

const SKILL_STATUS: Record<string, string> = {
  enabled: "已启用",
  readonly: "只读",
  limited: "受限",
  disabled: "已停用",
};

/** The fixed Browser Use surface: a closed tool list, not arbitrary scripting. */
const BROWSER_TOOLS: { id: string; name: string; hint: string; tone: "ok" | "warn" | "bad" }[] = [
  { id: "browser_tabs", name: "browser_tabs", hint: "无需审批", tone: "ok" },
  { id: "browser_snapshot", name: "browser_snapshot", hint: "无需审批", tone: "ok" },
  { id: "browser_navigate", name: "browser_navigate", hint: "网络审批", tone: "warn" },
  { id: "browser_search", name: "browser_search", hint: "网络审批", tone: "warn" },
  { id: "browser_click", name: "browser_click", hint: "高风险", tone: "bad" },
  { id: "browser_type", name: "browser_type", hint: "高风险", tone: "bad" },
];

export function SkillsView() {
  return <GrokSkills />;
}

function GrokSkills() {
  const { hostOnline, openPath, refreshSkills, selectedSkillIds, skills, toggleSkill } =
    useWorkbench(
      useShallow((state) => ({
        hostOnline: state.hostOnline,
        openPath: state.openPath,
        refreshSkills: state.refreshSkills,
        selectedSkillIds: state.selectedSkillIds,
        skills: state.skills,
        toggleSkill: state.toggleSkill,
      })),
    );

  return (
    <ConsoleShell
      title="技能"
      hostOnline={hostOnline}
      actions={
        <button type="button" className="g-head-btn" onClick={() => void refreshSkills()}>
          <ArrowClockwise size={14} />
          刷新
        </button>
      }
    >
      {!skills.length && (
        <PageEmpty
          title="还没有技能"
          body="把 SKILL.md 放到工作区后点刷新，技能会出现在这里，并可加入本次运行。"
        />
      )}
      {skills.map((skill) => {
        const on = selectedSkillIds.includes(skill.id);
        return (
          <article
            className={`aui-ref ${on ? "on" : ""}`}
            key={skill.id}
            data-slot="document-reference"
          >
            <span className="aui-ref-copy">
              <strong>{skill.name}</strong>
              <small className="mono">{skill.path || skill.detail}</small>
              <span className="aui-chips">
                <span className="aui-chip">{skill.scope === "global" ? "全局" : "工作区"}</span>
                <span className="aui-chip">{SKILL_STATUS[skill.status] || skill.status}</span>
              </span>
            </span>
            {skill.scope !== "global" && (
              <button
                type="button"
                className="g-text-btn"
                onClick={() => void openPath(skill.path)}
              >
                打开
              </button>
            )}
            <button
              type="button"
              className={`g-switch ${on ? "on" : ""}`}
              role="switch"
              aria-checked={on}
              title={on ? "从本次运行中移除" : "加入本次运行"}
              onClick={() => toggleSkill(skill.id)}
            >
              <i />
            </button>
          </article>
        );
      })}
      <details className="g-fold">
        <summary>Browser Use</summary>
        <p>固定工具，不向 Provider 提供任意 JavaScript。点击与输入先进入审批。</p>
        <ToolRows items={BROWSER_TOOLS} />
      </details>
    </ConsoleShell>
  );
}

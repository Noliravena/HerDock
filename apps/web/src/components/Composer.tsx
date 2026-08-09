import { useWorkbench, type SessionKind } from "../store/workbench";
import { IconClose, IconPlus, IconSend } from "./Icons";

const QUICK: Record<SessionKind, { label: string; glyph: string; text: string }[]> = {
  coding: [
    { label: "解释这段改动", glyph: "?", text: "解释当前工作区未提交改动的意图与风险" },
    { label: "为它补测试", glyph: "✓", text: "为最近修改补单元测试并运行" },
    { label: "跑一遍回归", glyph: "▶", text: "运行项目测试并修复失败项" },
    { label: "写成周报", glyph: "≡", text: "把本次改动写成一段周报" },
  ],
  analysis: [
    { label: "异常排查", glyph: "?", text: "读取 data/ 与 rules/，找出异常并输出到 out/" },
    { label: "交叉核对", glyph: "✓", text: "与促销/日历数据交叉核对异常原因" },
    { label: "跑一遍脚本", glyph: "▶", text: "运行分析脚本并汇总结果" },
    { label: "写成周报", glyph: "≡", text: "根据 out/ 与本次 run 结果写成周报 Markdown" },
  ],
  mixed: [
    { label: "解释这段改动", glyph: "?", text: "解释当前改动" },
    { label: "异常分析", glyph: "✓", text: "分析 data/ 异常并写脚本到 agents/" },
    { label: "跑一遍回归", glyph: "▶", text: "运行项目测试并修复失败项" },
    { label: "写成周报", glyph: "≡", text: "把本次结果写成周报" },
  ],
};

const AUTO_LABEL: Record<string, string> = {
  ask_always: "始终询问",
  ask_risky: "风险询问",
  auto_workspace: "工作区自动",
  auto_all: "尽量自动",
};

export function Composer() {
  const s = useWorkbench();
  const canSend = Boolean(s.draft.trim() || s.mentions.length);

  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="quick-row">
          {QUICK[s.kind].map((q) => (
            <button key={q.label} type="button" className="chip" onClick={() => s.setDraft(q.text)}>
              <span className="glyph">{q.glyph}</span>
              {q.label}
            </button>
          ))}
        </div>

        {s.mentions.length > 0 && (
          <div className="mention-row">
            {s.mentions.map((m, i) => (
              <button
                key={m}
                type="button"
                className={`mention ${i === 0 ? "" : "dim"}`}
                title="移除引用"
                onClick={() => s.removeMention(m)}
              >
                @ {m.split("/").pop()}
                <IconClose size={8} />
              </button>
            ))}
          </div>
        )}

        <textarea
          value={s.draft}
          onChange={(e) => s.setDraft(e.target.value)}
          placeholder="继续说点什么…"
          rows={2}
        />

        <div className="composer-actions">
          <button
            type="button"
            className="round-btn"
            title="引用当前打开的文件"
            onClick={() => s.openFile && s.addMention(s.openFile)}
          >
            <IconPlus size={14} />
          </button>
          <button
            type="button"
            className="pill-btn"
            onClick={() => s.openFile && s.addMention(s.openFile)}
          >
            引用文件
          </button>
          <select
            className="pill-select"
            value={s.autoExecute}
            onChange={(e) => s.setAutoExecute(e.target.value)}
            title="自动执行级别（受组织策略钳制）"
          >
            {Object.entries(AUTO_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="pill-select"
            value={s.kind}
            onChange={(e) => s.setKind(e.target.value as SessionKind)}
            title="会话类型"
          >
            <option value="mixed">混合</option>
            <option value="coding">Coding</option>
            <option value="analysis">分析</option>
          </select>
          <select
            className="pill-select"
            value={s.providerId}
            onChange={(e) => s.setProviderId(e.target.value)}
            title="本地 Provider"
          >
            {(s.providers.length
              ? s.providers.map((p) => ({
                  id: p.id,
                  label: p.available ? p.id : `${p.id} (missing)`,
                  disabled: !p.available,
                }))
              : ["codex", "claude", "grok"].map((id) => ({ id, label: id, disabled: false }))
            ).map((p) => (
              <option key={p.id} value={p.id} disabled={p.disabled}>
                {p.label}
              </option>
            ))}
          </select>
          <label className="pill-btn" title="Demo 模式不调用真实 CLI">
            <input
              type="checkbox"
              checked={s.demoMode}
              onChange={(e) => s.setDemoMode(e.target.checked)}
            />
            Demo
          </label>
          <button
            type="button"
            className="send-btn"
            disabled={!canSend}
            title={`发送 ${s.platform.submitHint}`}
            onClick={() => void s.sendPrompt()}
          >
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  );
}

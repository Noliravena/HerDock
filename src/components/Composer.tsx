import {
  CheckCircle,
  NotePencil,
  Paperclip,
  Play,
  PlugsConnected,
  PuzzlePiece,
  Question,
  type Icon,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench, type SessionKind } from "../store/workbench";
import { IconClose, IconSend } from "./Icons";

const QUICK: Record<SessionKind, { label: string; icon: Icon; text: string }[]> = {
  coding: [
    { label: "解释这段改动", icon: Question, text: "解释当前工作区未提交改动的意图与风险" },
    { label: "为它补测试", icon: CheckCircle, text: "为最近修改补单元测试并运行" },
    { label: "跑一遍回归", icon: Play, text: "运行项目测试并修复失败项" },
    { label: "写成周报", icon: NotePencil, text: "把本次改动写成一段周报" },
  ],
  analysis: [
    { label: "异常排查", icon: Question, text: "读取 data/ 与 rules/，找出异常并输出到 out/" },
    { label: "交叉核对", icon: CheckCircle, text: "与促销/日历数据交叉核对异常原因" },
    { label: "跑一遍脚本", icon: Play, text: "运行分析脚本并汇总结果" },
    { label: "写成周报", icon: NotePencil, text: "根据 out/ 与本次 run 结果写成周报 Markdown" },
  ],
  mixed: [
    { label: "解释这段改动", icon: Question, text: "解释当前改动" },
    { label: "异常分析", icon: CheckCircle, text: "分析 data/ 异常并写脚本到 agents/" },
    { label: "跑一遍回归", icon: Play, text: "运行项目测试并修复失败项" },
    { label: "写成周报", icon: NotePencil, text: "把本次结果写成周报" },
  ],
};

const AUTO_LABEL: Record<string, string> = {
  ask_always: "始终询问",
  ask_risky: "风险询问",
  auto_workspace: "工作区自动",
  auto_all: "尽量自动",
};

export function Composer() {
  const state = useWorkbench(
    useShallow((s) => ({
      addMention: s.addMention,
      autoExecute: s.autoExecute,
      contextItems: s.contextItems,
      draft: s.draft,
      importContextPaths: s.importContextPaths,
      kind: s.kind,
      mcpServers: s.mcpServers,
      mentions: s.mentions,
      model: s.model,
      openFile: s.openFile,
      platform: s.platform,
      providerId: s.providerId,
      providerProfiles: s.providerProfiles,
      providers: s.providers,
      removeMention: s.removeMention,
      selectedContextIds: s.selectedContextIds,
      selectedMcpIds: s.selectedMcpIds,
      selectedSkillIds: s.selectedSkillIds,
      sendPrompt: s.sendPrompt,
      setAutoExecute: s.setAutoExecute,
      setDraft: s.setDraft,
      setKind: s.setKind,
      setModel: s.setModel,
      setProviderId: s.setProviderId,
      skills: s.skills,
      toggleContextItem: s.toggleContextItem,
      toggleMcpSelection: s.toggleMcpSelection,
      toggleSkill: s.toggleSkill,
    })),
  );
  const canSend = Boolean(state.draft.trim() || state.mentions.length);
  const profile = state.providerProfiles.find((item) => item.id === state.providerId);
  const candidateModels = useMemo(
    () =>
      Array.from(
        new Set([
          ...(profile?.model ? [profile.model] : []),
          ...((profile?.config.candidateModels as string[] | undefined) || []),
        ]),
      ),
    [profile],
  );
  const selectedContextIds = useMemo(
    () => new Set(state.selectedContextIds),
    [state.selectedContextIds],
  );
  const selectedContextItems = useMemo(
    () => state.contextItems.filter((item) => selectedContextIds.has(item.id)),
    [selectedContextIds, state.contextItems],
  );
  const enabledMcpServers = useMemo(
    () => state.mcpServers.filter((server) => server.enabled),
    [state.mcpServers],
  );
  const pickAttachments = async () => {
    const paths = await open({ multiple: true, directory: false, title: "添加文本上下文" });
    const selected = typeof paths === "string" ? [paths] : paths || [];
    if (selected.length) await state.importContextPaths(selected);
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="quick-row">
          {QUICK[state.kind].map((q) => {
            const QuickIcon = q.icon;
            return (
              <button
                key={q.label}
                type="button"
                className="chip"
                onClick={() => state.setDraft(q.text)}
              >
                <QuickIcon size={11} />
                {q.label}
              </button>
            );
          })}
        </div>

        {(state.mentions.length > 0 || state.selectedContextIds.length > 0) && (
          <div className="mention-row">
            {state.mentions.map((m, i) => (
              <button
                key={m}
                type="button"
                className={`mention ${i === 0 ? "" : "dim"}`}
                title="移除引用"
                onClick={() => state.removeMention(m)}
              >
                @ {m.split("/").pop()}
                <IconClose size={8} />
              </button>
            ))}
            {selectedContextItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="mention attachment"
                title="移除附件"
                onClick={() => state.toggleContextItem(item.id)}
              >
                <Paperclip size={10} />
                {item.displayName}
                <IconClose size={8} />
              </button>
            ))}
          </div>
        )}

        <textarea
          value={state.draft}
          onChange={(e) => state.setDraft(e.target.value)}
          placeholder="继续说点什么…"
          rows={2}
        />

        <div className="composer-actions">
          <button
            type="button"
            className="round-btn"
            title="添加文本附件"
            onClick={() => void pickAttachments()}
          >
            <Paperclip size={14} />
          </button>
          <button
            type="button"
            className="pill-btn"
            onClick={() => state.openFile && state.addMention(state.openFile)}
          >
            引用文件
          </button>
          <select
            className="pill-select"
            value={state.autoExecute}
            onChange={(e) => state.setAutoExecute(e.target.value)}
            title="本地审批策略"
          >
            {Object.entries(AUTO_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input
            className="pill-input"
            list="herdock-models"
            value={state.model}
            onChange={(event) => state.setModel(event.target.value)}
            placeholder="默认模型"
            aria-label="本次运行模型"
          />
          <datalist id="herdock-models">
            {candidateModels.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <details className="composer-menu">
            <summary title="选择 Skills">
              <PuzzlePiece size={13} />
              Skills {state.selectedSkillIds.length || ""}
            </summary>
            <div className="composer-menu-pop">
              {state.skills.map((skill) => (
                <label key={skill.id}>
                  <input
                    type="checkbox"
                    checked={state.selectedSkillIds.includes(skill.id)}
                    onChange={() => state.toggleSkill(skill.id)}
                  />
                  <span>
                    <b>{skill.name}</b>
                    <small>{skill.scope}</small>
                  </span>
                </label>
              ))}
              {!state.skills.length && <span className="empty-hint">未发现 Skill</span>}
            </div>
          </details>
          <details className="composer-menu">
            <summary title="选择 MCP">
              <PlugsConnected size={13} />
              MCP {state.selectedMcpIds.length || ""}
            </summary>
            <div className="composer-menu-pop">
              {enabledMcpServers.map((server) => (
                <label key={server.id}>
                  <input
                    type="checkbox"
                    checked={state.selectedMcpIds.includes(server.id)}
                    onChange={() => state.toggleMcpSelection(server.id)}
                  />
                  <span>
                    <b>{server.name}</b>
                    <small>{server.tools.length} tools</small>
                  </span>
                </label>
              ))}
              {!enabledMcpServers.length && <span className="empty-hint">未启用 MCP</span>}
            </div>
          </details>
          <select
            className="pill-select"
            value={state.kind}
            onChange={(e) => state.setKind(e.target.value as SessionKind)}
            title="会话类型"
          >
            <option value="mixed">混合</option>
            <option value="coding">Coding</option>
            <option value="analysis">分析</option>
          </select>
          <select
            className="pill-select"
            value={state.providerId}
            onChange={(e) => state.setProviderId(e.target.value)}
            title="Agent Provider"
          >
            {(state.providers.length
              ? state.providers.map((p) => ({
                  id: p.id,
                  label: p.available ? p.displayName : `${p.displayName}（未就绪）`,
                  disabled: !p.available,
                }))
              : ["codex", "claude", "grok"].map((id) => ({ id, label: id, disabled: false }))
            ).map((p) => (
              <option key={p.id} value={p.id} disabled={p.disabled}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="send-btn"
            disabled={!canSend}
            title={`发送 ${state.platform.submitHint}`}
            onClick={() => void state.sendPrompt()}
          >
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  );
}

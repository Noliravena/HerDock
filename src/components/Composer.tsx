import {
  At,
  CaretDown,
  CheckCircle,
  NotePencil,
  Paperclip,
  Play,
  PlugsConnected,
  PuzzlePiece,
  Question,
  SlidersHorizontal,
  type Icon,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench, type SessionKind } from "../store/workbench";
import { IconClose, IconSend } from "./Icons";
import { Popover } from "./Popover";

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

const AUTO_OPTIONS: { value: string; label: string; detail: string }[] = [
  { value: "ask_always", label: "始终询问", detail: "每个动作都要你点头" },
  { value: "ask_risky", label: "风险询问", detail: "只在写盘、联网等风险动作前询问" },
  { value: "auto_workspace", label: "工作区自动", detail: "工作区内自由执行，越界才问" },
  { value: "auto_all", label: "尽量自动", detail: "全程自动，仅策略强制项询问" },
];

const KIND_OPTIONS: { value: SessionKind; label: string }[] = [
  { value: "mixed", label: "混合" },
  { value: "coding", label: "Coding" },
  { value: "analysis", label: "分析" },
];

const MAX_TEXTAREA_HEIGHT = 216;

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
      run: s.run,
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
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = Boolean(state.draft.trim() || state.mentions.length);
  const running = state.run ? ["running", "starting"].includes(state.run.status) : false;
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
  const providerOptions = useMemo(
    () =>
      state.providers.length
        ? state.providers.map((p) => ({
            id: p.id,
            label: p.displayName,
            detail: p.available ? p.version || "就绪" : "未就绪",
            disabled: !p.available,
          }))
        : ["codex", "claude", "grok"].map((id) => ({
            id,
            label: id,
            detail: "",
            disabled: false,
          })),
    [state.providers],
  );
  const providerLabel =
    providerOptions.find((item) => item.id === state.providerId)?.label || state.providerId;
  const autoLabel =
    AUTO_OPTIONS.find((item) => item.value === state.autoExecute)?.label || state.autoExecute;

  // Grow with the draft, then scroll — a fixed two-row box made long prompts
  // unreadable while typing.
  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
    node.style.overflowY = node.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  }, [state.draft]);

  useEffect(() => {
    if (state.draft) return;
    const node = textareaRef.current;
    if (node) node.style.height = "auto";
  }, [state.draft]);

  const pickAttachments = async () => {
    const paths = await open({ multiple: true, directory: false, title: "添加文本上下文" });
    const selected = typeof paths === "string" ? [paths] : paths || [];
    if (selected.length) await state.importContextPaths(selected);
  };

  const submit = () => {
    if (!canSend) return;
    void state.sendPrompt();
  };

  const contextCount = state.mentions.length + selectedContextItems.length;
  const showSuggestions = !state.draft.trim();

  return (
    <div className="composer-wrap">
      <div className={`composer ${focused ? "focused" : ""} ${running ? "running" : ""}`}>
        {contextCount > 0 && (
          <div className="composer-context">
            <span className="context-lead">上下文</span>
            {state.mentions.map((m) => (
              <button
                key={m}
                type="button"
                className="ref-chip"
                title={`移除引用 ${m}`}
                onClick={() => state.removeMention(m)}
              >
                <At size={10} weight="bold" />
                <span className="ref-name">{m.split("/").pop()}</span>
                <IconClose size={9} />
              </button>
            ))}
            {selectedContextItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ref-chip attachment"
                title={`移除附件 ${item.displayName}`}
                onClick={() => state.toggleContextItem(item.id)}
              >
                <Paperclip size={10} />
                <span className="ref-name">{item.displayName}</span>
                <IconClose size={9} />
              </button>
            ))}
          </div>
        )}

        <div className="composer-field">
          <textarea
            ref={textareaRef}
            value={state.draft}
            onChange={(e) => state.setDraft(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="继续说点什么…"
            rows={1}
          />
        </div>

        {showSuggestions && (
          <div className="composer-suggest">
            {QUICK[state.kind].map((q) => {
              const QuickIcon = q.icon;
              return (
                <button
                  key={q.label}
                  type="button"
                  className="chip"
                  onClick={() => {
                    state.setDraft(q.text);
                    textareaRef.current?.focus();
                  }}
                >
                  <QuickIcon size={11} />
                  {q.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="composer-bar">
          <div className="bar-group">
            <button
              type="button"
              className="tool-btn"
              title="添加文本附件"
              onClick={() => void pickAttachments()}
            >
              <Paperclip size={14} />
            </button>
            <button
              type="button"
              className="tool-btn"
              title={state.openFile ? `引用 ${state.openFile}` : "先在编辑器中打开一个文件"}
              disabled={!state.openFile}
              onClick={() => state.openFile && state.addMention(state.openFile)}
            >
              <At size={14} />
            </button>

            <span className="bar-sep" />

            <Popover
              className="bar-pop"
              title="选择本次运行启用的 Skills"
              label={
                <>
                  <PuzzlePiece size={13} />
                  技能
                  {state.selectedSkillIds.length > 0 && (
                    <span className="pop-count">{state.selectedSkillIds.length}</span>
                  )}
                  <CaretDown size={9} weight="bold" />
                </>
              }
            >
              <div className="pop-head">技能 · 本次运行</div>
              <div className="pop-scroll">
                {state.skills.map((skill) => (
                  <label className="pop-check" key={skill.id}>
                    <input
                      type="checkbox"
                      checked={state.selectedSkillIds.includes(skill.id)}
                      onChange={() => state.toggleSkill(skill.id)}
                    />
                    <span className="pop-text">
                      <b>{skill.name}</b>
                      <small>{skill.scope}</small>
                    </span>
                  </label>
                ))}
                {!state.skills.length && (
                  <p className="pop-empty">在 .agents/skills 或全局目录中添加 SKILL.md。</p>
                )}
              </div>
            </Popover>

            <Popover
              className="bar-pop"
              title="选择本次运行可用的 MCP 服务"
              label={
                <>
                  <PlugsConnected size={13} />
                  MCP
                  {state.selectedMcpIds.length > 0 && (
                    <span className="pop-count">{state.selectedMcpIds.length}</span>
                  )}
                  <CaretDown size={9} weight="bold" />
                </>
              }
            >
              <div className="pop-head">本地 MCP · 本次运行</div>
              <div className="pop-scroll">
                {enabledMcpServers.map((server) => (
                  <label className="pop-check" key={server.id}>
                    <input
                      type="checkbox"
                      checked={state.selectedMcpIds.includes(server.id)}
                      onChange={() => state.toggleMcpSelection(server.id)}
                    />
                    <span className="pop-text">
                      <b>{server.name}</b>
                      <small>{server.tools.length} tools</small>
                    </span>
                  </label>
                ))}
                {!enabledMcpServers.length && (
                  <p className="pop-empty">尚未启用 MCP 服务，可在设置中添加。</p>
                )}
              </div>
            </Popover>
          </div>

          <div className="bar-group right">
            <Popover
              className="bar-pop run-config"
              align="end"
              title="运行设置：Provider、模型、会话类型与审批策略"
              label={
                <>
                  <SlidersHorizontal size={13} />
                  <span className="run-config-label">
                    {providerLabel}
                    {state.model && <em>{state.model}</em>}
                  </span>
                  <CaretDown size={9} weight="bold" />
                </>
              }
            >
              <div className="pop-head">运行设置</div>
              <div className="pop-scroll">
                <div className="pop-section">
                  <span className="pop-label">Provider</span>
                  {providerOptions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`pop-option ${state.providerId === item.id ? "on" : ""}`}
                      disabled={item.disabled}
                      onClick={() => state.setProviderId(item.id)}
                    >
                      <span className="pop-text">
                        <b>{item.label}</b>
                        {item.detail && <small>{item.detail}</small>}
                      </span>
                      {state.providerId === item.id && <span className="pop-mark" />}
                    </button>
                  ))}
                </div>

                <div className="pop-section">
                  <span className="pop-label">模型</span>
                  <input
                    className="pop-input"
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
                </div>

                <div className="pop-section">
                  <span className="pop-label">会话类型</span>
                  <div className="pop-seg">
                    {KIND_OPTIONS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={state.kind === item.value ? "on" : ""}
                        onClick={() => state.setKind(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pop-section">
                  <span className="pop-label">审批策略</span>
                  {AUTO_OPTIONS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={`pop-option ${state.autoExecute === item.value ? "on" : ""}`}
                      onClick={() => state.setAutoExecute(item.value)}
                    >
                      <span className="pop-text">
                        <b>{item.label}</b>
                        <small>{item.detail}</small>
                      </span>
                      {state.autoExecute === item.value && <span className="pop-mark" />}
                    </button>
                  ))}
                </div>
              </div>
            </Popover>

            <span className="send-hint">{state.platform.submitHint}</span>
            <button
              type="button"
              className="send-btn"
              disabled={!canSend}
              title={`发送 ${state.platform.submitHint}`}
              onClick={submit}
            >
              <IconSend />
            </button>
          </div>
        </div>
      </div>

      <div className="composer-foot">
        <span>
          {autoLabel}
          {running ? " · Agent 运行中" : ""}
        </span>
        <span className="grow" />
        {contextCount > 0 && <span>{contextCount} 项上下文</span>}
        <span>{state.platform.submitHint} 发送 · ⇧↵ 换行</span>
      </div>
    </div>
  );
}

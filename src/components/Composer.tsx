import {
  At,
  CaretDown,
  ChartBar,
  Check,
  ClockCounterClockwise,
  ArrowUp,
  ArrowsSplit,
  FirstAid,
  GearSix,
  GitBranch,
  GitFork,
  MagicWand,
  Paperclip,
  PlugsConnected,
  Plus,
  Pulse,
  Stop,
  Timer,
  Trash,
  type Icon,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench, type SessionKind } from "../store/workbench";
import type { FsNode, GitWorktree, WorktreeList } from "../host/client";
import { buildChatModels, chatModelLabel } from "../lib/models";
import { looksLikeScheduleIntent, parseScheduleIntent, type ParsedSchedule } from "../lib/nlCron";
import { QUICK, loadDraft, loadPromptHistory, pushPromptHistory, saveDraft } from "../lib/prompts";
import { contextUsageChip, contextUsedTokens, windowForModel } from "../lib/contextUsage";
import { runIsBusy } from "../lib/runBudget";
import { IconClose } from "./Icons";
import { Popover } from "./Popover";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { useConfirm } from "./pageElements";

function flattenFiles(nodes: FsNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "file") out.push(node.path);
    if (node.children) flattenFiles(node.children, out);
  }
  return out;
}

function mimeExtension(mime: string): string {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("failed to read clipboard image"));
    reader.readAsDataURL(file);
  });
}

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
      cancelRun: s.cancelRun,
      contextItems: s.contextItems,
      createSchedule: s.createSchedule,
      createWorktree: s.createWorktree,
      draft: s.draft,
      forkSession: s.forkSession,
      events: s.events,
      importContextPaths: s.importContextPaths,
      importContextBytes: s.importContextBytes,
      kind: s.kind,
      mcpServers: s.mcpServers,
      mentions: s.mentions,
      model: s.model,
      openFile: s.openFile,
      platform: s.platform,
      providerId: s.providerId,
      providerProfiles: s.providerProfiles,
      providers: s.providers,
      pruneWorktrees: s.pruneWorktrees,
      removeMention: s.removeMention,
      removeWorktree: s.removeWorktree,
      run: s.run,
      selectedContextIds: s.selectedContextIds,
      selectedMcpIds: s.selectedMcpIds,
      selectedSkillIds: s.selectedSkillIds,
      sendPrompt: s.sendPrompt,
      sendQueue: s.sendQueue,
      removeSendQueueItem: s.removeSendQueueItem,
      runLaunching: s.runLaunching,
      sessionId: s.session?.id,
      setAutoExecute: s.setAutoExecute,
      setCenterView: s.setCenterView,
      setDraft: s.setDraft,
      setKind: s.setKind,
      setModel: s.setModel,
      newSession: s.newSession,
      setProviderId: s.setProviderId,
      setSettingsOpen: s.setSettingsOpen,
      openSettings: s.openSettings,
      openSetupWizard: s.openSetupWizard,
      skills: s.skills,
      toggleContextItem: s.toggleContextItem,
      toggleMcpSelection: s.toggleMcpSelection,
      switchWorktree: s.switchWorktree,
      toggleSkill: s.toggleSkill,
      tree: s.tree,
      workspace: s.workspace,
      workspaces: s.workspaces,
      worktrees: s.worktrees,
    })),
  );
  const [focused, setFocused] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [schedulePending, setSchedulePending] = useState<ParsedSchedule | null>(null);
  const [askConfirm, confirmLayer] = useConfirm();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const files = useMemo(() => flattenFiles(state.tree), [state.tree]);
  const mentionQuery = useMemo(() => {
    const match = /(^|[\s])@([^\s@]*)$/.exec(state.draft);
    return match ? match[2].toLowerCase() : null;
  }, [state.draft]);
  const mentionOptions = useMemo(() => {
    if (mentionQuery == null) return [];
    return files
      .filter((path) => !mentionQuery || path.toLowerCase().includes(mentionQuery))
      .slice(0, 8);
  }, [files, mentionQuery]);

  // Slash commands (assistant-ui composer slash-commands element): a leading
  // "/" query surfaces follow-up prompts and app commands above the input.
  const slashQuery = useMemo(() => {
    const match = /^\/([^\s/]*)$/.exec(state.draft);
    return match ? match[1].toLowerCase() : null;
  }, [state.draft]);
  const slashOptions = useMemo(() => {
    if (slashQuery == null) return [];
    const historyMode =
      slashQuery.length > 0 && ("history".startsWith(slashQuery) || "历史".startsWith(slashQuery));
    const history = historyMode
      ? loadPromptHistory()
          .slice(0, 10)
          .map((text, index) => ({
            key: `history:${index}`,
            icon: ClockCounterClockwise,
            label: text.length > 42 ? `${text.slice(0, 42)}…` : text,
            hint: "历史",
            apply: () => state.setDraft(text),
          }))
      : [];
    const prompts = QUICK[state.kind]
      .filter((item) => item.label.toLowerCase().includes(slashQuery))
      .map((item) => ({
        key: `prompt:${item.label}`,
        icon: item.icon,
        label: item.label,
        hint: "插入提示词",
        apply: () => state.setDraft(item.text),
      }));
    const apps: {
      key: string;
      icon: Icon;
      label: string;
      hint: string;
      apply: () => void;
    }[] = [
      {
        key: "app:history",
        icon: ClockCounterClockwise,
        label: "提示词历史",
        hint: "/history",
        apply: () => state.setDraft("/history"),
      },
      {
        key: "app:diff",
        icon: ArrowsSplit,
        label: "打开差异",
        hint: "视图",
        apply: () => state.setCenterView("diff"),
      },
      {
        key: "app:activity",
        icon: Pulse,
        label: "打开活动",
        hint: "视图",
        apply: () => state.setCenterView("activity"),
      },
      {
        key: "app:usage",
        icon: ChartBar,
        label: "打开用量",
        hint: "视图",
        apply: () => state.setCenterView("usage"),
      },
      {
        key: "app:session",
        icon: Plus,
        label: "新会话",
        hint: "会话",
        apply: () => void state.newSession(),
      },
      {
        key: "app:fork",
        icon: GitFork,
        label: "分叉当前会话",
        hint: "/fork",
        apply: () => {
          state.setDraft("");
          void state.forkSession();
        },
      },
      {
        key: "app:schedule",
        icon: Timer,
        label: "创建定时任务",
        hint: "/定时",
        apply: () => state.setDraft("/定时 "),
      },
      {
        key: "app:settings",
        icon: GearSix,
        label: "打开设置",
        hint: "设置",
        apply: () => state.openSettings(),
      },
      {
        key: "app:doctor",
        icon: FirstAid,
        label: "环境诊断",
        hint: "设置",
        apply: () => state.openSettings({ tab: "doctor" }),
      },
      {
        key: "app:setup",
        icon: MagicWand,
        label: "设置向导",
        hint: "设置",
        apply: () => state.openSetupWizard(),
      },
    ].filter((item) => {
      if (item.key === "app:history") {
        return (
          !historyMode &&
          (slashQuery.length === 0 ||
            "history".startsWith(slashQuery) ||
            "历史".startsWith(slashQuery) ||
            item.label.includes(slashQuery))
        );
      }
      if (item.key === "app:fork") {
        return (
          slashQuery.length === 0 ||
          "fork".startsWith(slashQuery) ||
          "分叉".startsWith(slashQuery) ||
          item.label.includes(slashQuery)
        );
      }
      if (item.key === "app:schedule") {
        return (
          slashQuery.length === 0 ||
          "schedule".startsWith(slashQuery) ||
          "定时".startsWith(slashQuery) ||
          item.label.includes(slashQuery)
        );
      }
      return item.label.toLowerCase().includes(slashQuery);
    });
    return [...history, ...prompts, ...apps].slice(0, historyMode ? 12 : 8);
  }, [slashQuery, state.kind, state]);
  const applySlash = (option: (typeof slashOptions)[number]) => {
    option.apply();
    setSlashIndex(0);
    textareaRef.current?.focus();
  };

  const canSend = Boolean(state.draft.trim() || state.mentions.length);
  const running = state.run ? ["running", "starting"].includes(state.run.status) : false;
  const busy = runIsBusy(state.run, state.runLaunching);
  const chatModels = useMemo(
    () => buildChatModels(state.providerProfiles, state.providers),
    [state.providerProfiles, state.providers],
  );
  const modelLabel = chatModelLabel(state.model, state.providerId, state.providerProfiles);
  const selectedModel = chatModels.find(
    (item) => item.providerId === state.providerId && item.id === state.model,
  );
  const connectionReady = state.providers.some(
    (item) => item.id === state.providerId && item.available,
  );
  const insertCount = state.selectedSkillIds.length + state.selectedMcpIds.length;
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

  // Draft restore (assistant-ui draft-restore element): keep the draft per
  // session so reloads and session switches never lose a half-written prompt.
  useEffect(() => {
    if (!state.sessionId) return;
    const saved = loadDraft(state.sessionId);
    if (saved && !state.draft) state.setDraft(saved);
    // Restore only when the session changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionId]);

  useEffect(() => {
    if (state.sessionId) saveDraft(state.sessionId, state.draft);
  }, [state.sessionId, state.draft]);

  const pickAttachments = async () => {
    const paths = await open({ multiple: true, directory: false, title: "添加文本上下文" });
    const selected = typeof paths === "string" ? [paths] : paths || [];
    if (selected.length) await state.importContextPaths(selected);
  };

  const pasteImages = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;
    event.preventDefault();
    for (const file of files) {
      const bytesBase64 = await fileToBase64(file);
      const ext = mimeExtension(file.type);
      const fileName =
        file.name && file.name !== "image.png"
          ? file.name
          : `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
      await state.importContextBytes(fileName, file.type || "image/png", bytesBase64);
    }
  };

  const applyMention = (path: string) => {
    const next = state.draft.replace(/(^|[\s])@([^\s@]*)$/, `$1`);
    state.setDraft(next);
    state.addMention(path);
    setMentionIndex(0);
    textareaRef.current?.focus();
  };

  const submit = () => {
    if (!canSend) return;
    const prompt = state.draft.trim();
    if (/^\/(fork|分叉)\s*$/i.test(prompt)) {
      state.setDraft("");
      void state.forkSession();
      return;
    }
    if (/^\/(定时|schedule)\b/i.test(prompt) || looksLikeScheduleIntent(prompt)) {
      const parsed = parseScheduleIntent(prompt);
      if (parsed) {
        setSchedulePending(parsed);
        return;
      }
    }
    if (prompt) pushPromptHistory(prompt);
    setHistoryIndex(-1);
    setSchedulePending(null);
    void state.sendPrompt();
  };

  const confirmSchedule = () => {
    if (!schedulePending) return;
    const pending = schedulePending;
    setSchedulePending(null);
    void state.createSchedule(pending);
  };

  const sendScheduleAsPrompt = () => {
    setSchedulePending(null);
    const prompt = state.draft.trim();
    if (prompt) pushPromptHistory(prompt);
    setHistoryIndex(-1);
    void state.sendPrompt();
  };

  const contextCount = state.mentions.length + selectedContextItems.length;
  const usage = useMemo(() => {
    const contextBytes = selectedContextItems.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);
    const parts = contextUsedTokens({
      draft: state.draft,
      contextBytes,
      billed: state.run?.tokenUsage,
    });
    return contextUsageChip(parts.used, windowForModel(state.model), parts);
  }, [selectedContextItems, state.draft, state.model, state.run?.tokenUsage]);

  return (
    <div className="composer-wrap">
      {confirmLayer}
      <div className={`composer ${focused ? "focused" : ""} ${running ? "running" : ""}`}>
        {state.run && ["starting", "running", "waiting_approval"].includes(state.run.status) && (
          <ThinkingIndicator
            className="composer-status"
            label={state.run.status === "waiting_approval" ? "等待审批" : "思考中"}
            startedAt={state.run.startedAt || state.run.createdAt}
          />
        )}
        {state.sendQueue.length > 0 && (
          <div className="composer-context send-queue">
            <span className="context-lead">待发送</span>
            {state.sendQueue.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className="ref-chip"
                title={`移除排队消息：${item.text}`}
                onClick={() => state.removeSendQueueItem(item.id)}
              >
                <span className="ref-name">
                  {index + 1}. {item.text}
                </span>
                <IconClose size={9} />
              </button>
            ))}
          </div>
        )}
        {schedulePending && (
          <div className="composer-context schedule-confirm">
            <span className="context-lead">定时任务</span>
            <span className="schedule-confirm-summary">{schedulePending.summary}</span>
            <code className="schedule-confirm-cron">{schedulePending.cron}</code>
            <span className="schedule-confirm-prompt" title={schedulePending.prompt}>
              {schedulePending.prompt}
            </span>
            <button type="button" className="schedule-confirm-btn" onClick={confirmSchedule}>
              创建定时任务
            </button>
            <button
              type="button"
              className="schedule-confirm-btn ghost"
              onClick={sendScheduleAsPrompt}
            >
              还是发给 Agent
            </button>
            <button
              type="button"
              className="schedule-confirm-btn ghost"
              onClick={() => setSchedulePending(null)}
            >
              取消
            </button>
          </div>
        )}
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
          {mentionOptions.length > 0 && (
            <div className="mention-list" role="listbox" aria-label="引用文件">
              {mentionOptions.map((path, index) => (
                <button
                  key={path}
                  type="button"
                  role="option"
                  aria-selected={index === mentionIndex}
                  className={index === mentionIndex ? "on" : ""}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyMention(path);
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          )}
          {slashOptions.length > 0 && (
            <div className="mention-list slash-list" role="listbox" aria-label="斜杠命令">
              {slashOptions.map((option, index) => {
                const OptionIcon = option.icon;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="option"
                    aria-selected={index === slashIndex}
                    className={index === slashIndex ? "on" : ""}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySlash(option);
                    }}
                  >
                    <OptionIcon size={12} />
                    <span className="slash-name">{option.label}</span>
                    <span className="slash-hint">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={state.draft}
            onChange={(e) => state.setDraft(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (schedulePending && event.key === "Escape") {
                event.preventDefault();
                setSchedulePending(null);
                return;
              }
              if (
                schedulePending &&
                event.key === "Enter" &&
                !event.shiftKey &&
                (event.metaKey || event.ctrlKey)
              ) {
                event.preventDefault();
                confirmSchedule();
                return;
              }
              if (slashOptions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setSlashIndex(
                  (index) => (index + step + slashOptions.length) % slashOptions.length,
                );
                return;
              }
              if (
                slashOptions.length &&
                event.key === "Enter" &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                event.preventDefault();
                applySlash(slashOptions[slashIndex] || slashOptions[0]);
                return;
              }
              if (slashOptions.length && event.key === "Escape") {
                event.preventDefault();
                state.setDraft("");
                return;
              }
              if (mentionOptions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setMentionIndex(
                  (index) => (index + step + mentionOptions.length) % mentionOptions.length,
                );
                return;
              }
              if (
                mentionOptions.length &&
                event.key === "Enter" &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                event.preventDefault();
                applyMention(mentionOptions[mentionIndex] || mentionOptions[0]);
                return;
              }
              if (mentionOptions.length && event.key === "Escape") {
                event.preventDefault();
                state.setDraft(state.draft.replace(/(^|[\s])@([^\s@]*)$/, "$1"));
                return;
              }
              if (event.key === "ArrowUp" && !state.draft.trim()) {
                const history = loadPromptHistory();
                if (!history.length) return;
                event.preventDefault();
                const next = Math.min(historyIndex + 1, history.length - 1);
                setHistoryIndex(next);
                state.setDraft(history[next] || "");
                return;
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                (event.metaKey || event.ctrlKey || busy)
              ) {
                event.preventDefault();
                submit();
              }
            }}
            onPaste={(event) => void pasteImages(event)}
            placeholder="有什么想做的？ · 输入 / 唤起命令"
            rows={1}
          />
        </div>

        <div className="composer-bar">
          <div className="bar-group">
            {/* Plus menu — one entry point for everything the run can carry:
                attachments, file references, skills, and MCP servers. */}
            <Popover
              className="cmenu cmenu-add"
              title="添加附件、引用、技能与 MCP"
              label={
                <>
                  <Plus size={16} />
                  {insertCount > 0 && <span className="cm-trigger-count">{insertCount}</span>}
                </>
              }
            >
              {(close) => (
                <div className="cm-scroll">
                  <button
                    type="button"
                    className="cm-item"
                    onClick={() => {
                      close();
                      void pickAttachments();
                    }}
                  >
                    <Paperclip size={15} />
                    <span>上传文本附件</span>
                  </button>
                  <button
                    type="button"
                    className="cm-item"
                    disabled={!state.openFile}
                    title={state.openFile ? `引用 ${state.openFile}` : "先在编辑器中打开一个文件"}
                    onClick={() => {
                      if (!state.openFile) return;
                      state.addMention(state.openFile);
                      close();
                    }}
                  >
                    <At size={15} />
                    <span className="cm-item-text">
                      引用当前文件
                      {state.openFile && <small>{state.openFile.split("/").pop()}</small>}
                    </span>
                  </button>
                  <div className="cm-label">技能 · 本次运行</div>
                  {state.skills.map((skill) => {
                    const on = state.selectedSkillIds.includes(skill.id);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        className={`cm-check ${on ? "on" : ""}`}
                        aria-pressed={on}
                        onClick={() => state.toggleSkill(skill.id)}
                      >
                        <span className="cm-check-text">
                          <b>{skill.name}</b>
                          <small>{skill.scope}</small>
                        </span>
                        <span className="cm-box" aria-hidden="true">
                          {on && <Check size={11} weight="bold" />}
                        </span>
                      </button>
                    );
                  })}
                  {!state.skills.length && (
                    <p className="cm-empty">在 .agents/skills 或全局目录中添加 SKILL.md。</p>
                  )}
                  <div className="cm-label">MCP 服务 · 本次运行</div>
                  {enabledMcpServers.map((server) => {
                    const on = state.selectedMcpIds.includes(server.id);
                    return (
                      <button
                        key={server.id}
                        type="button"
                        className={`cm-check ${on ? "on" : ""}`}
                        aria-pressed={on}
                        onClick={() => state.toggleMcpSelection(server.id)}
                      >
                        <span className="cm-check-text">
                          <b>{server.name}</b>
                          <small>{server.tools.length} tools</small>
                        </span>
                        <span className="cm-box" aria-hidden="true">
                          {on && <Check size={11} weight="bold" />}
                        </span>
                      </button>
                    );
                  })}
                  {!enabledMcpServers.length && (
                    <p className="cm-empty">尚未启用 MCP 服务，可在设置中添加。</p>
                  )}
                  {(() => {
                    // Prompt library lite (assistant-ui prompt-library element):
                    // recent prompts stored locally, one click to reuse.
                    const recent = loadPromptHistory().slice(0, 4);
                    if (!recent.length) return null;
                    return (
                      <>
                        <div className="cm-label">最近提示词</div>
                        {recent.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            className="cm-item"
                            title={prompt}
                            onClick={() => {
                              state.setDraft(prompt);
                              close();
                              textareaRef.current?.focus();
                            }}
                          >
                            <ClockCounterClockwise size={15} />
                            <span className="cm-item-text">
                              <span className="cm-truncate">{prompt}</span>
                            </span>
                          </button>
                        ))}
                      </>
                    );
                  })()}
                </div>
              )}
            </Popover>
            {state.worktrees.available && (
              <WorktreeChip
                worktrees={state.worktrees}
                switchWorktree={state.switchWorktree}
                createWorktree={state.createWorktree}
                removeWorktree={state.removeWorktree}
                pruneWorktrees={state.pruneWorktrees}
                askConfirm={askConfirm}
              />
            )}
            <Popover
              className="cmenu cmenu-model"
              title="模型：本次对话使用的模型"
              label={
                <>
                  <span className={`prov-dot ${connectionReady ? "on" : "off"}`} />
                  <span className="model-chip-name">{modelLabel || "选择模型"}</span>
                  <CaretDown size={9} weight="bold" />
                </>
              }
            >
              <div className="cm-scroll">
                <div className="cm-label">对话对象是模型，CLI 与 API 只是背后的连接</div>
                {chatModels.map((model) => {
                  const selected =
                    model.providerId === state.providerId && model.id === state.model;
                  return (
                    <button
                      key={`${model.providerId}:${model.id}`}
                      type="button"
                      className={`cm-item cm-model ${selected ? "on" : ""}`}
                      disabled={!model.available}
                      onClick={() => {
                        state.setProviderId(model.providerId);
                        state.setModel(model.id);
                      }}
                    >
                      <span className="cm-item-text">
                        <b className="model-id">{model.id}</b>
                        <small>
                          via {model.connectionLabel} · {model.available ? "已连接" : "未连接"}
                        </small>
                      </span>
                      {selected && (
                        <span className="cm-mark">
                          <Check size={12} weight="bold" />
                        </span>
                      )}
                    </button>
                  );
                })}
                {!chatModels.length && (
                  <p className="cm-empty">
                    尚未配置可用连接。到设置的 Provider 页面连接 CLI 或填写 API Key。
                  </p>
                )}
                <div className="cm-label">会话类型</div>
                <div className="cm-seg">
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
                <div className="cm-label">此工作区的审批策略</div>
                {AUTO_OPTIONS.map((item) => {
                  const on = state.autoExecute === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={`cm-check ${on ? "on" : ""}`}
                      aria-pressed={on}
                      onClick={() => state.setAutoExecute(item.value)}
                    >
                      <span className="cm-check-text">
                        <b>{item.label}</b>
                        <small>{item.detail}</small>
                      </span>
                      <span className="cm-box" aria-hidden="true">
                        {on && <Check size={11} weight="bold" />}
                      </span>
                    </button>
                  );
                })}
                {selectedModel && !selectedModel.available && (
                  <p className="cm-warn">
                    {selectedModel.connectionLabel} 目前未连接，发送前请先在设置中完成连接。
                  </p>
                )}
                <div className="cm-foot">
                  <button
                    type="button"
                    className="cm-foot-btn"
                    onClick={() => state.setSettingsOpen(true)}
                  >
                    <PlugsConnected size={14} />
                    管理 CLI 与 API 连接
                    <span className="cm-foot-go">设置</span>
                  </button>
                </div>
              </div>
            </Popover>
          </div>

          <div className="bar-group right">
            {usage.pct > 0 && (
              <button
                type="button"
                className="context-usage-chip"
                title={usage.title}
                onClick={() => state.setCenterView("usage")}
              >
                <ChartBar size={12} />
                {usage.label}
              </button>
            )}
            {busy ? (
              <>
                {canSend && (
                  <button type="button" className="send-btn" title="排队下一条" onClick={submit}>
                    <ArrowUp size={16} weight="bold" />
                  </button>
                )}
                <button
                  type="button"
                  className="send-btn stop"
                  title="停止本次运行"
                  onClick={() => void state.cancelRun()}
                >
                  <Stop size={12} weight="fill" />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="send-btn"
                disabled={!canSend}
                title={`发送 ${state.platform.submitHint}`}
                onClick={submit}
              >
                <ArrowUp size={16} weight="bold" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function pathLeaf(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

function isDirtyWorktreeError(error: unknown): boolean {
  return /--force|modified|untracked|未提交/i.test(String(error));
}

function WorktreeChip({
  worktrees,
  switchWorktree,
  createWorktree,
  removeWorktree,
  pruneWorktrees,
  askConfirm,
}: {
  worktrees: WorktreeList;
  switchWorktree: (path: string) => Promise<void>;
  createWorktree: (name: string, startPoint?: string) => Promise<void>;
  removeWorktree: (path: string, force?: boolean) => Promise<void>;
  pruneWorktrees: () => Promise<void>;
  askConfirm: (options: {
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const current =
    worktrees.items.find((item) => item.isCurrent) || worktrees.items.find((item) => item.isMain);
  const label = current?.branch || (current ? pathLeaf(current.path) : "worktree");

  const removeItem = async (item: GitWorktree) => {
    const ok = await askConfirm({
      title: "删除 worktree？",
      body: `删除「${item.branch || pathLeaf(item.path)}」？主仓库不会被删。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeWorktree(item.path);
    } catch (error) {
      if (!isDirtyWorktreeError(error)) return;
      const force = await askConfirm({
        title: "工作区有未提交改动",
        body: "强制删除会丢掉这个 worktree 里未提交的改动，主仓库不受影响。",
        confirmLabel: "强制删除",
        danger: true,
      });
      if (force) await removeWorktree(item.path, true);
    }
  };

  return (
    <Popover
      className="cmenu cmenu-worktree"
      title="Git worktree：切换当前工作目录"
      label={
        <>
          <GitBranch size={12} />
          <span className="model-chip-name">{label}</span>
          <CaretDown size={9} weight="bold" />
        </>
      }
    >
      {(close) => (
        <div className="cm-scroll">
          <div className="cm-label">切换工作目录会打开对应文件夹作为工作区</div>
          {worktrees.items.map((item) => (
            <div key={item.path} className={`cm-worktree ${item.isCurrent ? "on" : ""}`}>
              <button
                type="button"
                className={`cm-item ${item.isCurrent ? "on" : ""}`}
                onClick={() => {
                  if (!item.isCurrent) void switchWorktree(item.path);
                  close();
                }}
              >
                <GitBranch size={15} />
                <span className="cm-item-text">
                  <b>
                    {item.branch || pathLeaf(item.path)}
                    {item.isMain ? " · 主" : ""}
                    {item.isCurrent ? " · 当前" : ""}
                  </b>
                  <small>{item.path}</small>
                </span>
              </button>
              {!item.isMain && (
                <button
                  type="button"
                  className="cm-worktree-del"
                  title="删除这个 worktree"
                  onClick={() => void removeItem(item)}
                >
                  <Trash size={12} />
                </button>
              )}
            </div>
          ))}
          {!worktrees.items.length && <p className="cm-empty">当前仓库没有列出 worktree。</p>}
          <div className="cm-label">新建旁路工作树</div>
          <form
            className="wt-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void createWorktree(name.trim(), startPoint.trim() || undefined);
              setName("");
              setStartPoint("");
              close();
            }}
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="名称，如 hotfix"
              aria-label="worktree 名称"
            />
            <input
              value={startPoint}
              onChange={(event) => setStartPoint(event.target.value)}
              placeholder="起点（可选 branch / commit）"
              aria-label="起点"
            />
            <button type="submit" disabled={!name.trim()}>
              创建并切换
            </button>
          </form>
          <div className="cm-foot">
            <button type="button" className="cm-foot-btn" onClick={() => void pruneWorktrees()}>
              清理失效 worktree
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

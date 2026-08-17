import type { Icon } from "@phosphor-icons/react";
import { CheckCircle, NotePencil, Play, Question } from "@phosphor-icons/react";
import type { SessionKind } from "../store/workbench";

/** Follow-up suggestions shared by the thread tail and the composer's slash
 * commands (assistant-ui follow-up-suggestions / slash-commands elements). */
export const QUICK: Record<SessionKind, { label: string; icon: Icon; text: string }[]> = {
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

const PROMPT_HISTORY_KEY = "herdock.prompt-history.v1";
const PROMPT_HISTORY_MAX = 50;

export function loadPromptHistory(): string[] {
  try {
    const raw = localStorage.getItem(PROMPT_HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function pushPromptHistory(prompt: string): void {
  const next = [prompt, ...loadPromptHistory().filter((item) => item !== prompt)].slice(
    0,
    PROMPT_HISTORY_MAX,
  );
  try {
    localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

const DRAFT_KEY_PREFIX = "herdock.draft.v1";

/** Draft restore (assistant-ui draft-restore element): the composer's text
 * survives reloads and session switches, keyed per session. */
export function saveDraft(sessionId: string, draft: string): void {
  try {
    localStorage.setItem(`${DRAFT_KEY_PREFIX}:${sessionId}`, draft);
  } catch {
    /* ignore */
  }
}

export function loadDraft(sessionId: string): string {
  try {
    return localStorage.getItem(`${DRAFT_KEY_PREFIX}:${sessionId}`) ?? "";
  } catch {
    return "";
  }
}

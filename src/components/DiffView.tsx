import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, Clock } from "@phosphor-icons/react";
import type { FileEditEvent } from "@her-dock/agent-protocol";
import { useShallow } from "zustand/react/shallow";
import { hostApi } from "../host/client";
import { useWorkbench } from "../store/workbench";
import { buildFileTree, ConnectionBanner, FileTreeCard, PageEmpty } from "./pageElements";

type DiffRow = { a: string; b: string; text: string; tone: "add" | "del" | "hunk" | "" };

/** Parse a unified diff hunk into two-gutter rows like the design's 差异 view. */
function parseUnified(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let a = 0;
  let b = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        a = Number(m[1]);
        b = Number(m[2]);
      }
      rows.push({ a: "", b: "", text: line, tone: "hunk" });
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) continue;
    if (line.startsWith("+")) {
      rows.push({ a: "", b: String(b++), text: line, tone: "add" });
    } else if (line.startsWith("-")) {
      rows.push({ a: String(a++), b: "", text: line, tone: "del" });
    } else {
      rows.push({ a: String(a++), b: String(b++), text: line, tone: "" });
    }
  }
  return rows;
}

type Decision = "pending" | "reviewed" | "deferred";

export function DiffView() {
  const { cancelRun, continueRun, events, hostOnline, openPath, workspace } = useWorkbench(
    useShallow((state) => ({
      cancelRun: state.cancelRun,
      continueRun: state.continueRun,
      events: state.events,
      hostOnline: state.hostOnline,
      openPath: state.openPath,
      workspace: state.workspace,
    })),
  );
  const [gitDiffs, setGitDiffs] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const edits = events.filter(
    (e): e is FileEditEvent => e.type === "file.edit_proposed" || e.type === "file.edit_applied",
  );
  const additions = edits.reduce((n, e) => n + (e.additions ?? 0), 0);
  const deletions = edits.reduce((n, e) => n + (e.deletions ?? 0), 0);
  const workspaceId = workspace?.id;
  const missing = edits.filter((e) => !e.diff).map((e) => e.path);
  const missingKey = missing.join("|");
  const editKey = edits.map((e) => e.id).join("|");

  const tree = useMemo(
    () =>
      buildFileTree(
        edits.map((edit) => ({
          path: edit.path,
          additions: edit.additions,
          deletions: edit.deletions,
        })),
      ),
    [editKey],
  );

  // A fresh set of edits is a fresh review pass.
  useEffect(() => setDecisions({}), [editKey]);

  // Providers do not always emit hunks — fall back to `git diff HEAD -- <path>`.
  useEffect(() => {
    if (!workspaceId || !hostOnline || !missingKey) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        missingKey.split("|").map(async (path) => {
          try {
            const res = await hostApi.fileDiff(workspaceId, path);
            return [path, res] as const;
          } catch {
            return [path, ""] as const;
          }
        }),
      );
      if (!cancelled) setGitDiffs(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, hostOnline, missingKey]);

  const pending = edits.filter((edit) => (decisions[edit.id] ?? "pending") === "pending").length;
  const reviewed = edits.filter((edit) => decisions[edit.id] === "reviewed").length;
  const decide = (id: string, decision: Decision) =>
    setDecisions((current) => ({
      ...current,
      [id]: current[id] === decision ? "pending" : decision,
    }));

  if (!edits.length) {
    return (
      <div className="view diff-view">
        {!hostOnline && <ConnectionBanner message="与本地核心的连接已断开，采纳与停止暂不可用。" />}
        <PageEmpty
          title="本次运行还没有文件改动"
          body="Agent 提议或写入文件后，改动会按文件出现在这里，可逐个复核再采纳。"
        />
      </div>
    );
  }

  return (
    <div className="view diff-view">
      {!hostOnline && <ConnectionBanner message="与本地核心的连接已断开，采纳与停止暂不可用。" />}
      <div className="diff-head">
        <span className="path">{workspace?.name || "工作区"}</span>
        <span className="badge ok mono">
          +{additions} −{deletions}
        </span>
        <span className="diff-review-count mono">
          {reviewed}/{edits.length} 已复核
        </span>
      </div>

      <div className="diff-body">
        <FileTreeCard
          nodes={tree}
          totalAdditions={additions}
          totalDeletions={deletions}
          onOpen={(path) => void openPath(path)}
        />

        {edits.map((e) => {
          const diff = e.diff || gitDiffs[e.path] || "";
          const decision = decisions[e.id] ?? "pending";
          return (
            <article className={`diff-file ${decision}`} key={e.id}>
              <div className="diff-file-head">
                <span className={`edit-kind ${e.kind}`}>{e.kind}</span>
                <button type="button" className="edit-path" onClick={() => void openPath(e.path)}>
                  {e.path}
                  <ArrowUpRight size={11} />
                </button>
                <span className="edit-diff mono">
                  <b className="add">+{e.additions ?? 0}</b>{" "}
                  <b className="del">−{e.deletions ?? 0}</b>
                </span>
                <span className="diff-file-review">
                  {decision === "pending" ? (
                    <>
                      <button
                        type="button"
                        className="defer"
                        onClick={() => decide(e.id, "deferred")}
                      >
                        <Clock size={11} />
                        稍后
                      </button>
                      <button
                        type="button"
                        className="keep"
                        onClick={() => decide(e.id, "reviewed")}
                      >
                        <Check size={11} weight="bold" />
                        已复核
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={`decided ${decision}`}
                      title="撤销这次标记"
                      onClick={() => decide(e.id, decision)}
                    >
                      {decision === "reviewed" ? "已复核" : "稍后再看"}
                    </button>
                  )}
                </span>
              </div>
              {diff ? (
                parseUnified(diff).map((row, i) => (
                  <div className={`diff-line ${row.tone}`} key={i}>
                    <span className="gutter">{row.a}</span>
                    <span className="gutter b">{row.b}</span>
                    <span className="text">{row.text}</span>
                  </div>
                ))
              ) : (
                <div className="diff-line">
                  <span className="gutter" />
                  <span className="gutter b" />
                  <span className="text">
                    没有可展示的 diff 片段（文件可能未被 git
                    跟踪）。点文件名在编辑器里查看磁盘内容。
                  </span>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <footer className="diff-foot" data-slot="reviewable-diff">
        <span className="mono">{pending > 0 ? `还有 ${pending} 个文件待复核` : "全部已复核"}</span>
        <button type="button" className="mini-btn" onClick={() => void cancelRun()}>
          丢弃 / 停止
        </button>
        <button
          type="button"
          className="mini-btn primary"
          title="以磁盘上的当前内容继续运行（磁盘优先）"
          onClick={() => void continueRun()}
        >
          采纳并继续
        </button>
      </footer>
    </div>
  );
}

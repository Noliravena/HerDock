import { useEffect, useState } from "react";
import type { FileEditEvent } from "@her-dock/agent-protocol";
import { hostApi } from "../host/client";
import { useWorkbench } from "../store/workbench";

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

export function DiffView() {
  const s = useWorkbench();
  const [gitDiffs, setGitDiffs] = useState<Record<string, string>>({});
  const edits = s.events.filter(
    (e): e is FileEditEvent => e.type === "file.edit_proposed" || e.type === "file.edit_applied",
  );
  const additions = edits.reduce((n, e) => n + (e.additions ?? 0), 0);
  const deletions = edits.reduce((n, e) => n + (e.deletions ?? 0), 0);
  const workspaceId = s.workspace?.id;
  const missing = edits.filter((e) => !e.diff).map((e) => e.path);
  const missingKey = missing.join("|");

  // Providers do not always emit hunks — fall back to `git diff HEAD -- <path>`.
  useEffect(() => {
    if (!workspaceId || !s.hostOnline || !missingKey) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        missingKey.split("|").map(async (path) => {
          try {
            const res = await hostApi.fileDiff(workspaceId, path);
            return [path, res.diff] as const;
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
  }, [workspaceId, s.hostOnline, missingKey]);

  return (
    <div className="view">
      <div className="diff-head">
        <span className="path">{s.workspace?.name || "工作区"} · {edits.length} 个文件</span>
        <span className="badge ok">
          +{additions} −{deletions}
        </span>
        <div className="actions">
          <button
            type="button"
            className="mini-btn primary"
            title="以磁盘上的当前内容继续运行（磁盘优先）"
            onClick={() => void s.continueRun()}
          >
            采纳并继续
          </button>
          <button type="button" className="mini-btn" onClick={() => void s.cancelRun()}>
            丢弃 / 停止
          </button>
        </div>
      </div>

      <div className="diff-body">
        {edits.map((e) => {
          const diff = e.diff || gitDiffs[e.path] || "";
          return (
            <div className="diff-file" key={e.id}>
              <button
                type="button"
                className="diff-file-head"
                onClick={() => void s.openPath(e.path)}
              >
                <span className={`edit-kind ${e.kind}`}>{e.kind}</span>
                <span className="edit-path">{e.path}</span>
                <span className="edit-diff">
                  +{e.additions ?? 0} −{e.deletions ?? 0}
                </span>
              </button>
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
                    没有可展示的 diff 片段（文件可能未被 git 跟踪）。点文件名在编辑器里查看磁盘内容。
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {!edits.length && (
          <div className="empty-hint">
            本次运行还没有文件改动。Agent 提议或写入文件后，改动会出现在这里。
          </div>
        )}
      </div>
    </div>
  );
}

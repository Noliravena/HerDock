import { useEffect, useMemo, useRef } from "react";
import { useWorkbench, iconForPath } from "../store/workbench";
import type { FsNode } from "../host/client";
import { IconSearch } from "./Icons";

type PaletteTone = "" | "accent" | "ok" | "violet";

type PaletteItem = {
  id: string;
  glyph: string;
  tone: PaletteTone;
  name: string;
  hint: string;
  run: () => void;
};

function flatten(nodes: FsNode[], out: FsNode[] = []): FsNode[] {
  for (const n of nodes) {
    if (n.kind === "file") out.push(n);
    if (n.children) flatten(n.children, out);
  }
  return out;
}

export function CommandPalette({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const s = useWorkbench();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const groups = useMemo(() => {
    const q = s.paletteQuery.trim().toLowerCase();
    const match = (text: string) => !q || text.toLowerCase().includes(q);

    const jump: PaletteItem[] = [];
    for (const sess of Object.values(s.workspaceSessions).flat().slice(0, 30)) {
      if (!match(sess.title)) continue;
      jump.push({
        id: `sess:${sess.id}`,
        glyph: "◆",
        tone: "accent",
        name: sess.title,
        hint: sess.kind,
        run: () => void s.selectSession(sess.id),
      });
    }
    for (const f of flatten(s.tree).slice(0, 200)) {
      if (!match(f.path)) continue;
      if (jump.length > 20) break;
      jump.push({
        id: `file:${f.path}`,
        glyph: iconForPath(f.path),
        tone: f.path.endsWith(".md") ? "violet" : "ok",
        name: f.path,
        hint: s.workspace?.name || "",
        run: () => void s.openPath(f.path),
      });
    }

    const actions: PaletteItem[] = ([
      {
        id: "new-session",
        glyph: "＋",
        tone: "",
        name: "在当前工作区新建会话",
        hint: s.platform.newHint,
        run: () => void s.newSession(),
      },
      {
        id: "open-folder",
        glyph: "⊕",
        tone: "",
        name: "打开工作区文件夹…",
        hint: `${s.platform.modifierKey} O`,
        run: onOpenWorkspace,
      },
      {
        id: "continue",
        glyph: "✓",
        tone: "",
        name: "采纳磁盘改动并继续运行",
        hint: s.platform.submitHint,
        run: () => void s.continueRun(),
      },
      {
        id: "diff",
        glyph: "±",
        tone: "",
        name: "查看未采纳差异",
        hint: "",
        run: () => s.setCenterView("diff"),
      },
      {
        id: "activity",
        glyph: "▤",
        tone: "",
        name: "打开活动列表",
        hint: "",
        run: () => s.setCenterView("activity"),
      },
      {
        id: "cancel",
        glyph: "■",
        tone: "",
        name: "停止当前运行",
        hint: "",
        run: () => void s.cancelRun(),
      },
    ] as PaletteItem[]).filter((a) => match(a.name));

    return [
      { label: "跳转", items: jump.slice(0, 8) },
      { label: "动作", items: actions },
    ].filter((g) => g.items.length > 0);
  }, [s, onOpenWorkspace]);

  const runItem = (item: PaletteItem) => {
    item.run();
    s.togglePalette();
  };

  return (
    <div className="palette-mask" onClick={s.togglePalette}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <IconSearch size={15} />
          <input
            ref={inputRef}
            value={s.paletteQuery}
            placeholder="搜索文件、会话，或直接下达指令…"
            onChange={(e) => s.setPaletteQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") s.togglePalette();
              if (e.key === "Enter") {
                const first = groups[0]?.items[0];
                if (first) runItem(first);
              }
            }}
          />
          <span className="esc">ESC</span>
        </div>
        <div className="palette-list">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="palette-group">{g.label}</div>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="palette-item"
                  onClick={() => runItem(item)}
                >
                  <span className={`palette-glyph ${item.tone}`}>{item.glyph}</span>
                  <span className="name">{item.name}</span>
                  <span className="hint">{item.hint}</span>
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <div className="empty-hint">没有匹配项。</div>}
        </div>
      </div>
    </div>
  );
}

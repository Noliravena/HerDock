import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChartLineUp,
  Check,
  Diamond,
  File,
  FolderOpen,
  GitDiff,
  ListBullets,
  PlugsConnected,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Stop,
  type Icon,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench, iconForPath } from "../store/workbench";
import type { FsNode } from "../host/client";
import { IconSearch } from "./Icons";

type PaletteTone = "" | "accent" | "ok" | "violet";

type PaletteItem = {
  id: string;
  glyph?: string;
  icon?: Icon;
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
  const state = useWorkbench(
    useShallow((s) => ({
      cancelRun: s.cancelRun,
      continueRun: s.continueRun,
      newSession: s.newSession,
      openPath: s.openPath,
      paletteQuery: s.paletteQuery,
      platform: s.platform,
      selectSession: s.selectSession,
      setCenterView: s.setCenterView,
      setPaletteQuery: s.setPaletteQuery,
      togglePalette: s.togglePalette,
      tree: s.tree,
      workspace: s.workspace,
      workspaceSessions: s.workspaceSessions,
    })),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const groups = useMemo(() => {
    const q = state.paletteQuery.trim().toLowerCase();
    const match = (text: string) => !q || text.toLowerCase().includes(q);

    const jump: PaletteItem[] = [];
    for (const sess of Object.values(state.workspaceSessions).flat().slice(0, 30)) {
      if (!match(sess.title)) continue;
      jump.push({
        id: `sess:${sess.id}`,
        icon: Diamond,
        tone: "accent",
        name: sess.title,
        hint: sess.kind,
        run: () => void state.selectSession(sess.id),
      });
    }
    for (const f of flatten(state.tree).slice(0, 200)) {
      if (!match(f.path)) continue;
      if (jump.length > 20) break;
      jump.push({
        id: `file:${f.path}`,
        glyph: iconForPath(f.path),
        tone: f.path.endsWith(".md") ? "violet" : "ok",
        name: f.path,
        hint: state.workspace?.name || "",
        run: () => void state.openPath(f.path),
      });
    }

    const actions: PaletteItem[] = (
      [
        {
          id: "new-session",
          icon: Plus,
          tone: "",
          name: "在当前工作区新建会话",
          hint: state.platform.newHint,
          run: () => void state.newSession(),
        },
        {
          id: "open-folder",
          icon: FolderOpen,
          tone: "",
          name: "打开工作区文件夹…",
          hint: `${state.platform.modifierKey} O`,
          run: onOpenWorkspace,
        },
        {
          id: "continue",
          icon: Check,
          tone: "",
          name: "采纳磁盘改动并继续运行",
          hint: state.platform.submitHint,
          run: () => void state.continueRun(),
        },
        {
          id: "diff",
          icon: GitDiff,
          tone: "",
          name: "查看未采纳差异",
          hint: "",
          run: () => state.setCenterView("diff"),
        },
        {
          id: "activity",
          icon: ListBullets,
          tone: "",
          name: "打开活动列表",
          hint: "",
          run: () => state.setCenterView("activity"),
        },
        {
          id: "approvals",
          icon: ShieldCheck,
          tone: "",
          name: "打开审批中心",
          hint: "",
          run: () => state.setCenterView("approvals"),
        },
        {
          id: "usage",
          icon: ChartLineUp,
          tone: "",
          name: "打开用量与成本",
          hint: "",
          run: () => state.setCenterView("usage"),
        },
        {
          id: "skills",
          icon: SlidersHorizontal,
          tone: "",
          name: "打开技能",
          hint: "",
          run: () => state.setCenterView("skills"),
        },
        {
          id: "mcp",
          icon: PlugsConnected,
          tone: "",
          name: "打开本地 MCP",
          hint: "",
          run: () => state.setCenterView("mcp"),
        },
        {
          id: "artifacts",
          icon: File,
          tone: "",
          name: "打开产物库",
          hint: "",
          run: () => state.setCenterView("artifacts"),
        },
        {
          id: "cancel",
          icon: Stop,
          tone: "",
          name: "停止当前运行",
          hint: "",
          run: () => void state.cancelRun(),
        },
      ] as PaletteItem[]
    ).filter((a) => match(a.name));

    return [
      { label: "跳转", items: jump.slice(0, 8) },
      { label: "动作", items: actions },
    ].filter((g) => g.items.length > 0);
  }, [state, onOpenWorkspace]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Keep the highlight inside the result set as the query narrows it.
  useEffect(() => {
    setActive((index) => (index < flat.length ? index : 0));
  }, [flat.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(".palette-item.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runItem = (item: PaletteItem) => {
    item.run();
    state.togglePalette();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      state.togglePalette();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!flat.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = flat[active] || flat[0];
      if (item) runItem(item);
    }
  };

  let cursor = -1;

  return (
    <div className="palette-mask" onClick={state.togglePalette}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            value={state.paletteQuery}
            placeholder="搜索文件、会话，或直接下达指令…"
            onChange={(e) => {
              state.setPaletteQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="esc">ESC</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {groups.map((g) => (
            <div key={g.label}>
              <div className="palette-group">{g.label}</div>
              {g.items.map((item) => {
                const ItemIcon = item.icon;
                cursor += 1;
                const index = cursor;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`palette-item ${index === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => runItem(item)}
                  >
                    <span className={`palette-glyph ${item.tone}`}>
                      {ItemIcon ? <ItemIcon size={14} /> : item.glyph}
                    </span>
                    <span className="name">{item.name}</span>
                    <span className="hint">{item.hint}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {!groups.length && <div className="empty-hint">没有匹配项。</div>}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>↵</kbd> 打开
          </span>
          <span>
            <kbd>esc</kbd> 关闭
          </span>
          <span className="grow" />
          <span>{flat.length} 项结果</span>
        </div>
      </div>
    </div>
  );
}

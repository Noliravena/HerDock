import { useState, type MouseEvent } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { FsNode } from "../host/client";
import { iconForPath } from "../store/workbench";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

export type FileTreeAction = {
  onOpen: (path: string) => void;
  onReveal?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onCreate?: (path: string, kind: "file" | "dir") => void;
  onRename?: (from: string) => void;
  onDelete?: (path: string) => void;
};

export function FileTree({
  nodes,
  active,
  onOpen,
  onReveal,
  onCopyPath,
  onCreate,
  onRename,
  onDelete,
  depth = 0,
}: {
  nodes: FsNode[];
  active?: string | null;
  depth?: number;
} & FileTreeAction) {
  const actions: FileTreeAction = { onOpen, onReveal, onCopyPath, onCreate, onRename, onDelete };
  const [menu, setMenu] = useState<{ x: number; y: number; node: FsNode } | null>(null);
  return (
    <div className="file-tree">
      {nodes.map((n) =>
        n.kind === "dir" ? (
          <DirRow
            key={n.path}
            node={n}
            active={active}
            depth={depth}
            actions={actions}
            onMenu={setMenu}
          />
        ) : (
          <FileRow
            key={n.path}
            node={n}
            active={active}
            depth={depth}
            actions={actions}
            onMenu={setMenu}
          />
        ),
      )}
      {depth === 0 && menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={fileMenu(menu.node, actions)}
        />
      )}
    </div>
  );
}

function fileMenu(node: FsNode, actions: FileTreeAction): ContextMenuItem[] {
  const dir = node.kind === "dir" ? node.path : node.path.split("/").slice(0, -1).join("/");
  const items: ContextMenuItem[] = [];
  if (node.kind === "file") {
    items.push({
      id: "open",
      label: "打开",
      onSelect: () => actions.onOpen(node.path),
    });
  }
  if (actions.onReveal) {
    items.push({
      id: "reveal",
      label: "在资源管理器中显示",
      onSelect: () => actions.onReveal?.(node.path),
    });
  }
  if (actions.onCopyPath) {
    items.push({
      id: "copy",
      label: "复制相对路径",
      onSelect: () => actions.onCopyPath?.(node.path),
    });
  }
  if (actions.onCreate) {
    items.push(
      {
        id: "new-file",
        label: "在此新建文件",
        onSelect: () => actions.onCreate?.(dir ? `${dir}/` : "", "file"),
      },
      {
        id: "new-dir",
        label: "在此新建文件夹",
        onSelect: () => actions.onCreate?.(dir ? `${dir}/` : "", "dir"),
      },
    );
  }
  if (actions.onRename) {
    items.push({ id: "rename", label: "重命名", onSelect: () => actions.onRename?.(node.path) });
  }
  if (actions.onDelete) {
    items.push({
      id: "delete",
      label: "删除",
      danger: true,
      onSelect: () => actions.onDelete?.(node.path),
    });
  }
  return items;
}

function DirRow({
  node,
  active,
  depth,
  actions,
  onMenu,
}: {
  node: FsNode;
  active?: string | null;
  depth: number;
  actions: FileTreeAction;
  onMenu: (menu: { x: number; y: number; node: FsNode }) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  return (
    <div>
      <button
        type="button"
        className="file-row dir"
        style={{ paddingLeft: 12 + depth * 11 }}
        onClick={() => setOpen((v) => !v)}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY, node });
        }}
      >
        <span className="ftype dir">
          {open ? <CaretDown size={10} weight="fill" /> : <CaretRight size={10} weight="fill" />}
        </span>
        <span className="fname">{node.name}</span>
        {node.gitStatus && <span className={`gst ${node.gitStatus}`}>{node.gitStatus}</span>}
      </button>
      {open && node.children && node.children.length > 0 && (
        <NestedTree
          nodes={node.children}
          active={active}
          depth={depth + 1}
          actions={actions}
          onMenu={onMenu}
        />
      )}
    </div>
  );
}

function NestedTree({
  nodes,
  active,
  depth,
  actions,
  onMenu,
}: {
  nodes: FsNode[];
  active?: string | null;
  depth: number;
  actions: FileTreeAction;
  onMenu: (menu: { x: number; y: number; node: FsNode }) => void;
}) {
  return (
    <>
      {nodes.map((n) =>
        n.kind === "dir" ? (
          <DirRow
            key={n.path}
            node={n}
            active={active}
            depth={depth}
            actions={actions}
            onMenu={onMenu}
          />
        ) : (
          <FileRow
            key={n.path}
            node={n}
            active={active}
            depth={depth}
            actions={actions}
            onMenu={onMenu}
          />
        ),
      )}
    </>
  );
}

function FileRow({
  node,
  active,
  depth,
  actions,
  onMenu,
}: {
  node: FsNode;
  active?: string | null;
  depth: number;
  actions: FileTreeAction;
  onMenu: (menu: { x: number; y: number; node: FsNode }) => void;
}) {
  const icon = iconForPath(node.name);
  return (
    <button
      type="button"
      className={`file-row ${active === node.path ? "active" : ""}`}
      style={{ paddingLeft: 12 + depth * 11 }}
      onClick={() => actions.onOpen(node.path)}
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY, node });
      }}
      title={node.path}
    >
      <span className={`ftype ${icon.replace(/[^a-z]/gi, "") || "plain"}`}>{icon}</span>
      <span className="fname">{node.name}</span>
      {node.gitStatus && <span className={`gst ${node.gitStatus}`}>{node.gitStatus}</span>}
    </button>
  );
}

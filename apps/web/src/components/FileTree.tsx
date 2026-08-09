import { useState } from "react";
import type { FsNode } from "../host/client";
import { iconForPath } from "../store/workbench";

export function FileTree({
  nodes,
  active,
  onOpen,
  depth = 0,
}: {
  nodes: FsNode[];
  active?: string | null;
  onOpen: (path: string) => void;
  depth?: number;
}) {
  return (
    <div className="file-tree">
      {nodes.map((n) =>
        n.kind === "dir" ? (
          <DirRow key={n.path} node={n} active={active} onOpen={onOpen} depth={depth} />
        ) : (
          <FileRow key={n.path} node={n} active={active} onOpen={onOpen} depth={depth} />
        ),
      )}
    </div>
  );
}

function DirRow({
  node,
  active,
  onOpen,
  depth,
}: {
  node: FsNode;
  active?: string | null;
  onOpen: (path: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  return (
    <div>
      <button
        type="button"
        className="file-row dir"
        style={{ paddingLeft: 12 + depth * 13 }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ftype dir">{open ? "▾" : "▸"}</span>
        <span className="fname">{node.name}</span>
        {node.gitStatus && <span className={`gst ${node.gitStatus}`}>{node.gitStatus}</span>}
      </button>
      {open && node.children && node.children.length > 0 && (
        <FileTree nodes={node.children} active={active} onOpen={onOpen} depth={depth + 1} />
      )}
    </div>
  );
}

function FileRow({
  node,
  active,
  onOpen,
  depth,
}: {
  node: FsNode;
  active?: string | null;
  onOpen: (path: string) => void;
  depth: number;
}) {
  const icon = iconForPath(node.name);
  return (
    <button
      type="button"
      className={`file-row ${active === node.path ? "active" : ""}`}
      style={{ paddingLeft: 12 + depth * 13 }}
      onClick={() => onOpen(node.path)}
      title={node.path}
    >
      <span className={`ftype ${icon.replace(/[^a-z]/gi, "") || "plain"}`}>{icon}</span>
      <span className="fname">{node.name}</span>
      {node.gitStatus && <span className={`gst ${node.gitStatus}`}>{node.gitStatus}</span>}
    </button>
  );
}

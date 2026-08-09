import type { FsNode } from "../host/client";

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
      {nodes.map((n) => (
        <div key={n.path}>
          <div
            className={`file-row ${active === n.path ? "active" : ""}`}
            style={{ paddingLeft: 12 + depth * 12 }}
            onClick={() => n.kind === "file" && onOpen(n.path)}
          >
            <span className={`ftype ${n.kind}`}>{n.kind === "dir" ? "▸" : icon(n.name)}</span>
            <span className="fname">{n.name}</span>
            {n.gitStatus && <span className={`gst ${n.gitStatus}`}>{n.gitStatus}</span>}
          </div>
          {n.children && n.children.length > 0 && (
            <FileTree nodes={n.children} active={active} onOpen={onOpen} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}

function icon(name: string) {
  if (name.endsWith(".py")) return "py";
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "ts";
  if (name.endsWith(".md")) return "md";
  if (name.endsWith(".json") || name.endsWith(".yml") || name.endsWith(".yaml")) return "{}";
  if (name.endsWith(".csv") || name.endsWith(".xlsx")) return "xls";
  return "·";
}

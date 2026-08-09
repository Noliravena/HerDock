import type { PathRule } from "@her-dock/agent-protocol";

/** Normalize to forward slashes without leading ./ */
export function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

/**
 * Minimal glob: `*` (segment), `**` (any depth), exact match.
 * Sufficient for workspace policy; not a full gitignore engine.
 */
export function matchGlob(pattern: string, path: string): boolean {
  const pat = normalizeRelPath(pattern);
  const target = normalizeRelPath(path);

  if (pat === "**/*" || pat === "**") return true;

  const esc = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  let re = "";
  for (let i = 0; i < pat.length; ) {
    if (pat[i] === "*" && pat[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (pat[i] === "/") i += 1;
      continue;
    }
    if (pat[i] === "*") {
      re += "[^/]*";
      i += 1;
      continue;
    }
    re += esc(pat[i]!);
    i += 1;
  }
  return new RegExp(`^${re}$`).test(target);
}

export function matchesAnyRule(path: string, rules: PathRule[]): boolean {
  const target = normalizeRelPath(path);
  return rules.some((r) => {
    if (r.absolute) {
      // Absolute rules compared as normalized full paths.
      return matchGlob(r.pattern.replace(/\\/g, "/"), target);
    }
    return matchGlob(r.pattern, target);
  });
}

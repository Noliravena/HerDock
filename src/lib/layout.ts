/** Chrome layout defaults — sidebar wide enough for workspace cards + thread
 * rows (title, stamp, hover actions) without truncation. */
export const LEFT_DEFAULT = 320;
export const LEFT_MIN = 216;
export const LEFT_MAX = 480;
export const LEFT_RAIL = 52;

export const BOTTOM_DEFAULT = 220;
export const BOTTOM_MIN = 120;
export const BOTTOM_MAX = 520;

export const FILES_DEFAULT = 264;
export const FILES_MIN = 200;
export const FILES_MAX = 420;

export const DESIGN_SESSION_DEFAULT = 300;
export const DESIGN_SESSION_MIN = 220;
export const DESIGN_SESSION_MAX = 420;
export const DESIGN_INSPECTOR_DEFAULT = 274;
export const DESIGN_INSPECTOR_MIN = 220;
export const DESIGN_INSPECTOR_MAX = 400;

/** Centre workbench must stay usable while the rails grow. */
export const CENTER_MIN = 420;

/** v2 resets saved widths once so the roomier sidebar default lands for
 * existing installs too; later tweaks stay user-owned. */
const STORAGE_KEY = "herdock.layout.v2";

export type LayoutPrefs = {
  leftOpen: boolean;
  leftWidth: number;
  bottomOpen: boolean;
  bottomHeight: number;
  filesOpen: boolean;
  filesWidth: number;
  designSessionWidth: number;
  designInspectorWidth: number;
};

const DEFAULTS: LayoutPrefs = {
  leftOpen: true,
  leftWidth: LEFT_DEFAULT,
  bottomOpen: false,
  bottomHeight: BOTTOM_DEFAULT,
  filesOpen: false,
  filesWidth: FILES_DEFAULT,
  designSessionWidth: DESIGN_SESSION_DEFAULT,
  designInspectorWidth: DESIGN_INSPECTOR_DEFAULT,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function loadLayoutPrefs(): LayoutPrefs {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      leftOpen: parsed.leftOpen !== false,
      leftWidth: clamp(Number(parsed.leftWidth), LEFT_MIN, LEFT_MAX),
      bottomOpen: parsed.bottomOpen === true,
      bottomHeight: clamp(Number(parsed.bottomHeight) || BOTTOM_DEFAULT, BOTTOM_MIN, BOTTOM_MAX),
      filesOpen: parsed.filesOpen === true,
      filesWidth: clamp(Number(parsed.filesWidth) || FILES_DEFAULT, FILES_MIN, FILES_MAX),
      designSessionWidth: clamp(
        Number(parsed.designSessionWidth) || DESIGN_SESSION_DEFAULT,
        DESIGN_SESSION_MIN,
        DESIGN_SESSION_MAX,
      ),
      designInspectorWidth: clamp(
        Number(parsed.designInspectorWidth) || DESIGN_INSPECTOR_DEFAULT,
        DESIGN_INSPECTOR_MIN,
        DESIGN_INSPECTOR_MAX,
      ),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLayoutPrefs(prefs: LayoutPrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode — layout still works for the session */
  }
}

export function clampLeftWidth(width: number, viewport: number, rightTaken: number): number {
  const max = Math.min(LEFT_MAX, Math.max(LEFT_MIN, viewport - rightTaken - CENTER_MIN));
  return clamp(width, LEFT_MIN, max);
}

export function leftTaken(leftOpen: boolean, leftWidth: number): number {
  return leftOpen ? leftWidth : LEFT_RAIL;
}

export function clampBottomHeight(height: number, viewport: number): number {
  const max = Math.min(BOTTOM_MAX, Math.max(BOTTOM_MIN, Math.round(viewport * 0.55)));
  return clamp(height, BOTTOM_MIN, max);
}

export function clampFilesWidth(width: number): number {
  return clamp(width, FILES_MIN, FILES_MAX);
}

export function clampDesignSessionWidth(width: number): number {
  return clamp(width, DESIGN_SESSION_MIN, DESIGN_SESSION_MAX);
}

export function clampDesignInspectorWidth(width: number): number {
  return clamp(width, DESIGN_INSPECTOR_MIN, DESIGN_INSPECTOR_MAX);
}

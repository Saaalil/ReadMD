export type ThemePref = "dark" | "light" | "system";
export type ViewMode = "reader" | "split" | "editor";

export interface RecentFile {
  path: string;
  name: string;
  at: number;
}

export interface Prefs {
  theme: ThemePref;
  outline: boolean;
  zoom: number;
  mode: ViewMode;
  proofread: boolean;
  vim: boolean;
  typewriter: boolean;
  focus: boolean;
  recents: RecentFile[];
  lastFile: RecentFile | null;
  lastOpenDir: string | null;
  lastSaveDir: string | null;
  lastExportDir: string | null;
  onboarded: boolean;
}

const KEY = "readmd.prefs.v1";
const MAX_RECENTS = 24;

const defaults: Prefs = {
  theme: "dark",
  outline: true,
  zoom: 100,
  mode: "split",
  proofread: true,
  vim: false,
  typewriter: false,
  focus: false,
  recents: [],
  lastFile: null,
  lastOpenDir: null,
  lastSaveDir: null,
  lastExportDir: null,
  onboarded: false
};

let systemListener: ((event: MediaQueryListEvent) => void) | null = null;

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults, recents: [] };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: parsed.theme === "light" || parsed.theme === "system" || parsed.theme === "dark" ? parsed.theme : defaults.theme,
      outline: typeof parsed.outline === "boolean" ? parsed.outline : defaults.outline,
      zoom: clampZoom(typeof parsed.zoom === "number" ? parsed.zoom : defaults.zoom),
      mode: parsed.mode === "reader" || parsed.mode === "split" || parsed.mode === "editor" ? parsed.mode : defaults.mode,
      proofread: typeof parsed.proofread === "boolean" ? parsed.proofread : defaults.proofread,
      vim: parsed.vim === true,
      typewriter: parsed.typewriter === true,
      focus: parsed.focus === true,
      recents: Array.isArray(parsed.recents) ? parsed.recents.filter(isRecent) : [],
      lastFile: parsed.lastFile && isRecent(parsed.lastFile) ? parsed.lastFile : null,
      lastOpenDir: stringOrNull(parsed.lastOpenDir),
      lastSaveDir: stringOrNull(parsed.lastSaveDir),
      lastExportDir: stringOrNull(parsed.lastExportDir),
      onboarded: parsed.onboarded === true
    };
  } catch {
    return { ...defaults, recents: [] };
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

export function clampZoom(value: number): number {
  return Math.min(160, Math.max(80, Math.round(value / 10) * 10));
}

export function rememberFile(recents: RecentFile[], path: string, name: string): RecentFile[] {
  const next = [{ path, name, at: Date.now() }, ...recents.filter((item) => item.path !== path)];
  return next.slice(0, MAX_RECENTS);
}

export function resolvedTheme(pref: ThemePref): "dark" | "light" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return pref;
}

export function applyTheme(pref: ThemePref): "dark" | "light" {
  const resolved = resolvedTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  const media = window.matchMedia("(prefers-color-scheme: light)");
  if (systemListener) media.removeEventListener("change", systemListener);
  if (pref === "system") {
    systemListener = () => applyTheme("system");
    media.addEventListener("change", systemListener);
  } else {
    systemListener = null;
  }

  return resolved;
}

function isRecent(value: unknown): value is RecentFile {
  if (!value || typeof value !== "object") return false;
  const item = value as RecentFile;
  return typeof item.path === "string" && typeof item.name === "string" && typeof item.at === "number";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

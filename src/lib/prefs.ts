/**
 * This browser's own preferences: how wide the page is, whether the side
 * panel is open and on which tab. Light conveniences, so they live in
 * localStorage and fall back to defaults if storage is refused.
 */

export type PageWidth = "narrow" | "wide" | "full";
export const WIDTHS: { value: PageWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];

const KEY = "storyboard:prefs";

export interface Prefs {
  width: PageWidth;
  panelOpen: boolean;
  panelTab: "status" | "oracles" | "contents" | "commands";
}

export const DEFAULT_PREFS: Prefs = { width: "wide", panelOpen: true, panelTab: "status" };

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    const width = WIDTHS.some((w) => w.value === raw.width) ? raw.width! : DEFAULT_PREFS.width;
    const panelTab = ["status", "oracles", "contents", "commands"].includes(raw.panelTab ?? "") ? raw.panelTab! : DEFAULT_PREFS.panelTab;
    return { width, panelOpen: typeof raw.panelOpen === "boolean" ? raw.panelOpen : DEFAULT_PREFS.panelOpen, panelTab };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* a private window may refuse; the defaults come back next time */
  }
}

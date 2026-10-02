/**
 * This browser's own preferences: how wide the page is, whether the side
 * panel is open, how wide, and on which tab. Light conveniences, so they live in
 * localStorage and fall back to defaults if storage is refused.
 */

export type PageWidth = "narrow" | "wide" | "full";
export const WIDTHS: { value: PageWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];

const KEY = "sekwe:prefs";

/** The side panel's width in pixels: dragged by its edge, kept between these. */
export const PANEL_DEFAULT = 352;
export const PANEL_MIN = 240;
export const PANEL_MAX = 900;

/**
 * A width the panel may have in a window this wide: at least PANEL_MIN, and
 * never so wide that the page is left less than 40% of the window.
 */
export function clampPanelWidth(px: number, windowWidth: number): number {
  const most = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(windowWidth * 0.6)));
  return Math.round(Math.min(most, Math.max(PANEL_MIN, Number.isFinite(px) ? px : PANEL_DEFAULT)));
}

export interface Prefs {
  width: PageWidth;
  panelWidth: number;
  panelOpen: boolean;
  panelTab: "status" | "oracles" | "contents" | "commands";
}

export const DEFAULT_PREFS: Prefs = { width: "wide", panelWidth: PANEL_DEFAULT, panelOpen: true, panelTab: "status" };

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    const width = WIDTHS.some((w) => w.value === raw.width) ? raw.width! : DEFAULT_PREFS.width;
    const panelTab = ["status", "oracles", "contents", "commands"].includes(raw.panelTab ?? "") ? raw.panelTab! : DEFAULT_PREFS.panelTab;
    const panelWidth = typeof raw.panelWidth === "number" && Number.isFinite(raw.panelWidth) ? raw.panelWidth : DEFAULT_PREFS.panelWidth;
    return { width, panelWidth, panelOpen: typeof raw.panelOpen === "boolean" ? raw.panelOpen : DEFAULT_PREFS.panelOpen, panelTab };
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

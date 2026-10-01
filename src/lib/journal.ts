/**
 * A journal: one campaign's writing. The document is Tiptap's JSON, kept as it
 * is, so nothing is lost between the editor and storage.
 *
 * This is the shape stored in the browser. A journal file (open/save on disk)
 * comes in a later stage and will wrap this, under its own format name.
 */

export const JOURNAL_FORMAT = "storyboard-journal";
export const JOURNAL_FORMAT_VERSION = 1;
export const TITLE_MAX = 120;
export const UNTITLED = "Untitled journal";

/** Tiptap / ProseMirror document JSON. Opaque here on purpose. */
export interface DocJSON {
  type: "doc";
  content?: unknown[];
  [key: string]: unknown;
}

export interface Journal {
  format: typeof JOURNAL_FORMAT;
  formatVersion: number;
  id: string;
  title: string;
  created: string;
  modified: string;
  doc: DocJSON;
  /**
   * A copy of every oracle version this journal has rolled, keyed
   * "<oracle id>@<version>" (see roller.ts), so it re-rolls without the library.
   */
  oracles?: Record<string, Record<string, unknown>>;
}

/** What the journal menu needs, without carrying every document around. */
export interface JournalSummary {
  id: string;
  title: string;
  modified: string;
}

export const EMPTY_DOC: DocJSON = { type: "doc", content: [{ type: "paragraph" }] };

export function newId(): string {
  return crypto.randomUUID();
}

export function newJournal(title = UNTITLED, now = new Date()): Journal {
  const at = now.toISOString();
  return {
    format: JOURNAL_FORMAT,
    formatVersion: JOURNAL_FORMAT_VERSION,
    id: newId(),
    title: cleanTitle(title),
    created: at,
    modified: at,
    doc: structuredClone(EMPTY_DOC),
  };
}

/** One line, trimmed, capped; an empty title reads as "Untitled journal". */
export function cleanTitle(raw: string): string {
  const one = raw.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX).trim();
  return one || UNTITLED;
}

export function summarize(j: Journal): JournalSummary {
  return { id: j.id, title: j.title, modified: j.modified };
}

/** Newest first; ties broken by title, so the menu never shuffles. */
export function byRecent(a: JournalSummary, b: JournalSummary): number {
  return b.modified.localeCompare(a.modified) || a.title.localeCompare(b.title);
}

/**
 * A name for a new journal that no other journal already has:
 * "Untitled journal", then "Untitled journal 2", and so on.
 */
export function freshTitle(taken: readonly string[], base = UNTITLED): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * Checks a stored journal well enough to open it. Lenient: a journal written by
 * a newer Storyboard still opens, keeping what this version does not know.
 */
export function isJournal(v: unknown): v is Journal {
  if (typeof v !== "object" || v === null) return false;
  const j = v as Record<string, unknown>;
  return (
    j.format === JOURNAL_FORMAT &&
    typeof j.id === "string" &&
    typeof j.title === "string" &&
    typeof j.modified === "string" &&
    typeof j.doc === "object" &&
    j.doc !== null &&
    (j.doc as Record<string, unknown>).type === "doc"
  );
}

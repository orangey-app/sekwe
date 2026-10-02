/**
 * The oracles Storyboard can roll: the user's Orangey library, read where
 * Orangey keeps it, with Orangey's own code (vendor/orangey/src/storage).
 *
 * Storyboard only reads. Orangey stays the one app that writes the library,
 * so nothing here creates, renames or saves a randomizer.
 */

import { seedHash64 } from "../../vendor/orangey/src/core/rng.ts";
import { tryParse } from "../../vendor/orangey/src/core/dice/grammar.ts";
import { isBoard, type Randomizer, type Rollable } from "../../vendor/orangey/src/model/randomizer.ts";
import { LibraryService, type LibraryBackend } from "../../vendor/orangey/src/storage/library.ts";
import type { LibraryLocation } from "../../vendor/orangey/src/storage/locate.ts";
import type { PackManifest } from "../../vendor/orangey/src/model/pack.ts";
import type { PackCredit } from "./rolls.ts";

export interface Oracle {
  id: string;
  name: string;
  /** The folder it sits in, "/"-separated; "" at the top of the library. */
  folder: string;
  randomizer: Rollable;
  /** Only in the journal's copy because a chosen folder's outcome goes to it; kept out of menus. */
  linked?: boolean;
  /** The pack it came in, when it did: for its credit, and whether a journal may keep a copy. */
  pack?: OraclePack;
}

/** An installed pack's details, as Storyboard keeps them. */
export interface OraclePack extends PackCredit {
  id: string;
  /** False when its author asks apps not to keep copies of it in journals. */
  allowSnapshots?: false;
}

/** The pack's details without what only Orangey needs (where it was installed from). */
export function packOf(m: PackManifest | null | undefined): OraclePack | undefined {
  if (!m) return undefined;
  const p: OraclePack = { id: m.id, title: m.title, author: m.author, version: m.version };
  if (m.licence) p.licence = m.licence;
  if (m.homepage) p.homepage = m.homepage;
  if (m.allowSnapshots === false) p.allowSnapshots = false;
  return p;
}

/** Whether a journal may keep a copy of this oracle (its pack's author decides). */
export const mayKeep = (o: { pack?: OraclePack } | null | undefined): boolean => o?.pack?.allowSnapshots !== false;

/** "Delve by A. Writer · v1.0 · CC BY 4.0". */
export const creditOf = (p: PackCredit): string => [`${p.title} by ${p.author}`, `v${p.version}`, p.licence].filter(Boolean).join(" · ");

export type LibraryStatus =
  /** Not looked for yet. */
  | "idle"
  | "ready"
  /** Found, but with nothing Storyboard can roll in it. */
  | "empty"
  /** Orangey keeps the library in a folder on disk; one click lets Storyboard read it. */
  | "needs-folder"
  /** This page cannot see Orangey's storage at all (opened from disk, or storage refused). */
  | "unavailable";

/** Looks for the library; the app passes Orangey's locateLibrary("read"). */
export type Locate = () => Promise<LibraryLocation>;
/** Asks for the folder again; must run inside a click. */
export type Regrant = () => Promise<LibraryBackend | null>;

/** Boards hold other randomizers and roll one at a time, so they are not oracles here. */
export function rollable(r: Randomizer | null | undefined): r is Rollable {
  return !!r && !isBoard(r);
}

export class OracleLibrary {
  status: LibraryStatus = "idle";
  /** Everything there is to roll: the library here, then the journal's copy of what the library lacks. */
  oracles: Oracle[] = [];
  /** The library here, read from Orangey. */
  live: Oracle[] = [];
  /** The open journal's copy (copy.ts). */
  kept: Oracle[] = [];
  #byId = new Map<string, Oracle>();
  #service: LibraryService | null = null;
  #locate: Locate;
  #regrant: Regrant;
  #listeners = new Set<() => void>();

  constructor(locate: Locate, regrant: Regrant) {
    this.#locate = locate;
    this.#regrant = regrant;
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(): void {
    for (const fn of this.#listeners) fn();
  }

  /** Finds the library and reads it. Safe to call again: it starts over. */
  async load(): Promise<void> {
    let found: LibraryLocation;
    try {
      found = await this.#locate();
    } catch {
      found = { backend: null, folder: null };
    }
    if (found.folder === "ask") {
      // The browser-storage library Orangey would show meanwhile is not the
      // user's real one, so Storyboard waits for the folder instead.
      this.#service = null;
      this.#index([]);
      this.status = "needs-folder";
      this.#emit();
      return;
    }
    if (!found.backend) {
      this.#service = null;
      this.#index([]);
      this.status = "unavailable";
      this.#emit();
      return;
    }
    this.#service = new LibraryService(found.backend);
    await this.refresh();
  }

  /** "Open my Orangey folder": call from the click itself. */
  async openFolder(): Promise<boolean> {
    const backend = await this.#regrant().catch(() => null);
    if (!backend) return false;
    this.#service = new LibraryService(backend);
    await this.refresh();
    return true;
  }

  /** Reads the library again, for when Orangey may have changed it. */
  async refresh(): Promise<void> {
    if (!this.#service) return;
    await this.#service.refresh();
    const oracles: Oracle[] = [];
    for (const node of this.#service.files()) {
      const r = node.randomizer;
      if (!rollable(r)) continue;
      const slash = node.path.lastIndexOf("/");
      const pack = packOf(this.#service.packOf(node.path)?.pack);
      oracles.push({ id: r.id, name: r.name, folder: slash < 0 ? "" : node.path.slice(0, slash), randomizer: r, ...(pack ? { pack } : {}) });
    }
    this.#index(oracles);
    this.status = oracles.length ? "ready" : "empty";
    this.#emit();
  }

  #index(live: Oracle[]): void {
    this.live = live;
    this.#merge();
  }

  /** The open journal's copy; the library here wins wherever both have an oracle. */
  setKept(kept: Oracle[]): void {
    this.kept = kept;
    this.#merge();
    this.#emit();
  }

  #merge(): void {
    this.#byId = new Map();
    // First one wins on a duplicated id, as in Orangey.
    for (const o of this.live) if (!this.#byId.has(o.id)) this.#byId.set(o.id, o);
    const extra = this.kept.filter((o) => !this.#byId.has(o.id));
    for (const o of extra) this.#byId.set(o.id, o);
    this.oracles = [...this.live, ...extra];
  }

  /** How many oracles come from the journal's copy rather than the library here. */
  get fromCopy(): number {
    return this.oracles.length - this.live.length;
  }

  byId(id: string): Oracle | null {
    return this.#byId.get(id) ?? null;
  }

  /** For tests: a library from oracles directly. */
  static of(oracles: Oracle[]): OracleLibrary {
    const lib = new OracleLibrary(async () => ({ backend: null, folder: null }), async () => null);
    lib.#index(oracles);
    lib.status = oracles.length ? "ready" : "empty";
    return lib;
  }
}

// --- finding an oracle as you type ------------------------------------------------

/** Lower case, accents off, so "Ändern" is found by "andern". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export interface Match {
  oracle: Oracle;
  score: number;
}

/** What, besides the typed words, decides the order of the menu. */
export interface SearchHints {
  /** Oracle ids, most recently rolled first. */
  recent?: readonly string[];
  /** The words just written before the cursor. */
  context?: string;
}


/** The last dozen words before the cursor, short ones left out ("the", "a"). */
export function contextWords(text: string): Set<string> {
  return new Set(words(text).slice(-12).filter((w) => w.length >= 3).map((w) => w.replace(/s$/, "")));
}

/**
 * Every word typed must begin some word of the oracle's name or folder:
 * "npc mot" finds "NPC Motivation", "char goal" finds "Character/Goal".
 * Name matches outrank folder matches, a match at the start of the name ranks
 * higher, and shorter names win ties, so the obvious answer comes first.
 * Oracles rolled recently, and oracles named by a word just written, move up.
 * With nothing typed: recent ones first, then the rest by name.
 */
export function searchOracles(oracles: readonly Oracle[], query: string, limit = 8, hints: SearchHints = {}): Match[] {
  const typed = words(query);
  const recentRank = new Map((hints.recent ?? []).map((id, i) => [id, i] as const));
  const ctx = hints.context ? contextWords(hints.context) : new Set<string>();
  const nameWords = (o: Oracle) => words(o.name).map((w) => w.replace(/s$/, ""));
  // Recency outranks context, and both only reorder: they never add a match.
  const ctxBoost = (o: Oracle) => {
    let b = 0;
    const r = recentRank.get(o.id);
    if (r !== undefined) b += 6 - Math.min(5, r);
    for (const w of nameWords(o)) if (w.length >= 3 && ctx.has(w)) b += 3;
    return b;
  };
  if (typed.length === 0) {
    return oracles
      .map((oracle) => ({ oracle, score: ctxBoost(oracle) }))
      .sort((a, b) => b.score - a.score || a.oracle.name.localeCompare(b.oracle.name))
      .slice(0, limit);
  }
  const out: Match[] = [];
  for (const oracle of oracles) {
    const name = words(oracle.name);
    const folder = words(oracle.folder);
    let score = 0;
    let ok = true;
    for (const t of typed) {
      const inName = name.findIndex((w) => w.startsWith(t));
      if (inName >= 0) {
        score += inName === 0 ? 12 : 8;
        if (name[inName] === t) score += 2;
        continue;
      }
      if (folder.some((w) => w.startsWith(t))) {
        score += 3;
        continue;
      }
      ok = false;
      break;
    }
    if (!ok) continue;
    score += ctxBoost(oracle);
    score -= oracle.name.length / 100;
    out.push({ oracle, score });
  }
  return out.sort((a, b) => b.score - a.score || a.oracle.name.localeCompare(b.oracle.name)).slice(0, limit);
}

/**
 * Oracles inside any of these folders (or one of their subfolders); all of
 * them when none are chosen. Those only kept for a chain stay out.
 */
export function inFolders(oracles: readonly Oracle[], folders: readonly string[]): Oracle[] {
  const shown = oracles.filter((o) => !o.linked);
  if (folders.length === 0) return shown;
  return shown.filter((o) => folders.some((f) => o.folder === f || o.folder.startsWith(`${f}/`)));
}

/** Every folder that holds an oracle, with its parents: "A", "A/B". Sorted. */
export function folderPaths(oracles: readonly Oracle[]): string[] {
  const out = new Set<string>();
  for (const o of oracles) {
    if (!o.folder || o.linked) continue;
    const parts = o.folder.split("/");
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * For Tab in the slash menu, as at a command prompt: the start that every
 * name shares, in the first name's own capitals. The menu fills that in first,
 * and cycles through whole names after.
 */
export function sharedPrefix(names: readonly string[]): string {
  if (names.length === 0) return "";
  const lower = names.map((n) => n.toLowerCase());
  let k = lower[0].length;
  for (const n of lower) {
    let i = 0;
    while (i < k && i < n.length && lower[0][i] === n[i]) i++;
    k = i;
  }
  return names[0].slice(0, k);
}

/** "2d6", "d100", "4dF+1": something to roll as dice rather than look up. */
export function diceExpression(query: string): string | null {
  const q = query.trim();
  if (!/^\d*d(\d|%|f)/i.test(q)) return null;
  return tryParse(q).ok ? q : null;
}

// --- versions ----------------------------------------------------------------------

/**
 * What decides how a randomizer rolls, and nothing else: changing a colour, a
 * picture, the description or the name does not change it.
 */
function rollingShape(r: Rollable): unknown {
  switch (r.type) {
    case "list":
      return {
        t: r.type,
        items: r.items.map((i) => [i.label, i.weight, i.disabled ?? false, i.goesTo ?? null]),
        bag: r.withoutReplacement ?? false,
        offer: r.offer ?? null,
      };
    case "dice":
      return { t: r.type, e: r.expression };
    case "coin":
      return { t: r.type, f: r.faces };
    case "number":
      return { t: r.type, min: r.min, max: r.max, i: r.integer, x: r.inclusiveMax, n: r.count, u: r.unique };
    case "inkblot":
      return { t: r.type };
  }
}

/** A short version id: the same outcomes and weights give the same id. */
export function versionOf(r: Rollable): string {
  const text = JSON.stringify(rollingShape(r));
  const [a, b] = seedHash64(text);
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

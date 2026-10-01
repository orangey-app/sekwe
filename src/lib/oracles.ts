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

export interface Oracle {
  id: string;
  name: string;
  /** The folder it sits in, "/"-separated; "" at the top of the library. */
  folder: string;
  randomizer: Rollable;
}

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
  oracles: Oracle[] = [];
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
      oracles.push({ id: r.id, name: r.name, folder: slash < 0 ? "" : node.path.slice(0, slash), randomizer: r });
    }
    this.#index(oracles);
    this.status = oracles.length ? "ready" : "empty";
    this.#emit();
  }

  #index(oracles: Oracle[]): void {
    this.oracles = oracles;
    this.#byId = new Map();
    // First one wins on a duplicated id, as in Orangey.
    for (const o of oracles) if (!this.#byId.has(o.id)) this.#byId.set(o.id, o);
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

/**
 * Every word typed must begin some word of the oracle's name or folder:
 * "npc mot" finds "NPC Motivation", "char goal" finds "Character/Goal".
 * Name matches outrank folder matches, a match at the start of the name ranks
 * higher, and shorter names win ties, so the obvious answer comes first.
 */
export function searchOracles(oracles: readonly Oracle[], query: string, limit = 8): Match[] {
  const typed = words(query);
  if (typed.length === 0) {
    return [...oracles].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit).map((oracle) => ({ oracle, score: 0 }));
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
    score -= oracle.name.length / 100;
    out.push({ oracle, score });
  }
  return out.sort((a, b) => b.score - a.score || a.oracle.name.localeCompare(b.oracle.name)).slice(0, limit);
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

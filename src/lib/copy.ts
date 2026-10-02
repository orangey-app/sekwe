/**
 * The journal's own copy of the Orangey folders it rolls from, so it can be
 * carried to a computer without Orangey (on a USB stick, say) and still roll.
 *
 * The rules:
 * - No folders chosen means no copy: the journal keeps only the snapshots of
 *   what it has rolled, as before. (Except on a computer whose library is
 *   empty or unreadable: there the copy is kept, as it is all there is.)
 * - Only the chosen folders are copied, plus whatever their outcomes "go to"
 *   or refer to (`{@Weather}`) elsewhere, so a chain does not stop on the other computer. Those extra
 *   ones are marked `linked` and stay out of the menus.
 * - The live library wins. When a chosen folder is in the library here, the
 *   copy of that folder is replaced by what the library holds now (an edit or
 *   a deletion in Orangey carries over). A chosen folder the library here does
 *   not have is kept as it was, so opening the journal on a computer with a
 *   different library never empties it.
 */

import { packRandomizer, unpackRandomizer } from "../../vendor/orangey/src/model/link.ts";
import type { Rollable } from "../../vendor/orangey/src/model/randomizer.ts";
import { refIdsOf, refsIn } from "../../vendor/orangey/src/model/refs.ts";
import { inFolders, mayKeep, rollable, type Oracle, type OraclePack } from "./oracles.ts";

export interface CopiedOracle {
  id: string;
  name: string;
  folder: string;
  /** Only here because an outcome in a chosen folder goes to it. */
  linked?: true;
  /** The randomizer as Orangey packs it for a link (no pictures, no timestamps). */
  packed: Record<string, unknown>;
  /** Its pack's credit, so the credit shows on a computer without the pack. */
  pack?: OraclePack;
}

export interface LibraryCopy {
  /** When the copy last changed. */
  saved: string;
  oracles: CopiedOracle[];
}

const inside = (folder: string, f: string) => folder === f || folder.startsWith(`${f}/`);

function copied(o: Oracle, linked: boolean): CopiedOracle {
  const c: CopiedOracle = { id: o.id, name: o.name, folder: o.folder, packed: packRandomizer(o.randomizer) };
  if (linked) c.linked = true;
  if (o.pack) c.pack = o.pack;
  return c;
}

/** The randomizers an outcome of r goes to, or refers to with `{@…}`. */
function targets(r: Rollable): string[] {
  if (r.type !== "list") return [];
  return [...r.items.flatMap((i) => (i.goesTo ? [i.goesTo] : [])), ...refIdsOf(r)];
}

function targetsOfPacked(p: Record<string, unknown>): string[] {
  const items = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
  return items.flatMap((i) => [
    ...(typeof i?.goesTo === "string" ? [i.goesTo] : []),
    ...[...refsIn(typeof i?.label === "string" ? i.label : ""), ...refsIn(typeof i?.description === "string" ? i.description : "")].flatMap((ref) => (ref.id ? [ref.id] : [])),
  ]);
}

/**
 * The copy a journal should keep, given the library here, the chosen folders
 * and the copy it had. Returns `previous` itself when nothing changed, so the
 * journal is not re-saved for nothing; null when there should be no copy.
 */
export function keepCopy(live: readonly Oracle[], folders: readonly string[], previous: LibraryCopy | null | undefined, now = new Date()): LibraryCopy | null {
  // Choosing no folders drops the copy (option a), but not while the library
  // here has nothing to roll: there the copy is all the journal has.
  if (folders.length === 0) return live.length || !previous ? null : previous;
  const liveById = new Map<string, Oracle>();
  // A pack whose author asks for no copies in journals is left out, here and below.
  for (const o of live) if (!liveById.has(o.id) && mayKeep(o)) liveById.set(o.id, o);
  const keepable = [...liveById.values()];
  const inLibrary = new Set(live.map((o) => o.id));
  const prev = previous?.oracles ?? [];
  const prevById = new Map(prev.map((c) => [c.id, c] as const));

  // A chosen folder counts as "here" when the library has anything in it.
  const here = folders.filter((f) => live.some((o) => inside(o.folder, f)));
  const main = new Map<string, CopiedOracle>();
  // (inFolders with no folders means every folder, so it is not asked then.)
  for (const o of here.length ? inFolders(keepable, here) : []) if (!main.has(o.id)) main.set(o.id, copied(o, false));
  for (const c of prev) {
    if (c.linked || main.has(c.id) || !mayKeep(c)) continue;
    const chosen = folders.some((f) => inside(c.folder, f));
    const replaced = here.some((f) => inside(c.folder, f));
    if (chosen && !replaced) main.set(c.id, c);
  }

  // Follow "goes to" out of the chosen folders, as far as it leads.
  const out = new Map(main);
  const queue = [...main.values()];
  while (queue.length) {
    const c = queue.shift()!;
    const l = liveById.get(c.id);
    for (const id of l ? targets(l.randomizer) : targetsOfPacked(c.packed)) {
      if (out.has(id)) continue;
      const t = liveById.get(id);
      const before = prevById.get(id);
      // The library's word counts when it has the oracle, even if that word is "no copies".
      const kept = t ? copied(t, true) : before && mayKeep(before) && !inLibrary.has(id) ? { ...before, linked: true as const } : null;
      if (!kept) continue;
      out.set(id, kept);
      queue.push(kept);
    }
  }

  const oracles = [...out.values()].sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (previous && JSON.stringify(oracles) === JSON.stringify(sorted(prev))) return previous;
  return { saved: now.toISOString(), oracles };
}

const sorted = (list: readonly CopiedOracle[]) => [...list].sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

const unpacked = new Map<string, Rollable | null>();

/** The copy as oracles to roll. A damaged entry is left out rather than stopping the rest. */
export function fromCopy(copy: LibraryCopy | null | undefined): Oracle[] {
  const out: Oracle[] = [];
  for (const c of copy?.oracles ?? []) {
    const key = JSON.stringify([c.id, c.packed]);
    let r = unpacked.get(key);
    if (r === undefined) {
      if (unpacked.size > 5000) unpacked.clear();
      try {
        const u = unpackRandomizer({ ...c.packed, id: c.id });
        r = rollable(u) ? u : null;
      } catch {
        r = null;
      }
      unpacked.set(key, r);
    }
    if (r) out.push({ id: c.id, name: c.name, folder: c.folder, randomizer: r, ...(c.linked ? { linked: true } : {}), ...(c.pack ? { pack: c.pack } : {}) });
  }
  return out;
}

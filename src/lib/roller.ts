/**
 * Rolling, for the editor: an oracle from the library, a dice expression, the
 * same chip again, or the oracle a result "goes to".
 *
 * Which randomizer a re-roll uses: the library's current one when the oracle
 * is still there (so an edit made in Orangey counts from the next roll), and
 * otherwise the snapshot the journal keeps of the version last rolled. Every
 * oracle rolled is snapshotted into the journal, so a journal re-rolls on
 * another machine, offline, or after the wheel is deleted.
 *
 * Two kinds of list need more than one step:
 * - a list with `offer` deals several outcomes and the writer picks one, so a
 *   roll of it "starts" and is "finished" with the pick;
 * - a bag (`withoutReplacement`) does not repeat an outcome until it is empty.
 *   What it has given out belongs to the journal (Bags), not the device.
 */

import type { RandomSource } from "../../vendor/orangey/src/core/rng.ts";
import { withoutDrawn, rollableIndices } from "../../vendor/orangey/src/core/weighted.ts";
import { packRandomizer, unpackRandomizer } from "../../vendor/orangey/src/model/link.ts";
import { chosenFromOffer, offerFromList, rollRandomizer, type Outcome } from "../../vendor/orangey/src/model/roll.ts";
import type { RefResolver } from "../../vendor/orangey/src/model/refs.ts";
import type { Randomizer } from "../../vendor/orangey/src/model/randomizer.ts";
import type { ListRandomizer, Rollable } from "../../vendor/orangey/src/model/randomizer.ts";
import { mayKeep, rollable, versionOf, type OracleLibrary } from "./oracles.ts";
import { diceRandomizer, resultFrom, rollOnce, withResult, type PackCredit, type RollRecord, type RollResult, type RollSource } from "./rolls.ts";

/** Where the journal keeps its snapshots; the session provides it. */
export interface Snapshots {
  get(key: string): Record<string, unknown> | undefined;
  put(key: string, packed: Record<string, unknown>): void;
  /** The newest snapshot of an oracle, whatever its version: for a table referred to with `{@…}`. */
  latest?(id: string): Record<string, unknown> | undefined;
}

/** What each bag in the journal has given out, by oracle id, as outcome labels. */
export interface Bags {
  get(id: string): string[];
  set(id: string, labels: string[]): void;
}

export function memoryBags(): Bags & { all: Record<string, string[]> } {
  const all: Record<string, string[]> = {};
  return { all, get: (id) => all[id] ?? [], set: (id, labels) => void (all[id] = labels) };
}

export const snapshotKey = (id: string, version: string) => `${id}@${version}`;

/** A roll that is done, or one waiting for the writer to pick from an offer. */
export type Begun =
  | { kind: "done"; record: RollRecord }
  | { kind: "pick"; name: string; choices: string[]; finish(index: number): RollRecord }
  | { kind: "missing"; name: string };

export class Roller {
  #library: OracleLibrary;
  #snapshots: () => Snapshots;
  #bags: () => Bags;
  #rng: () => RandomSource;
  #now: () => Date;
  /** Told when a bag ran out and was refilled. */
  onRefill: (name: string) => void = () => {};

  constructor(library: OracleLibrary, snapshots: () => Snapshots, rng: () => RandomSource, now = () => new Date(), bags: () => Bags = (() => {
    const b = memoryBags();
    return () => b;
  })()) {
    this.#library = library;
    this.#snapshots = snapshots;
    this.#rng = rng;
    this.#now = now;
    this.#bags = bags;
  }

  #name = (id: string): string | null => this.#library.byId(id)?.name ?? null;

  /**
   * Keeps a copy of this version in the journal, once; not when its pack's
   * author asks apps not to (then a re-roll needs the pack installed).
   */
  #keep(r: Rollable): string {
    const version = versionOf(r);
    if (!mayKeep(this.#library.byId(r.id))) return version;
    const key = snapshotKey(r.id, version);
    const snaps = this.#snapshots();
    if (!snaps.get(key)) snaps.put(key, packRandomizer(r));
    return version;
  }

  /**
   * For `{@references}` in an outcome: the library here (or the journal's
   * copy), else the newest snapshot the journal keeps of that table.
   */
  readonly refs: RefResolver = {
    byId: (id) => this.#library.byId(id)?.randomizer ?? this.#latest(id),
    byName: (name) => {
      const key = name.trim().toLowerCase();
      return this.#library.oracles.filter((o) => o.name.trim().toLowerCase() === key).map((o) => o.randomizer as Randomizer);
    },
  };

  #latest(id: string): Rollable | null {
    const packed = this.#snapshots().latest?.(id);
    if (!packed) return null;
    try {
      const r = unpackRandomizer({ ...packed, id });
      return rollable(r) ? r : null;
    } catch {
      return null;
    }
  }

  /** The randomizer to roll for an oracle: the library's, else the journal's snapshot. */
  resolve(id: string, version?: string): Rollable | null {
    const live = this.#library.byId(id);
    if (live) return live.randomizer;
    if (!version) return null;
    const packed = this.#snapshots().get(snapshotKey(id, version));
    if (!packed) return null;
    try {
      const r = unpackRandomizer({ ...packed, id });
      return rollable(r) ? r : null;
    } catch {
      return null;
    }
  }

  /**
   * A bag's list with what it has given out switched off; refilled first when
   * nothing is left, so a bag never refuses to roll.
   */
  #fromBag(r: ListRandomizer): ListRandomizer {
    const bags = this.#bags();
    let given = bags.get(r.id);
    const isGiven = (label: string) => given.includes(label);
    let items = withoutDrawn(r.items, new Set(r.items.filter((i) => isGiven(i.label)).map((i) => i.id)));
    if (rollableIndices(items).length === 0) {
      given = [];
      bags.set(r.id, given);
      items = r.items;
      this.onRefill(r.name);
    }
    return { ...r, items };
  }

  #isBag = (r: Rollable): r is ListRandomizer => r.type === "list" && r.withoutReplacement === true;

  /** A result as the text keeps it; when it goes to another oracle, keep that one's copy too. */
  #finish(o: Outcome, r: Rollable): RollResult {
    const result = resultFrom(o, r, this.#name, this.#now());
    // The tables its text referred to are kept too, so it re-rolls the same way elsewhere.
    for (const p of o.parts ?? []) {
      const t = this.#library.byId(p.id);
      if (t) this.#keep(t.randomizer);
    }
    if (result.next) {
      const target = this.#library.byId(result.next.id);
      if (target) result.next = { ...result.next, version: this.#keep(target.randomizer) };
    }
    if (this.#isBag(r) && o.itemIndex !== undefined) {
      const bags = this.#bags();
      bags.set(r.id, [...bags.get(r.id), r.items[o.itemIndex].label]);
    }
    return result;
  }

  /** Rolls r, or deals its offer; `make` turns the result into the record to keep. */
  #begin(r: Rollable, make: (result: RollResult, source: RollSource) => RollRecord, before?: RollSource): Begun {
    const v = this.#keep(r);
    // The credit: from the library or the journal's copy, else as the chip had it.
    const found = this.#library.byId(r.id)?.pack;
    const pack: PackCredit | undefined = found
      ? { title: found.title, author: found.author, version: found.version, ...(found.licence ? { licence: found.licence } : {}), ...(found.homepage ? { homepage: found.homepage } : {}) }
      : before?.kind === "oracle"
        ? before.pack
        : undefined;
    const source: RollSource = { kind: "oracle", id: r.id, name: r.name, version: v, ...(pack ? { pack } : {}) };
    const pool = this.#isBag(r) ? this.#fromBag(r) : r;
    if (pool.type === "list" && pool.offer && pool.offer >= 2) {
      const offer = offerFromList(pool, pool.offer, this.#rng(), this.refs);
      if (offer.length > 1) {
        return {
          kind: "pick",
          name: r.name,
          choices: offer.map((o) => o.text),
          finish: (index) => make(this.#finish(chosenFromOffer(r.name, offer, index), pool), source),
        };
      }
      return { kind: "done", record: make(this.#finish(chosenFromOffer(r.name, offer, 0), pool), source) };
    }
    return { kind: "done", record: make(this.#finish(rollRandomizer(pool, this.#rng(), this.refs), pool), source) };
  }

  /** A new roll of an oracle. */
  start(id: string, version?: string, fallbackName = "That oracle"): Begun {
    const r = this.resolve(id, version);
    if (!r) return { kind: "missing", name: fallbackName };
    return this.#begin(r, (result, source) => ({ source, results: [result] }));
  }

  /** The same roll again, keeping the earlier results. A bag takes the old answer back first. */
  startReroll(record: RollRecord): Begun {
    if (record.source.kind === "dice") {
      return { kind: "done", record: withResult(record, rollOnce(diceRandomizer(record.source.expression), this.#rng(), this.#name, this.#now())) };
    }
    const { id, version, name } = record.source;
    const r = this.resolve(id, version);
    if (!r) return { kind: "missing", name };
    if (this.#isBag(r)) {
      const bags = this.#bags();
      const old = record.results[record.results.length - 1].text;
      const given = bags.get(r.id);
      const at = given.lastIndexOf(old);
      if (at >= 0) bags.set(r.id, [...given.slice(0, at), ...given.slice(at + 1)]);
    }
    return this.#begin(r, (result, source) => withResult(record, result, source), record.source);
  }

  /** The roll an outcome points at with "goes to". */
  startNext(record: RollRecord): Begun {
    const target = record.results[record.results.length - 1].next;
    if (!target) return { kind: "missing", name: "The next oracle" };
    return this.start(target.id, target.version, target.name);
  }

  dice(expression: string): RollRecord {
    return { source: { kind: "dice", expression }, results: [rollOnce(diceRandomizer(expression), this.#rng(), this.#name, this.#now())] };
  }

  // Shorthands where a pick, if one is offered, takes the first choice: for
  // tests, and for anything that cannot ask.
  oracle(id: string, version?: string): RollRecord | null {
    return settle(this.start(id, version));
  }
  reroll(record: RollRecord): RollRecord | null {
    return settle(this.startReroll(record));
  }
  next(record: RollRecord): RollRecord | null {
    return settle(this.startNext(record));
  }
}

function settle(b: Begun): RollRecord | null {
  return b.kind === "done" ? b.record : b.kind === "pick" ? b.finish(0) : null;
}

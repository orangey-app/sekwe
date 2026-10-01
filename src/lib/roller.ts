/**
 * Rolling, for the editor: an oracle from the library, a dice expression, the
 * same chip again, or the oracle a result "goes to".
 *
 * Which randomizer a re-roll uses: the library's current one when the oracle
 * is still there (so an edit made in Orangey counts from the next roll), and
 * otherwise the snapshot the journal keeps of the version last rolled. Every
 * oracle rolled is snapshotted into the journal, so a journal re-rolls on
 * another machine, offline, or after the wheel is deleted.
 */

import type { RandomSource } from "../../vendor/orangey/src/core/rng.ts";
import { packRandomizer, unpackRandomizer } from "../../vendor/orangey/src/model/link.ts";
import type { Rollable } from "../../vendor/orangey/src/model/randomizer.ts";
import { rollable, versionOf, type OracleLibrary } from "./oracles.ts";
import { diceRandomizer, rollOnce, withResult, type RollRecord, type RollResult } from "./rolls.ts";

/** Where the journal keeps its snapshots; the session provides it. */
export interface Snapshots {
  get(key: string): Record<string, unknown> | undefined;
  put(key: string, packed: Record<string, unknown>): void;
}

export const snapshotKey = (id: string, version: string) => `${id}@${version}`;

export class Roller {
  #library: OracleLibrary;
  #snapshots: () => Snapshots;
  #rng: () => RandomSource;
  #now: () => Date;

  constructor(library: OracleLibrary, snapshots: () => Snapshots, rng: () => RandomSource, now = () => new Date()) {
    this.#library = library;
    this.#snapshots = snapshots;
    this.#rng = rng;
    this.#now = now;
  }

  #name = (id: string): string | null => this.#library.byId(id)?.name ?? null;

  /** Keeps a copy of this version in the journal, once. */
  #keep(r: Rollable): string {
    const version = versionOf(r);
    const key = snapshotKey(r.id, version);
    const snaps = this.#snapshots();
    if (!snaps.get(key)) snaps.put(key, packRandomizer(r));
    return version;
  }

  /**
   * Rolls and, when the outcome goes to another oracle, keeps that one's
   * snapshot too, so the chain can be followed later without the library.
   */
  #roll(r: Rollable): RollResult {
    const result = rollOnce(r, this.#rng(), this.#name, this.#now());
    if (result.next) {
      const target = this.#library.byId(result.next.id);
      if (target) result.next = { ...result.next, version: this.#keep(target.randomizer) };
    }
    return result;
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

  /** A new roll of an oracle, or null when it can be found nowhere. */
  oracle(id: string, version?: string): RollRecord | null {
    const r = this.resolve(id, version);
    if (!r) return null;
    const v = this.#keep(r);
    return { source: { kind: "oracle", id, name: r.name, version: v }, results: [this.#roll(r)] };
  }

  dice(expression: string): RollRecord {
    return { source: { kind: "dice", expression }, results: [rollOnce(diceRandomizer(expression), this.#rng(), this.#name, this.#now())] };
  }

  /** The same roll again, keeping the earlier results; null if the oracle is gone with no snapshot. */
  reroll(record: RollRecord): RollRecord | null {
    if (record.source.kind === "dice") {
      return withResult(record, rollOnce(diceRandomizer(record.source.expression), this.#rng(), this.#name, this.#now()));
    }
    const { id, version } = record.source;
    const r = this.resolve(id, version);
    if (!r) return null;
    const v = this.#keep(r);
    return withResult(record, this.#roll(r), { kind: "oracle", id, name: r.name, version: v });
  }

  /** The roll an outcome points at with "goes to", as a new record. */
  next(record: RollRecord): RollRecord | null {
    const target = record.results[record.results.length - 1].next;
    return target ? this.oracle(target.id, target.version) : null;
  }
}

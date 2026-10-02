/**
 * A roll in the text: what was rolled, and every result it has had.
 *
 * A roll chip in the document holds one RollRecord. Re-rolling appends a
 * result rather than replacing one, so the earlier answers stay visible; the
 * last result is the one the text shows.
 */

import { rollRandomizer, type Outcome } from "../../vendor/orangey/src/model/roll.ts";
import type { RandomSource } from "../../vendor/orangey/src/core/rng.ts";
import type { DiceRandomizer, Rollable } from "../../vendor/orangey/src/model/randomizer.ts";

/** Who made an oracle's pack, as its credit needs it (Orangey's PackManifest, in part). */
export interface PackCredit {
  title: string;
  author: string;
  version: string;
  licence?: string;
  homepage?: string;
}

export type RollSource =
  | {
      kind: "oracle";
      id: string;
      /** The oracle's name when last rolled, for a chip whose oracle is gone. */
      name: string;
      /** versionOf() the randomizer this result came from; with id, names its snapshot. */
      version: string;
      /** The pack it belongs to, for its credit: in the chip's pop-up and in exports. */
      pack?: PackCredit;
    }
  | { kind: "dice"; expression: string };

export interface RollResult {
  /** What the text shows. */
  text: string;
  /** Supporting detail: the dice as rolled, or "chosen from" for a pick. */
  detail?: string;
  /** Dice written into the outcome, as rolled: "2d4 [1, 2] = 3". */
  rolled?: string[];
  /** For an inkblot: the number the whole blot is drawn from. */
  blot?: number;
  /** An outcome that "goes to" another oracle: the next roll to offer. */
  next?: { id: string; name: string; version?: string };
  /** Chosen by the writer from an offer, not rolled; `detail` says what else was offered. */
  picked?: true;
  /** The tables its text referred to (`{@Weather}`), and what each gave. */
  parts?: { name: string; text: string }[];
  at: string;
}

export interface RollRecord {
  source: RollSource;
  /** Oldest first; never empty. */
  results: RollResult[];
}

export const current = (r: RollRecord): RollResult => r.results[r.results.length - 1];

/** The text a chip shows, and what it becomes as plain text or in an export. */
export function chipText(r: RollResult): string {
  return r.blot !== undefined ? `Inkblot #${r.blot}` : r.text;
}

export function resultFrom(o: Outcome, r: Rollable, findName: (id: string) => string | null, now: Date): RollResult {
  const result: RollResult = { text: o.text, at: now.toISOString() };
  if (o.kind === "inkblot" && o.blot !== undefined) result.blot = o.blot;
  if (o.detail && o.kind !== "list") result.detail = o.detail;
  if (o.picked || o.offered) {
    result.picked = true;
    const note = o.detail?.split(" · ").find((p) => p.startsWith("chosen from"));
    if (note) result.detail = note;
  }
  if (o.rolled?.length) result.rolled = o.rolled;
  if (o.parts?.length) result.parts = o.parts.map((p) => ({ name: p.name, text: p.text }));
  if (r.type === "list" && o.itemIndex !== undefined) {
    const target = r.items[o.itemIndex]?.goesTo;
    if (target) result.next = { id: target, name: findName(target) ?? "another oracle" };
  }
  return result;
}

export function rollOnce(r: Rollable, rng: RandomSource, findName: (id: string) => string | null, now = new Date()): RollResult {
  return resultFrom(rollRandomizer(r, rng), r, findName, now);
}

export function diceRandomizer(expression: string): DiceRandomizer {
  const at = new Date(0).toISOString();
  return { id: `dice:${expression}`, type: "dice", name: expression, expression, created: at, modified: at };
}

export function withResult(record: RollRecord, result: RollResult, source: RollSource = record.source): RollRecord {
  return { source, results: [...record.results, result] };
}

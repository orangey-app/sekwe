import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SeededSource } from "../../vendor/orangey/src/core/rng.ts";
import type { ListRandomizer, Rollable } from "../../vendor/orangey/src/model/randomizer.ts";
import { MemoryBackend } from "../../vendor/orangey/src/storage/memory.ts";
import { diceExpression, OracleLibrary, searchOracles, versionOf, type Oracle } from "../../src/lib/oracles.ts";
import { Roller, snapshotKey, type Snapshots } from "../../src/lib/roller.ts";
import { chipText, current } from "../../src/lib/rolls.ts";

const list = (id: string, name: string, labels: (string | [string, string])[], extra: Partial<ListRandomizer> = {}): ListRandomizer => ({
  id,
  type: "list",
  name,
  view: "wheel",
  items: labels.map((l, i) => (Array.isArray(l) ? { id: `i${i}`, label: l[0], weight: 1, goesTo: l[1] } : { id: `i${i}`, label: l, weight: 1 })),
  ...extra,
});

const oracle = (r: Rollable, folder = ""): Oracle => ({ id: r.id, name: r.name, folder, randomizer: r });

function memorySnapshots(): Snapshots & { all: Record<string, Record<string, unknown>> } {
  const all: Record<string, Record<string, unknown>> = {};
  return { all, get: (k) => all[k], put: (k, v) => void (all[k] = v) };
}

describe("finding an oracle as you type", () => {
  const oracles = [
    oracle(list("a", "NPC Motivation", ["x"]), "Character"),
    oracle(list("b", "NPC Name", ["x"]), "Character"),
    oracle(list("c", "Character Goal", ["x"]), "Starforged/Character"),
    oracle(list("d", "Planet Type", ["x"]), "Starforged/Planet"),
    oracle(list("e", "Ändern der Welt", ["x"]), ""),
  ];

  test("every word typed must begin a word of the name or the folder", () => {
    assert.deepEqual(searchOracles(oracles, "npc mot").map((m) => m.oracle.name), ["NPC Motivation"]);
    assert.deepEqual(searchOracles(oracles, "plan").map((m) => m.oracle.name), ["Planet Type"]);
    assert.deepEqual(searchOracles(oracles, "starf type").map((m) => m.oracle.name), ["Planet Type"]);
    assert.deepEqual(searchOracles(oracles, "zzz"), []);
  });

  test("a name match outranks a folder match, and accents do not matter", () => {
    assert.equal(searchOracles(oracles, "character")[0].oracle.name, "Character Goal");
    assert.equal(searchOracles(oracles, "andern")[0].oracle.name, "Ändern der Welt");
  });

  test("an empty query lists oracles alphabetically, up to the limit", () => {
    assert.deepEqual(searchOracles(oracles, "", 2).map((m) => m.oracle.name), ["Ändern der Welt", "Character Goal"].sort((a, b) => a.localeCompare(b)));
  });

  test("2,000 oracles are searched in well under 10 ms a keystroke", () => {
    const many = Array.from({ length: 2000 }, (_, i) => oracle(list(`o${i}`, `Oracle ${i} of the ${["sea", "sky", "deep"][i % 3]}`, ["x"]), `Pack ${i % 40}`));
    searchOracles(many, "warm up");
    const started = performance.now();
    for (const q of ["o", "or", "ora", "orac", "oracle 1", "oracle 1 sky"]) searchOracles(many, q);
    const perKeystroke = (performance.now() - started) / 6;
    assert.ok(perKeystroke < 10, `${perKeystroke.toFixed(2)} ms per keystroke`);
  });

  test("dice are recognised as dice, and a name is not", () => {
    assert.equal(diceExpression("2d6"), "2d6");
    assert.equal(diceExpression("d100"), "d100");
    assert.equal(diceExpression("4dF+1"), "4dF+1");
    assert.equal(diceExpression("dragon"), null);
    assert.equal(diceExpression("2d"), null);
  });
});

describe("an oracle's version", () => {
  test("changes when what can come up changes, and not for a colour or a rename", () => {
    const base = list("v", "Weather", ["Rain", "Sun"]);
    const v = versionOf(base);
    assert.match(v, /^[0-9a-f]{16}$/);
    assert.equal(versionOf({ ...base, name: "Sky", palette: ["#000000", "#111111", "#222222"] }), v);
    assert.equal(versionOf({ ...base, items: base.items.map((i) => ({ ...i, color: "#a33a30" })) }), v);
    assert.notEqual(versionOf({ ...base, items: base.items.map((i, n) => ({ ...i, weight: n + 1 })) }), v);
    assert.notEqual(versionOf({ ...base, items: [...base.items, { id: "x", label: "Fog", weight: 1 }] }), v);
    assert.notEqual(versionOf({ ...base, items: base.items.map((i, n) => (n ? { ...i, disabled: true } : i)) }), v);
  });
});

describe("rolling", () => {
  const weather = list("w", "Weather", ["Rain", "Sun", "Fog"]);
  const npc = list("n", "NPC", [["Smuggler", "m"], ["Pilot", "m"]]);
  const motive = list("m", "Motive", ["Greed", "Debt"]);
  const blot: Rollable = { id: "ink", type: "inkblot", name: "Inkblot" };

  function setup(oracles = [weather, npc, motive, blot], seed = "storyboard") {
    const library = OracleLibrary.of(oracles.map((r) => oracle(r)));
    const snaps = memorySnapshots();
    const rng = new SeededSource(seed);
    const roller = new Roller(library, () => snaps, () => rng, () => new Date("2026-10-01T12:00:00Z"));
    return { library, snaps, roller };
  }

  test("an oracle rolls one of its outcomes, and the journal keeps a copy of that version", () => {
    const { roller, snaps } = setup();
    const record = roller.oracle("w")!;
    assert.ok(["Rain", "Sun", "Fog"].includes(current(record).text));
    assert.equal(record.source.kind, "oracle");
    const key = snapshotKey("w", versionOf(weather));
    assert.deepEqual(Object.keys(snaps.all), [key]);
    assert.equal(snaps.all[key].name, "Weather");
    assert.equal((snaps.all[key].items as unknown[]).length, 3);
  });

  test("the same seed gives the same rolls", () => {
    const a = setup().roller;
    const b = setup().roller;
    const texts = (r: Roller) => Array.from({ length: 8 }, () => current(r.oracle("w")!).text);
    assert.deepEqual(texts(a), texts(b));
  });

  test("a re-roll keeps every earlier result, oldest first", () => {
    const { roller } = setup();
    let record = roller.oracle("w")!;
    const first = current(record).text;
    record = roller.reroll(record)!;
    record = roller.reroll(record)!;
    assert.equal(record.results.length, 3);
    assert.equal(record.results[0].text, first);
  });

  test("a deleted oracle still re-rolls from the journal's copy", () => {
    const first = setup();
    const record = first.roller.oracle("w")!;
    const library = OracleLibrary.of([]);
    const roller = new Roller(library, () => first.snaps, () => new SeededSource("x"));
    const again = roller.reroll(record)!;
    assert.equal(again.results.length, 2);
    assert.ok(["Rain", "Sun", "Fog"].includes(current(again).text));
    assert.equal(roller.reroll({ ...record, source: { kind: "oracle", id: "gone", name: "Gone", version: "0" } }), null);
  });

  test("an edit made in Orangey counts from the next roll, and the old version's copy stays", () => {
    const { roller, snaps, library } = setup();
    const record = roller.oracle("w")!;
    const edited = list("w", "Weather", ["Snow"]);
    (library as unknown as { oracles: Oracle[] }).oracles = [];
    const fresh = OracleLibrary.of([oracle(edited)]);
    const roller2 = new Roller(fresh, () => snaps, () => new SeededSource("y"));
    const again = roller2.reroll(record)!;
    assert.equal(current(again).text, "Snow");
    assert.equal(Object.keys(snaps.all).length, 2, "both versions are kept");
  });

  test("an outcome that goes to another oracle offers it, and following it rolls that oracle", () => {
    const { roller, snaps } = setup();
    const record = roller.oracle("n")!;
    assert.deepEqual({ ...current(record).next, version: undefined }, { id: "m", name: "Motive", version: undefined });
    assert.ok(snaps.get(snapshotKey("m", versionOf(motive))), "the target's copy was not kept");
    const next = roller.next(record)!;
    assert.equal(next.source.kind === "oracle" && next.source.id, "m");
    assert.ok(["Greed", "Debt"].includes(current(next).text));
  });

  test("dice roll and re-roll by expression", () => {
    const { roller } = setup();
    const record = roller.dice("2d6");
    const total = Number(current(record).text);
    assert.ok(total >= 2 && total <= 12);
    assert.match(current(record).detail ?? "", /2d6/);
    assert.equal(roller.reroll(record)!.results.length, 2);
  });

  test("an inkblot rolls a number, which is what the chip shows", () => {
    const { roller } = setup();
    const r = current(roller.oracle("ink")!);
    assert.ok(Number.isInteger(r.blot) && r.blot! >= 1);
    assert.equal(chipText(r), `Inkblot #${r.blot}`);
  });
});

describe("the Orangey library, read where Orangey keeps it", () => {
  test("reads every oracle and skips boards", async () => {
    const backend = new MemoryBackend();
    const file = (r: unknown) => JSON.stringify({ format: "orangey", version: 1, randomizer: r }, null, 2);
    await backend.mkdir("Starforged");
    await backend.write("Starforged/weather.orangey.json", file({ ...list("w", "Weather", ["Rain"]), created: "2026-01-01T00:00:00Z", modified: "2026-01-01T00:00:00Z" }));
    await backend.write("tonight.orangey.json", file({ id: "b", type: "board", name: "Tonight", entries: [{ id: "w", name: "Weather" }] }));
    const lib = new OracleLibrary(async () => ({ backend, folder: null }), async () => null);
    await lib.load();
    assert.equal(lib.status, "ready");
    assert.deepEqual(lib.oracles.map((o) => [o.name, o.folder]), [["Weather", "Starforged"]]);
  });

  test("a folder that needs a click is reported, not replaced by another library", async () => {
    const backend = new MemoryBackend();
    const lib = new OracleLibrary(async () => ({ backend, folder: "ask" }), async () => backend);
    await lib.load();
    assert.equal(lib.status, "needs-folder");
    assert.equal(await lib.openFolder(), true);
    assert.equal(lib.status, "empty");
  });

  test("no storage at all reads as unavailable", async () => {
    const lib = new OracleLibrary(async () => ({ backend: null, folder: null }), async () => null);
    await lib.load();
    assert.equal(lib.status, "unavailable");
  });
});

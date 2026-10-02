import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SeededSource } from "../../vendor/orangey/src/core/rng.ts";
import type { ListRandomizer, Rollable } from "../../vendor/orangey/src/model/randomizer.ts";
import { MemoryBackend } from "../../vendor/orangey/src/storage/memory.ts";
import { diceExpression, folderPaths, inFolders, OracleLibrary, searchOracles, sharedPrefix, versionOf, type Oracle } from "../../src/lib/oracles.ts";
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

  // A guard against the search becoming much slower (say, a scan per typed
  // letter of every outcome), not a benchmark: the best of several tries, with
  // room for a slow or busy machine such as a CI runner. On a laptop a
  // keystroke takes 2 to 4 ms.
  test("2,000 oracles are searched in a few milliseconds a keystroke", () => {
    const many = Array.from({ length: 2000 }, (_, i) => oracle(list(`o${i}`, `Oracle ${i} of the ${["sea", "sky", "deep"][i % 3]}`, ["x"]), `Pack ${i % 40}`));
    for (let i = 0; i < 3; i++) searchOracles(many, "warm up");
    const queries = ["o", "or", "ora", "orac", "oracle 1", "oracle 1 sky"];
    let best = Infinity;
    for (let round = 0; round < 5; round++) {
      const started = performance.now();
      for (const q of queries) searchOracles(many, q);
      best = Math.min(best, (performance.now() - started) / queries.length);
    }
    assert.ok(best < 25, `${best.toFixed(2)} ms per keystroke at best`);
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

  function setup(oracles = [weather, npc, motive, blot], seed = "sekwe") {
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

describe("picks, bags, folders, recent oracles and Tab", () => {
  const offer = list("o", "Ask the Oracle", ["Yes", "No", "Maybe", "Twist"], { offer: 3 });
  const deck = list("d", "Deck", ["Ace", "King", "Queen"], { withoutReplacement: true });

  test("a list that offers a choice deals that many outcomes, and the pick lands, marked as picked", () => {
    const library = OracleLibrary.of([oracle(offer)]);
    const roller = new Roller(library, () => memorySnapshots(), () => new SeededSource("p"));
    const begun = roller.start("o");
    assert.equal(begun.kind, "pick");
    if (begun.kind !== "pick") return;
    assert.equal(begun.choices.length, 3);
    assert.equal(new Set(begun.choices).size, 3, "an offer repeated an outcome");
    const record = begun.finish(2);
    assert.equal(current(record).text, begun.choices[2]);
    assert.equal(current(record).picked, true);
    assert.match(current(record).detail ?? "", /^chosen from /);
  });

  test("a bag gives each outcome once, refills when empty, and its state is the journal's", () => {
    const { memoryBags } = { memoryBags: () => { const all: Record<string, string[]> = {}; return { all, get: (id: string) => all[id] ?? [], set: (id: string, l: string[]) => void (all[id] = l) }; } };
    const bags = memoryBags();
    let refills = 0;
    const roller = new Roller(OracleLibrary.of([oracle(deck)]), () => memorySnapshots(), () => new SeededSource("b"), () => new Date(), () => bags);
    roller.onRefill = () => refills++;
    const three = [0, 1, 2].map(() => current(roller.oracle("d")!).text);
    assert.deepEqual([...three].sort(), ["Ace", "King", "Queen"], "the bag repeated itself");
    assert.deepEqual([...bags.all.d].sort(), ["Ace", "King", "Queen"]);
    const fourth = current(roller.oracle("d")!).text;
    assert.equal(refills, 1);
    assert.deepEqual(bags.all.d, [fourth]);
  });

  test("re-rolling a bag's chip puts its old answer back first", () => {
    const bags = { all: {} as Record<string, string[]>, get(id: string) { return this.all[id] ?? []; }, set(id: string, l: string[]) { this.all[id] = l; } };
    const roller = new Roller(OracleLibrary.of([oracle(deck)]), () => memorySnapshots(), () => new SeededSource("r"), () => new Date(), () => bags);
    const record = roller.oracle("d")!;
    const again = roller.reroll(record)!;
    assert.equal(bags.all.d.length, 1, "the old answer stayed out of the bag");
    assert.equal(bags.all.d[0], current(again).text);
  });

  test("a journal's folders narrow what can be rolled, subfolders included", () => {
    const all = [oracle(list("a", "A", ["x"]), "Starforged/Core"), oracle(list("b", "B", ["x"]), "Starforged"), oracle(list("c", "C", ["x"]), "Dungeon"), oracle(list("d", "D", ["x"]), "")];
    assert.deepEqual(inFolders(all, ["Starforged"]).map((o) => o.id), ["a", "b"]);
    assert.deepEqual(inFolders(all, []).map((o) => o.id), ["a", "b", "c", "d"]);
    assert.deepEqual(folderPaths(all), ["Dungeon", "Starforged", "Starforged/Core"]);
  });

  test("recent oracles and words just written move an oracle up, but never add one", () => {
    const all = [oracle(list("n", "NPC Name", ["x"])), oracle(list("r", "NPC Role", ["x"])), oracle(list("w", "Weather", ["x"]))];
    assert.equal(searchOracles(all, "npc")[0].oracle.name, "NPC Name");
    assert.equal(searchOracles(all, "npc", 8, { recent: ["r"] })[0].oracle.name, "NPC Role");
    assert.equal(searchOracles(all, "npc", 8, { context: "A stranger walks in; her role is unclear" })[0].oracle.name, "NPC Role");
    assert.equal(searchOracles(all, "", 8, { context: "the weather turns" })[0].oracle.name, "Weather");
    assert.deepEqual(searchOracles(all, "npc", 8, { recent: ["w"] }).map((m) => m.oracle.name).includes("Weather"), false);
  });

  test("Tab fills in what every match shares", () => {
    assert.equal(sharedPrefix(["NPC Name", "NPC Role", "NPC Motive"]), "NPC ");
    assert.equal(sharedPrefix(["Weather"]), "Weather");
    assert.equal(sharedPrefix(["Alpha", "beta"]), "");
    assert.equal(sharedPrefix([]), "");
  });
});

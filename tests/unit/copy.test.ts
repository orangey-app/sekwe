import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SeededSource } from "../../vendor/orangey/src/core/rng.ts";
import type { ListRandomizer, Rollable } from "../../vendor/orangey/src/model/randomizer.ts";
import { fromCopy, keepCopy } from "../../src/lib/copy.ts";
import { inFolders, folderPaths, OracleLibrary, type Oracle } from "../../src/lib/oracles.ts";
import { LibraryService } from "../../vendor/orangey/src/storage/library.ts";
import { MemoryBackend } from "../../vendor/orangey/src/storage/memory.ts";
import { parseLibrary, serializeLibrary } from "../../vendor/orangey/src/storage/libraryfile.ts";
import { Roller, type Snapshots } from "../../src/lib/roller.ts";

const list = (id: string, name: string, labels: (string | [string, string])[]): ListRandomizer => ({
  id,
  type: "list",
  name,
  view: "wheel",
  items: labels.map((l, i) => (Array.isArray(l) ? { id: `i${i}`, label: l[0], weight: 1, goesTo: l[1] } : { id: `i${i}`, label: l, weight: 1 })),
});
const oracle = (r: Rollable, folder = ""): Oracle => ({ id: r.id, name: r.name, folder, randomizer: r });
const ids = (c: { oracles: { id: string }[] } | null) => (c ? c.oracles.map((o) => o.id).sort() : null);
const snaps = (): Snapshots => {
  const all: Record<string, Record<string, unknown>> = {};
  return { get: (k) => all[k], put: (k, v) => void (all[k] = v) };
};

const library = [
  oracle(list("sky", "Sky", ["Clear", ["Storm", "storm"]]), "Weather"),
  oracle(list("wind", "Wind", ["Calm", "Gale"]), "Weather/Wind"),
  oracle(list("storm", "Storm Kind", ["Hail", ["Lightning", "luck"]]), "Hazards"),
  oracle(list("luck", "Luck", ["Good", "Bad"]), "Hazards/Luck"),
  oracle(list("names", "Names", ["Ada", "Bo"]), "People"),
];
const T0 = new Date("2026-10-01T10:00:00Z");
const T1 = new Date("2026-10-02T10:00:00Z");

describe("the journal's copy of its folders", () => {
  test("no folders chosen: nothing is copied (option a)", () => {
    assert.equal(keepCopy(library, [], null, T0), null);
  });

  test("only the chosen folders, with their subfolders, and what they go to", () => {
    const c = keepCopy(library, ["Weather"], null, T0)!;
    assert.deepEqual(ids(c), ["luck", "sky", "storm", "wind"]);
    // The chain targets are kept, marked, and stay out of the menus.
    const linked = c.oracles.filter((o) => o.linked).map((o) => o.id).sort();
    assert.deepEqual(linked, ["luck", "storm"]);
    assert.deepEqual(inFolders(fromCopy(c), ["Weather"]).map((o) => o.id).sort(), ["sky", "wind"]);
    assert.deepEqual(folderPaths(fromCopy(c)), ["Weather", "Weather/Wind"]);
    assert.ok(!c.oracles.some((o) => o.id === "names"));
  });

  test("an unchanged library gives back the same copy, so nothing is saved again", () => {
    const c = keepCopy(library, ["Weather"], null, T0)!;
    const again = keepCopy(library, ["Weather"], JSON.parse(JSON.stringify(c)), T1)!;
    assert.equal(again.saved, c.saved);
    assert.deepEqual(again, c);
  });

  test("the live library wins: an edit and a deletion in a chosen folder carry over", () => {
    const c = keepCopy(library, ["Weather"], null, T0)!;
    const edited = [oracle(list("sky", "Sky", ["Clear", "Fog"]), "Weather"), ...library.slice(2)];
    const next = keepCopy(edited, ["Weather"], c, T1)!;
    assert.deepEqual(ids(next), ["sky"]); // wind deleted, the chain to storm gone
    assert.equal(next.saved, T1.toISOString());
    assert.deepEqual((next.oracles[0].packed.items as { label: string }[]).map((i) => i.label), ["Clear", "Fog"]);
  });

  test("a computer whose library lacks the folder keeps the copy as it was", () => {
    const c = keepCopy(library, ["Weather"], null, T0)!;
    const elsewhere = [oracle(list("other", "Other", ["x"]), "Elsewhere")];
    assert.equal(keepCopy(elsewhere, ["Weather"], c, T1), c);
    assert.equal(keepCopy([], ["Weather"], c, T1), c);
  });

  test("unchoosing a folder drops it; choosing none drops the copy only where a library is here", () => {
    const c = keepCopy(library, ["Weather", "People"], null, T0)!;
    assert.deepEqual(ids(keepCopy([], ["People"], c, T1)), ["names"]);
    assert.equal(keepCopy(library, [], c, T1), null);
    assert.equal(keepCopy([], [], c, T1), c);
  });

  test("with no Orangey, the journal rolls from its copy, chains included", () => {
    const c = keepCopy(library, ["Weather"], null, T0)!;
    const lib = OracleLibrary.of([]);
    lib.setKept(fromCopy(JSON.parse(JSON.stringify(c))));
    assert.equal(lib.fromCopy, 4);
    const roller = new Roller(lib, snaps, () => new SeededSource("copy"));
    let sawStorm = false;
    for (let i = 0; i < 30 && !sawStorm; i++) {
      const rec = roller.oracle("sky")!;
      const r = rec.results[0];
      if (r.next) {
        sawStorm = true;
        assert.equal(r.next.id, "storm");
        const next = roller.next(rec)!;
        assert.equal(next.source.kind === "oracle" && next.source.name, "Storm Kind");
      }
    }
    assert.ok(sawStorm, "Sky never went to Storm in 30 rolls");
  });

  test("the library here wins over the copy when both have an oracle", () => {
    const c = keepCopy(library, ["Weather"], null, T0)!;
    const lib = OracleLibrary.of([oracle(list("sky", "Sky here", ["Only"]), "Weather")]);
    lib.setKept(fromCopy(c));
    assert.equal(lib.byId("sky")!.name, "Sky here");
    assert.equal(lib.byId("wind")!.name, "Wind");
    assert.equal(lib.fromCopy, 3);
  });

  test("a damaged entry is left out, not fatal", () => {
    const c = keepCopy(library, ["People"], null, T0)!;
    c.oracles.push({ id: "bad", name: "Bad", folder: "People", packed: { type: "list", items: "no" } });
    assert.deepEqual(fromCopy(c).map((o) => o.id), ["names"]);
  });
});

describe("packs in the journal", () => {
  const DELVE = { id: "p", title: "Delve", author: "A. Writer", version: "1.0", licence: "CC BY 4.0" };
  const fromPack = (r: Rollable, folder: string, allowSnapshots?: false): Oracle => ({ ...oracle(r, folder), pack: { ...DELVE, ...(allowSnapshots === false ? { allowSnapshots } : {}) } });

  test("a pack that asks for no copies stays out of the copy, and drops out when its author changes their mind", () => {
    const open = [fromPack(list("theme", "Theme", [["Ancient", "secret"]]), "Delve"), oracle(list("mine", "Mine", ["x"]), "Delve")];
    const secret = fromPack(list("secret", "Secret", ["Hidden"]), "Locked", false);
    const c = keepCopy([...open, secret], ["Delve"], null, T0)!;
    assert.deepEqual(ids(c), ["mine", "theme"], "the chain followed into a pack that asked for no copies");
    assert.deepEqual(c.oracles.find((o) => o.id === "theme")!.pack, DELVE, "the credit did not travel with the copy");
    const closed = keepCopy([fromPack(list("theme", "Theme", ["Ancient"]), "Delve", false), open[1]], ["Delve"], c, T1)!;
    assert.deepEqual(ids(closed), ["mine"]);
  });

  test("a roll records its pack's credit; the journal keeps no copy of a no-copies pack", () => {
    const lib = OracleLibrary.of([fromPack(list("theme", "Theme", ["Ancient"]), "Delve"), fromPack(list("secret", "Secret", ["Hidden"]), "Locked", false)]);
    const all: Record<string, unknown> = {};
    const roller = new Roller(lib, () => ({ get: (k) => all[k] as Record<string, unknown>, put: (k, v) => void (all[k] = v) }), () => new SeededSource("p"));
    const a = roller.oracle("theme")!;
    assert.deepEqual(a.source.kind === "oracle" && a.source.pack, { title: "Delve", author: "A. Writer", version: "1.0", licence: "CC BY 4.0" });
    roller.oracle("secret");
    assert.deepEqual(Object.keys(all).map((k) => k.split("@")[0]), ["theme"]);
  });
});

describe("an installed Orangey pack, read by Storyboard", () => {
  test("its oracles carry the pack's credit and its wish about copies", async () => {
    const backend = new MemoryBackend();
    const service = new LibraryService(backend, 0);
    await service.refresh();
    const at = "2026-10-02T00:00:00.000Z";
    const text = serializeLibrary("Delve", at, [], [{ path: "theme.orangey.json", randomizer: { ...list("theme", "Theme", ["Ancient"]), created: at, modified: at } }],
      { id: "p", title: "Delve", author: "A. Writer", version: "1.0", allowSnapshots: false });
    await service.installPack(parseLibrary(text), { source: "https://example.org/delve.json" });
    const lib = new OracleLibrary(async () => ({ backend, folder: null }), async () => null);
    await lib.load();
    assert.deepEqual(lib.byId("theme")!.pack, { id: "p", title: "Delve", author: "A. Writer", version: "1.0", allowSnapshots: false });
  });
});

describe("tables inside tables", () => {
  const sky = list("sky", "Sky", ["fog", "rain"]);
  const morning = list("morning", "Morning", ["A {@Sky|sky} morning"]);

  test("a roll fills in the table it refers to, records it, and the journal keeps a copy of both", () => {
    const lib = OracleLibrary.of([oracle(morning, "Days"), oracle(sky, "Weather")]);
    const all: Record<string, Record<string, unknown>> = {};
    const snapshots: Snapshots = { get: (k) => all[k], put: (k, v) => void (all[k] = v), latest: (id) => Object.entries(all).filter(([k]) => k.startsWith(`${id}@`)).at(-1)?.[1] };
    const roller = new Roller(lib, () => snapshots, () => new SeededSource("refs"));
    const rec = roller.oracle("morning")!;
    assert.match(rec.results[0].text, /^A (fog|rain) morning$/);
    assert.deepEqual(rec.results[0].parts?.map((p) => p.name), ["Sky"]);
    assert.deepEqual(Object.keys(all).map((k) => k.split("@")[0]).sort(), ["morning", "sky"]);
    // Elsewhere, with no library at all: it re-rolls from what the journal kept.
    const away = new Roller(OracleLibrary.of([]), () => snapshots, () => new SeededSource("away"));
    assert.match(away.reroll(rec)!.results[1].text, /^A (fog|rain) morning$/);
  });

  test("the copy of a folder brings the tables its outcomes refer to", () => {
    const c = keepCopy([oracle(morning, "Days"), oracle(sky, "Weather")], ["Days"], null, T0)!;
    assert.deepEqual(ids(c), ["morning", "sky"]);
    assert.equal(c.oracles.find((o) => o.id === "sky")!.linked, true);
    // From a copy alone, a table it refers to but never had is not invented.
    assert.deepEqual(ids(keepCopy([], ["Days"], { saved: "x", oracles: c.oracles.filter((o) => o.id === "morning") }, T1)), ["morning"]);
  });
});

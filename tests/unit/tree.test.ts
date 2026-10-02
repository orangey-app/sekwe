import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allPaths, ancestors, buildTree, filterTree, isChosen, visibleOracles } from "../../src/lib/tree.ts";
import type { Oracle } from "../../src/lib/oracles.ts";
import type { ListRandomizer } from "../../vendor/orangey/src/model/randomizer.ts";

const o = (id: string, name: string, folder: string, pack?: string): Oracle => ({
  id, name, folder,
  randomizer: { id, type: "list", name, view: "list", items: [{ id: `${id}0`, label: "x", weight: 1 }] } as ListRandomizer,
  ...(pack ? { pack: { id: pack, title: pack, author: "A", version: "1.0" } } : {}),
});
const all = [
  o("w", "Weather", "Starforged"),
  o("g", "Character Goal", "Starforged/Character"),
  o("r", "Character Role", "Starforged/Character"),
  o("t", "Theme", "Delve", "delve"),
  o("d", "Domain", "Delve/Domains", "delve"),
  o("i", "Inkblot", ""),
  { ...o("l", "Linked", "Elsewhere"), linked: true },
];

describe("the oracle tree", () => {
  test("nests folders, counts what is below, and leaves chain-only oracles out", () => {
    const t = buildTree(all);
    assert.deepEqual(t.folders.map((f) => [f.name, f.count]), [["Delve", 2], ["Starforged", 3]]);
    assert.deepEqual(t.oracles.map((x) => x.name), ["Inkblot"]);
    const sf = t.folders[1];
    assert.deepEqual(sf.folders.map((f) => [f.path, f.count]), [["Starforged/Character", 2]]);
    assert.deepEqual(allPaths(t), ["Delve", "Delve/Domains", "Starforged", "Starforged/Character"]);
  });

  test("a pack's badge sits on the folder where it starts, not below", () => {
    const t = buildTree(all);
    assert.equal(t.folders[0].pack?.title, "delve");
    assert.equal(t.folders[0].folders[0].pack, undefined);
    assert.equal(t.folders[1].pack, undefined);
  });

  test("only the journal's folders show, unless choosing; none chosen means all", () => {
    assert.deepEqual(visibleOracles(all, ["Starforged/Character"], false).map((x) => x.id), ["g", "r"]);
    assert.equal(visibleOracles(all, ["Starforged/Character"], true).length, 6);
    assert.equal(visibleOracles(all, [], false).length, 6);
    // Choosing: empty folders of the library are shown too.
    assert.deepEqual(buildTree([], ["Empty/Inside"]).folders.map((f) => f.path), ["Empty"]);
  });

  test("a filter keeps the matches and opens the folders they are in", () => {
    const f = filterTree(all.filter((x) => !x.linked), "goal");
    assert.deepEqual(f.oracles.map((x) => x.id), ["g"]);
    assert.deepEqual([...f.open].sort(), ["Starforged", "Starforged/Character"]);
    assert.deepEqual(ancestors("A/B/C"), ["A", "A/B", "A/B/C"]);
  });

  test("a folder counts as chosen when it or a folder above it is", () => {
    assert.deepEqual(isChosen("Starforged/Character", ["Starforged"]), { chosen: true, byParent: true });
    assert.deepEqual(isChosen("Starforged", ["Starforged"]), { chosen: true, byParent: false });
    assert.deepEqual(isChosen("Delve", ["Starforged"]), { chosen: false, byParent: false });
  });
});

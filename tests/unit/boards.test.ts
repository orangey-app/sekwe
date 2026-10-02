import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { boardCommandName, boardCommands, ownCopy } from "../../src/lib/boards.ts";
import { boardsFromCopy, keepCopy } from "../../src/lib/copy.ts";
import type { Board, Oracle } from "../../src/lib/oracles.ts";
import type { ListRandomizer } from "../../vendor/orangey/src/model/randomizer.ts";

const board = (id: string, name: string, folder: string, ids: string[]): Board => ({ id, name, folder, entries: ids.map((e) => ({ id: e, name: e.toUpperCase() })) });
const list = (id: string, folder: string): Oracle => ({
  id, name: id, folder,
  randomizer: { id, type: "list", name: id, view: "list", items: [{ id: `${id}0`, label: "x", weight: 1 }] } as ListRandomizer,
});

describe("boards as commands", () => {
  test("a board's name becomes a command name", () => {
    assert.equal(boardCommandName("Tonight's Table!"), "tonights-table");
    assert.equal(boardCommandName("Ärger im Dorf"), "arger-im-dorf");
    assert.equal(boardCommandName("!!!"), null);
    assert.equal(boardCommandName("a".repeat(50)).length, 32);
  });

  test("boards in the journal's folders roll everything on them; the writer's own command of the name wins", () => {
    const boards = [board("b1", "Tonight", "Delve", ["w", "e"]), board("b2", "Elsewhere", "Other", ["x"]), board("b3", "Empty", "Delve", [])];
    const cmds = boardCommands(boards, ["Delve"], []);
    assert.deepEqual(cmds.map((c) => c.name), ["tonight"]);
    assert.deepEqual(cmds[0].steps, [{ kind: "oracle", id: "w", name: "W" }, { kind: "oracle", id: "e", name: "E" }]);
    assert.deepEqual(boardCommands(boards, [], []).map((c) => c.name), ["elsewhere", "tonight"]);
    assert.deepEqual(boardCommands(boards, ["Delve"], [{ name: "tonight", steps: [] }]), []);
  });

  test("two boards with one name are told apart", () => {
    const cmds = boardCommands([board("a", "Tonight", "", ["w"]), board("b", "Tonight", "X", ["w"])], [], []);
    assert.deepEqual(cmds.map((c) => c.name), ["tonight", "tonight-2"]);
  });

  test("made one's own, it is a plain command", () => {
    const [c] = boardCommands([board("b1", "Tonight", "", ["w"])], [], []);
    assert.deepEqual(ownCopy(c), { name: "tonight", steps: [{ kind: "oracle", id: "w", name: "W" }] });
  });

  test("the journal's copy keeps the chosen folders' boards and what is on them", () => {
    const live = [list("w", "Delve"), list("far", "Elsewhere")];
    const c = keepCopy(live, ["Delve"], null, new Date("2026-10-02T00:00:00Z"), [board("b1", "Tonight", "Delve", ["w", "far"]), board("b2", "Not", "Elsewhere", ["far"])])!;
    assert.deepEqual(boardsFromCopy(c).map((b) => b.id), ["b1"]);
    assert.deepEqual(c.oracles.map((o) => [o.id, !!o.linked]).sort(), [["far", true], ["w", false]]);
    // Elsewhere, with no library: the board is kept as it was.
    assert.equal(keepCopy([], ["Delve"], c, new Date(), []), c);
  });
});

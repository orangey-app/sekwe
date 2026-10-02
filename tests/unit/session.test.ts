import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Session, type MakeEditor, type SessionView } from "../../src/lib/session.ts";
import { MemoryStore } from "../../src/lib/store.ts";
import { UNTITLED, type DocJSON } from "../../src/lib/journal.ts";

/** An editor stand-in: holds a document, and "typing" replaces its text. */
function fakeEditors() {
  type Fake = { doc: DocJSON; onChange: () => void; destroyed: boolean };
  const all: (Fake & { role: string })[] = [];
  const make: MakeEditor = (doc, onChange, role) => {
    const e = { doc: structuredClone(doc), onChange, destroyed: false, role };
    all.push(e);
    return { getJSON: () => structuredClone(e.doc), destroy: () => void (e.destroyed = true) } as ReturnType<MakeEditor>;
  };
  const write = (role: string) => (text: string) => {
    const e = all.filter((x) => x.role === role).at(-1)!;
    e.doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
    e.onChange();
  };
  // `live`: the story editors, in the order they were made.
  return {
    make,
    type: write("story"),
    note: write("status"),
    get live() {
      return all.filter((x) => x.role === "story");
    },
    get statusLive() {
      return all.filter((x) => x.role === "status");
    },
  };
}

const textOf = (doc: DocJSON | undefined) => JSON.stringify(doc).match(/"text":"([^"]*)"/)?.[1];

function setup(store = new MemoryStore()) {
  const editors = fakeEditors();
  let view: SessionView | null = null;
  const session = new Session(store, editors.make, (v) => (view = v), { delayMs: 0 });
  return { store, session, editors, view: () => view! };
}

describe("a writing session", () => {
  test("a first visit makes one empty journal and opens it", async () => {
    const s = setup();
    await s.session.start();
    assert.equal(s.view().journals.length, 1);
    assert.equal(s.view().title, UNTITLED);
    assert.equal(s.view().currentId, s.view().journals[0].id);
  });

  test("what is typed is saved, and comes back in a new session", async () => {
    const s = setup();
    await s.session.start();
    s.editors.type("The lighthouse keeper lied.");
    s.session.setTitle("  Salt  and Iron ");
    assert.equal(await s.session.flush(), true);
    const again = setup(s.store);
    await again.session.start();
    assert.equal(again.view().title, "Salt and Iron");
    assert.equal(textOf(again.editors.live[0].doc), "The lighthouse keeper lied.");
  });

  test("switching saves the open journal first, and each keeps its own words and its own undo", async () => {
    const s = setup();
    await s.session.start();
    const first = s.view().currentId!;
    s.editors.type("first journal");
    await s.session.create();
    assert.equal(s.view().title, `${UNTITLED} 2`);
    assert.equal(s.editors.live[0].destroyed, true, "the old editor (and its undo history) was kept");
    s.editors.type("second journal");
    await s.session.open(first);
    assert.equal(textOf(s.editors.live[2].doc), "first journal");
    const second = s.view().journals.find((j) => j.id !== first)!;
    assert.equal(textOf((await s.store.get(second.id))!.doc), "second journal");
  });

  test("reopening remembers the journal used last", async () => {
    const s = setup();
    await s.session.start();
    await s.session.create();
    const second = s.view().currentId;
    const again = setup(s.store);
    await again.session.start();
    assert.equal(again.view().currentId, second);
  });

  test("when the save before a switch fails, nothing switches and the words stay", async () => {
    const s = setup();
    await s.session.start();
    const first = s.view().currentId;
    s.editors.type("unsaved words");
    s.store.failNext = 1;
    assert.equal(await s.session.create(), false);
    assert.equal(s.view().currentId, first);
    assert.equal(s.editors.live.length, 1, "a new editor was made");
    assert.match(s.view().problem!, /Could not save/);
    assert.equal(textOf(s.editors.live[0].doc), "unsaved words");
  });

  test("the status panel is saved with its journal, and each journal has its own", async () => {
    const s = setup();
    await s.session.start();
    s.editors.note("HP 12 · Supplies 3");
    await s.session.create();
    s.editors.note("A different campaign");
    await s.session.flush();
    const again = setup(s.store);
    await again.session.start();
    assert.equal(textOf(again.editors.statusLive[0].doc), "A different campaign");
    const first = again.view().journals.find((j) => j.id !== again.view().currentId)!;
    assert.equal(textOf((await s.store.get(first.id))!.status), "HP 12 · Supplies 3");
  });

  test("folders, commands, bags and recent oracles are the journal's own, and saved with it", async () => {
    const s = setup();
    await s.session.start();
    s.session.setFolders(["Starforged", "Starforged", "Dungeon"]);
    s.session.setCommands([{ name: "feeling", steps: [{ kind: "dice", expression: "2d6" }] }]);
    s.session.bags.set("deck", ["Ace"]);
    s.session.noteUsed("a");
    s.session.noteUsed("b");
    s.session.noteUsed("a");
    await s.session.flush();
    const j = (await s.store.get(s.view().currentId!))!;
    assert.deepEqual(j.folders, ["Dungeon", "Starforged"]);
    assert.equal(j.commands?.[0].name, "feeling");
    assert.deepEqual(j.bags, { deck: ["Ace"] });
    assert.deepEqual(j.recent, ["a", "b"]);
    await s.session.create();
    assert.deepEqual(s.view().folders, [], "a new journal inherited the folders");
    assert.deepEqual(s.session.bags.get("deck"), []);
  });

  test("the copy of the folders is saved with its journal; the same copy again saves nothing", async () => {
    const s = setup();
    await s.session.start();
    const copy = { saved: "2026-10-01T10:00:00.000Z", oracles: [{ id: "sky", name: "Sky", folder: "Weather", packed: { type: "list", name: "Sky", view: "wheel", items: [{ label: "Clear", weight: 1 }] } }] };
    s.session.setCopy(copy);
    await s.session.flush();
    const id = s.view().currentId!;
    const j = (await s.store.get(id))!;
    assert.deepEqual(j.copy, copy);
    s.session.setCopy(s.session.copy);
    assert.equal(s.session.dirty, false, "setting the same copy again counted as a change");
    s.session.setCopy(null);
    await s.session.flush();
    assert.equal((await s.store.get(id))!.copy, undefined);
  });

  test("a journal file opens as a copy beside the one already here, or replaces it", async () => {
    const s = setup();
    await s.session.start();
    s.editors.type("original");
    const file = (await s.session.current())!;
    file.doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "from the file" }] }] };
    assert.equal(await s.session.importJournal(file, "copy"), true);
    assert.equal(s.view().journals.length, 2);
    assert.equal(s.view().title, `${UNTITLED} 2`);
    assert.notEqual(s.view().currentId, file.id);
    assert.equal(await s.session.importJournal(file, "replace"), true);
    assert.equal(s.view().journals.length, 2);
    assert.equal(s.view().currentId, file.id);
    assert.equal(textOf(s.editors.live.at(-1)!.doc), "from the file");
    assert.equal(await s.session.importJournal({ hello: "world" }), false);
    assert.match(s.view().problem!, /not a Sekwe journal/);
  });

  test("the menu lists the journal just saved first", async () => {
    const s = setup();
    await s.session.start();
    const first = s.view().currentId;
    await s.session.create();
    await s.session.open(first!);
    s.editors.type("touched");
    await s.session.flush();
    assert.equal(s.view().journals[0].id, first);
  });
});

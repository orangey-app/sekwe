import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Session, type MakeEditor, type SessionView } from "../../src/lib/session.ts";
import { MemoryStore } from "../../src/lib/store.ts";
import { UNTITLED, type DocJSON } from "../../src/lib/journal.ts";

/** An editor stand-in: holds a document, and "typing" replaces its text. */
function fakeEditors() {
  const live: { doc: DocJSON; onChange: () => void; destroyed: boolean }[] = [];
  const make: MakeEditor = (doc, onChange) => {
    const e = { doc: structuredClone(doc), onChange, destroyed: false };
    live.push(e);
    return { getJSON: () => structuredClone(e.doc), destroy: () => void (e.destroyed = true) } as ReturnType<MakeEditor>;
  };
  const type = (text: string) => {
    const e = live[live.length - 1];
    e.doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
    e.onChange();
  };
  return { make, type, live };
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

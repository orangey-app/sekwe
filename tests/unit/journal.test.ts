import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { byRecent, cleanTitle, freshTitle, isJournal, newJournal, summarize, TITLE_MAX, UNTITLED } from "../../src/lib/journal.ts";
import { MemoryStore } from "../../src/lib/store.ts";

describe("a journal", () => {
  test("starts empty, named, stamped, and with an id of its own", () => {
    const a = newJournal("The Drowned Coast", new Date("2026-10-01T09:00:00Z"));
    const b = newJournal();
    assert.equal(a.title, "The Drowned Coast");
    assert.equal(a.created, "2026-10-01T09:00:00.000Z");
    assert.equal(a.modified, a.created);
    assert.deepEqual(a.doc, { type: "doc", content: [{ type: "paragraph" }] });
    assert.equal(b.title, UNTITLED);
    assert.notEqual(a.id, b.id);
    assert.ok(isJournal(a));
  });

  test("a title is one line, trimmed and capped, and never empty", () => {
    assert.equal(cleanTitle("  Act  one\n  the  ship "), "Act one the ship");
    assert.equal(cleanTitle("   "), UNTITLED);
    assert.equal(cleanTitle("x".repeat(500)).length, TITLE_MAX);
  });

  test("a new journal's name does not repeat one already taken", () => {
    assert.equal(freshTitle([]), UNTITLED);
    assert.equal(freshTitle([UNTITLED]), `${UNTITLED} 2`);
    assert.equal(freshTitle([UNTITLED, `${UNTITLED} 2`, `${UNTITLED} 4`]), `${UNTITLED} 3`);
  });

  test("the menu lists newest first, and equal times by title", () => {
    const rows = [
      { id: "1", title: "B", modified: "2026-10-01T10:00:00Z" },
      { id: "2", title: "A", modified: "2026-10-01T10:00:00Z" },
      { id: "3", title: "C", modified: "2026-10-02T10:00:00Z" },
    ];
    assert.deepEqual(rows.sort(byRecent).map((r) => r.title), ["C", "A", "B"]);
  });

  test("a stored journal from a newer Sekwe still opens, keeping what this one does not know", () => {
    const j = { ...newJournal("Later"), formatVersion: 7, mood: "stormy" };
    assert.ok(isJournal(j));
    assert.equal(isJournal({ ...j, doc: { type: "paragraph" } }), false);
    assert.equal(isJournal({ ...j, format: "orangey" }), false);
    assert.equal(isJournal(null), false);
  });
});

describe("the journal store (memory)", () => {
  test("keeps journals apart, lists them newest first, and remembers the last one open", async () => {
    const store = new MemoryStore();
    const a = newJournal("First", new Date("2026-10-01T09:00:00Z"));
    const b = newJournal("Second", new Date("2026-10-01T10:00:00Z"));
    await store.put(a);
    await store.put(b);
    assert.deepEqual(await store.list(), [summarize(b), summarize(a)]);
    assert.equal((await store.get(a.id))?.title, "First");
    assert.equal(await store.get("nope"), null);
    assert.equal(await store.lastOpen(), null);
    await store.setLastOpen(a.id);
    assert.equal(await store.lastOpen(), a.id);
  });

  test("hands out copies, so an edit is not saved until it is put", async () => {
    const store = new MemoryStore();
    const a = newJournal("Copy");
    await store.put(a);
    const got = (await store.get(a.id))!;
    got.title = "Changed";
    assert.equal((await store.get(a.id))?.title, "Copy");
  });
});

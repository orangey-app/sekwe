import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileStem, rollNote, toFile, toHtml, toMarkdown } from "../../src/lib/export.ts";
import { isJournal, newJournal, type DocJSON } from "../../src/lib/journal.ts";
import type { RollRecord } from "../../src/lib/rolls.ts";

const at = "2026-10-01T12:00:00.000Z";
const weather: RollRecord = {
  source: { kind: "oracle", id: "w", name: "Weather", version: "v1" },
  results: [
    { text: "Rain", at },
    { text: "Fog", at },
  ],
};
const dice: RollRecord = { source: { kind: "dice", expression: "2d6" }, results: [{ text: "7", detail: "2d6 [3, 4] = 7", at }] };

const doc: DocJSON = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "The sky was " },
        { type: "roll", attrs: { record: weather } },
        { type: "text", text: " and the dice said " },
        { type: "roll", attrs: { record: dice } },
        { type: "text", text: "." },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "loud", marks: [{ type: "bold" }] }, { type: "text", text: " and " }, { type: "text", text: "marked", marks: [{ type: "highlight", attrs: { highlight: "yellow" } }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "rope" }] }] }] },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Qty" }] }] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Torch" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "3" }] }] }] },
      ],
    },
    { type: "inkblot", attrs: { blot: 4242, from: "Inkblot" } },
  ],
};

function journal() {
  const j = newJournal("The Drowned Coast", new Date(at));
  j.doc = doc;
  j.status = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "HP 12" }] }] };
  return j;
}

describe("exporting a journal", () => {
  test("Markdown has the title, chapters, styles, lists, tables, rolls as their words, and a footnote per roll", () => {
    const md = toMarkdown(journal());
    assert.match(md, /^# The Drowned Coast\n/);
    assert.match(md, /\n# Chapter One\n/);
    assert.match(md, /The sky was Fog\[\^1\] and the dice said 7\[\^2\]\./);
    assert.match(md, /\*\*loud\*\* and ==marked==/);
    assert.match(md, /\n- rope\n/);
    assert.match(md, /\| Item \| Qty \|\n\| --- \| --- \|\n\| Torch \| 3 \|/);
    assert.match(md, /\*\[Inkblot #4242\]\*/);
    assert.match(md, /## Status\n\nHP 12/);
    assert.match(md, /\[\^1\]: Weather; earlier: Rain\n\[\^2\]: 2d6; 2d6 \[3, 4\] = 7\n$/);
  });

  test("notes and the status panel can be left out", () => {
    const md = toMarkdown(journal(), { notes: false, status: false });
    assert.match(md, /The sky was Fog and the dice said 7\./);
    assert.doesNotMatch(md, /\[\^|Status|HP 12/);
  });

  test("HTML is a page of its own: escaped, styled, with numbered notes", () => {
    const j = journal();
    j.title = "Salt & <Iron>";
    const html = toHtml(j);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<title>Salt &amp; &lt;Iron&gt;<\/title>/);
    assert.match(html, /<h2>Chapter One<\/h2>/, "a chapter sits under the page's own title");
    assert.match(html, /<span class="roll">Fog<\/span><sup><a href="#note-1" id="ref-1">1<\/a><\/sup>/);
    assert.match(html, /<mark class="hl-yellow">marked<\/mark>/);
    assert.match(html, /<th><p>Item<\/p><\/th>/);
    assert.match(html, /<li id="note-1">Weather; earlier: Rain/);
    assert.doesNotMatch(html, /<script/);
  });

  test("a picked roll says so in its note", () => {
    const picked: RollRecord = { ...weather, results: [{ text: "Sun", picked: true, detail: "chosen from Sun, Rain", at }] };
    assert.equal(rollNote(picked), "Weather, picked");
  });

  test("the journal file is the journal itself, and reads back as one", () => {
    const j = journal();
    const back = JSON.parse(toFile(j));
    assert.ok(isJournal(back));
    assert.deepEqual(back, j);
    assert.equal(fileStem("The Drowned Coast: Ändern!"), "the-drowned-coast-andern");
    assert.equal(fileStem("???"), "journal");
  });
});

describe("credit for packs", () => {
  const pack = { title: "Delve", author: "A. Writer", version: "1.0", licence: "CC BY 4.0", homepage: "https://example.org/delve" };
  const fromPack = (text: string): RollRecord => ({ source: { kind: "oracle", id: "t", name: "Theme", version: "v", pack }, results: [{ text, at }] });
  const j = { ...newJournal("Credits"), doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "roll", attrs: { record: fromPack("Ancient") } }, { type: "text", text: " and " }, { type: "roll", attrs: { record: fromPack("Hallowed") } }] }] } as DocJSON };

  test("each pack rolled is credited once at the end, with its web page", () => {
    const md = toMarkdown(j, { notes: false });
    assert.equal(md.match(/Oracles from/g)?.length, 1);
    assert.match(md, /---\n\nOracles from Delve by A\. Writer · v1\.0 · CC BY 4\.0 \(<https:\/\/example\.org\/delve>\)\.\n$/);
    const html = toHtml(j);
    assert.match(html, /<p class="credits">Oracles from Delve by A\. Writer · v1\.0 · CC BY 4\.0 \(<a href="https:\/\/example\.org\/delve">web page<\/a>\)\.<\/p>/);
  });

  test("no packs, no credit line; a homepage that is not a web address is not made a link", () => {
    assert.doesNotMatch(toMarkdown({ ...j, doc: doc }), /Oracles from/);
    const odd = { ...j, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "roll", attrs: { record: { ...fromPack("x"), source: { ...fromPack("x").source, pack: { ...pack, homepage: "javascript:alert(1)" } } } } }] }] } as DocJSON };
    assert.doesNotMatch(toHtml(odd), /javascript:/);
    assert.doesNotMatch(toMarkdown(odd), /javascript:/);
  });
});

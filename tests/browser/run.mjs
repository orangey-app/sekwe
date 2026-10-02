/**
 * Browser tests: the built app in headless Chromium, driven over the DevTools
 * protocol by the harness copied from Orangey (vendor/orangey/tests/browser).
 *
 *   npm run build && npm run test:browser
 *
 * Each test gets a browser context of its own, so storage starts empty and a
 * reload inside a test keeps what was stored.
 */

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve } from "../../vendor/orangey/tests/browser/cdp.mjs";
import { serveBoth } from "../../scripts/serve-both.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dist = join(root, "dist");
if (!existsSync(join(dist, "index.html")) || !existsSync(join(dist, "sekwe.html"))) {
  console.error("dist/ is missing or incomplete: run npm run build first");
  process.exit(1);
}

const TEST_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS ?? 45000);
const browser = await launch();
const server = await serve(dist);
const results = [];

async function test(name, fn) {
  if (process.env.CI) console.log(`# → ${name}`);
  const page = await browser.newPage();
  const started = Date.now();
  let timer;
  try {
    await Promise.race([
      fn(page),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the test did not finish within ${TEST_TIMEOUT_MS / 1000}s`)), TEST_TIMEOUT_MS);
      }),
    ]);
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok ${results.length} - ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`not ok ${results.length} - ${name}`);
    console.log(`  ${error.message.split("\n").join("\n  ")}`);
    if (page.consoleErrors.length) console.log(`  page errors: ${page.consoleErrors.slice(0, 3).join(" | ")}`);
  } finally {
    clearTimeout(timer);
    await page.close().catch(() => {});
  }
}

// --- helpers ------------------------------------------------------------------

const open = (page, base = `${server.origin}/`) => page.goto(`${base}index.html?debug`).then(() => ready(page));
const ready = (page) => page.waitForFunction("window.sekwe && document.querySelector('.app.ready') && window.sekwe.editor");

/** Real key events, one character at a time, as a person types. */
async function typeText(page, text, { pauseEvery = 0, pauseMs = 0 } = {}) {
  await page.evaluate(`window.sekwe.editor.commands.focus("end")`);
  // Tiptap moves the focus on the next frame; keys sent before that land elsewhere.
  await page.waitForFunction(`document.activeElement === document.querySelector(".page")`);
  let n = 0;
  for (const ch of text) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, unmodifiedText: ch });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    if (pauseEvery && ++n % pauseEvery === 0) await new Promise((r) => setTimeout(r, pauseMs));
  }
}

const pageText = (page) => page.evaluate(`return document.querySelector(".page").textContent`);
const saved = (page) =>
  page.waitForFunction(`document.querySelector(".status").dataset.status === "saved" && !window.sekwe.session.dirty`);
/** The journal as stored in IndexedDB, read past the app. */
const storedText = (page, id) =>
  page.evaluate(`
    const id = ${id ? JSON.stringify(id) : "window.sekwe.session.view().currentId"};
    const j = await window.sekwe.store.get(id);
    const walk = (n) => (n.text ?? "") + (n.content ?? []).map(walk).join("");
    return walk(j.doc);
  `);

async function workerActive(page) {
  return page.evaluate(`
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return "none";
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (reg.active && reg.active.state === "activated") return "activated";
      await new Promise((r) => setTimeout(r, 50));
    }
    return "timeout";
  `);
}

// --- tests --------------------------------------------------------------------

await test("A first visit opens an empty journal, and what is typed comes back after a reload", async (page) => {
  await open(page);
  assert.equal(await page.evaluate(`return document.querySelector(".title").value`), "Untitled journal");
  await typeText(page, "The lighthouse keeper lied.");
  await saved(page);
  assert.equal(await storedText(page), "The lighthouse keeper lied.");
  await open(page);
  assert.equal(await pageText(page), "The lighthouse keeper lied.");
  assert.deepEqual(page.consoleErrors, []);
});

await test("A the title is saved like the text, and Enter goes back to the page", async (page) => {
  await open(page);
  await page.type(".title", "  Salt  and Iron ");
  await saved(page);
  await page.evaluate(`document.querySelector(".title").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await page.waitForFunction(`document.activeElement === document.querySelector(".page")`);
  await open(page);
  assert.equal(await page.evaluate(`return document.querySelector(".title").value`), "Salt and Iron");
});

await test("B a new journal is made and switched to in place, and each keeps its own words and its own undo", async (page) => {
  await open(page);
  await typeText(page, "First campaign.");
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="new"]');
  await page.waitForFunction(`document.querySelector(".title").value === "Untitled journal 2"`);
  assert.equal(await page.evaluate(`return document.activeElement === document.querySelector(".title")`), true, "the new title is not ready to be named");
  assert.equal(await pageText(page), "");
  assert.equal(await page.evaluate(`return document.querySelector('[aria-label^="Undo"]').disabled`), true, "Undo could reach the other journal");
  await typeText(page, "Second campaign.");
  await saved(page);

  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="open"]');
  const rows = await page.evaluate(`return [...document.querySelectorAll(".sub-menu .menu-item.recent .name")].map((e) => e.textContent)`);
  assert.deepEqual(rows, ["Untitled journal 2", "Untitled journal"], "newest first");
  await page.evaluate(`[...document.querySelectorAll(".sub-menu .menu-item.recent")].find((e) => e.querySelector(".name").textContent === "Untitled journal").click()`);
  await page.waitForFunction(`document.querySelector(".page").textContent === "First campaign."`);

  // Reopening comes back to the journal used last.
  await open(page);
  assert.equal(await pageText(page), "First campaign.");
  assert.equal(await page.evaluate(`return document.querySelector(".title").value`), "Untitled journal");
});

await test("C no keystroke is lost while saves run in the middle of typing", async (page) => {
  await open(page);
  const text = "Rain on the deck. The captain counts the barrels twice, and the second count is short by one. ".repeat(4);
  // Pauses longer than the save delay, so saves land between bursts of typing.
  await typeText(page, text, { pauseEvery: 60, pauseMs: 650 });
  await saved(page);
  assert.equal(await pageText(page), text, "the page lost characters");
  assert.equal(await storedText(page), await pageText(page), "what was stored differs from the page");
});

/**
 * A stand-in for Chrome's save and open pickers, giving real files in the
 * page's own private storage (OPFS): they can be written, kept in IndexedDB
 * across a reload, and read back. Counts how often each picker was shown.
 */
const fakePickers = (page) =>
  page.evaluate(`
    window.__picked = { save: 0, open: 0 };
    const dir = () => navigator.storage.getDirectory();
    window.showSaveFilePicker = async ({ suggestedName }) => {
      window.__picked.save++;
      return (await dir()).getFileHandle(window.__saveAs ?? suggestedName, { create: true });
    };
    window.showOpenFilePicker = async () => {
      window.__picked.open++;
      return [await (await dir()).getFileHandle(window.__openName)];
    };
  `);
const fileText = (page, name) => page.evaluate(`return await (await (await (await navigator.storage.getDirectory()).getFileHandle(${JSON.stringify(name)})).getFile()).text()`);
const ctrlS = async (page, shift = false) => {
  const modifiers = 2 | (shift ? 8 : 0);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: shift ? "S" : "s", code: "KeyS", modifiers, windowsVirtualKeyCode: 83 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: shift ? "S" : "s", code: "KeyS", modifiers, windowsVirtualKeyCode: 83 });
};

await test("C Ctrl+S saves the journal to its file: it asks where once, then writes there, also after a reload; Save as asks again", async (page) => {
  await open(page);
  await fakePickers(page);
  await typeText(page, "Now.");
  await ctrlS(page);
  await page.waitForFunction(`/Saved to untitled-journal\\.sekwe\\.json/.test(document.querySelector(".toast")?.textContent ?? "")`);
  assert.equal(await pageText(page), "Now.", "Ctrl+S typed into the page");
  assert.match(await fileText(page, "untitled-journal.sekwe.json"), /"text": "Now\."/);
  // Saved in the browser at once too, not after the pause.
  await saved(page);

  // The menu names the file, and Save writes to it without asking.
  await page.click(".file-menu .menu-button");
  assert.equal(await page.evaluate(`return document.querySelector('.file-menu [data-action="save"] .save-label').textContent.trim()`), "Save to untitled-journal.sekwe.json");
  await page.click('.file-menu [data-action="save"]');
  await page.waitForFunction(`window.__picked.save === 1 && /Saved to/.test(document.querySelector(".toast")?.textContent ?? "")`);
  await typeText(page, " Then.");
  await ctrlS(page);
  await page.waitForFunction(`document.querySelector(".toast")?.textContent.startsWith("Saved to")`);
  for (let i = 0; i < 40 && !/Now\. Then\./.test(await fileText(page, "untitled-journal.sekwe.json")); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(await fileText(page, "untitled-journal.sekwe.json"), /Now\. Then\./);
  assert.equal(await page.evaluate(`return window.__picked.save`), 1, "Save asked where again");

  // After a reload the journal still belongs to its file.
  await open(page);
  await fakePickers(page);
  await page.evaluate(`window.sekwe.editor.commands.focus("end")`);
  await typeText(page, " Later.");
  await ctrlS(page);
  for (let i = 0; i < 40 && !/Later\./.test(await fileText(page, "untitled-journal.sekwe.json")); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(await fileText(page, "untitled-journal.sekwe.json"), /Now\. Then\. Later\./);
  assert.equal(await page.evaluate(`return window.__picked.save`), 0, "after a reload, Save asked where");

  // Save as (Ctrl+Shift+S) asks, and the new file is the journal's from then on.
  await page.evaluate(`window.__saveAs = "second.sekwe.json"`);
  await ctrlS(page, true);
  await page.waitForFunction(`window.__picked.save === 1 && /second/.test(document.querySelector(".toast")?.textContent ?? "")`);
  await page.click(".file-menu .menu-button");
  assert.match(await page.evaluate(`return document.querySelector('.file-menu [data-action="save"]').textContent`), /Save to second\.sekwe\.json/);
  assert.deepEqual(page.consoleErrors, []);
});

await test("C a journal opened from its file saves back to that file; kept as a copy, it does not", async (page) => {
  await open(page);
  await fakePickers(page);
  await typeText(page, "Original.");
  await ctrlS(page);
  await page.waitForFunction(`document.querySelector(".toast")?.textContent.startsWith("Saved to")`);
  // A new journal, then the file opened again: it is the journal already here.
  await page.evaluate(`window.__openName = "untitled-journal.sekwe.json"`);
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="open"]');
  await page.click('.file-menu [data-action="browse"]');
  await page.waitForFunction(`document.querySelector(".dialog [data-choice=copy]")`);
  await page.click(".dialog [data-choice=copy]");
  await page.waitForFunction(`window.sekwe.session.view().journals.length === 2`);
  // The copy has no file: the menu offers to choose one, and Save asks.
  await page.click(".file-menu .menu-button");
  await page.waitForFunction(`document.querySelector('.file-menu [data-action="save"] .save-label')?.textContent.trim() === "Save to a file…"`);
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);

  // A journal file that is not here yet: opened, it belongs to its file.
  const other = await page.evaluate(`
    const j = { ...(await window.sekwe.session.current()), id: "from-disk", title: "From disk" };
    const h = await (await navigator.storage.getDirectory()).getFileHandle("from-disk.sekwe.json", { create: true });
    const w = await h.createWritable(); await w.write(JSON.stringify(j)); await w.close();
    window.__openName = "from-disk.sekwe.json";
    return j.id;`);
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="open"]');
  await page.click('.file-menu [data-action="browse"]');
  await page.waitForFunction(`window.sekwe.session.view().currentId === ${JSON.stringify(other)}`);
  await page.evaluate(`window.sekwe.editor.commands.focus("end")`);
  await typeText(page, " Edited.");
  await ctrlS(page);
  for (let i = 0; i < 40 && !/Edited\./.test(await fileText(page, "from-disk.sekwe.json")); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(await fileText(page, "from-disk.sekwe.json"), /Edited\./);
  assert.equal(await page.evaluate(`return window.__picked.save`), 1, "saving a journal opened from its file asked where");
  assert.deepEqual(page.consoleErrors, []);
});

await test("C without a file picker (Firefox, Safari), Save as asks for a name and downloads under it", async (page) => {
  await open(page);
  await typeText(page, "Plain.");
  const dir = join(root, ".tmp", "nopicker");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await page.evaluate(`delete window.showSaveFilePicker; window.showSaveFilePicker = undefined; delete window.showOpenFilePicker; window.showOpenFilePicker = undefined;`);
  await page.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
  await page.click(".file-menu .menu-button");
  assert.equal(await page.evaluate(`return document.querySelector('.file-menu [data-action="save"] .save-label').textContent.trim()`), "Download a copy");
  await page.click('.file-menu [data-action="saveas"]');
  await page.waitForFunction(`document.querySelector(".dialog .file-name")`);
  await page.evaluate(`
    const input = document.querySelector(".dialog .file-name");
    input.value = "My Campaign";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".dialog [data-choice=save]").click();`);
  const file = join(dir, "My Campaign.sekwe.json");
  for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(existsSync(file), "nothing was downloaded under the name given");
  assert.match(readFileSync(file, "utf8"), /Plain\./);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(page.consoleErrors, []);
});

await test("D the app opens offline once visited, with its caches all named sekwe-", async (page) => {
  await open(page);
  assert.equal(await workerActive(page), "activated", "the offline worker never installed");
  await typeText(page, "Written before the storm.");
  await saved(page);
  await page.setOffline(true);
  try {
    await open(page);
    assert.equal(await pageText(page), "Written before the storm.");
  } finally {
    await page.setOffline(false);
  }
  const caches = await page.evaluate(`return await caches.keys()`);
  assert.ok(caches.length > 0, "nothing was cached");
  assert.deepEqual(caches.filter((k) => !k.startsWith("sekwe-")), [], `a cache without the prefix: ${caches}`);
});

await test("E the app works from a deep folder, where it may be published", async (page) => {
  const nest = join(root, ".tmp", "deep");
  rmSync(nest, { recursive: true, force: true });
  mkdirSync(join(nest, "tools", "games"), { recursive: true });
  cpSync(dist, join(nest, "tools", "games", "sekwe"), { recursive: true });
  const sub = await serve(nest);
  try {
    const base = `${sub.origin}/tools/games/sekwe/`;
    await open(page, base);
    const styled = await page.evaluate(`return getComputedStyle(document.querySelector(".topbar")).display`);
    assert.equal(styled, "flex", "the stylesheet did not load from the folder");
    assert.equal(await workerActive(page), "activated", "the offline worker never installed from the folder");
    const scope = await page.evaluate(`return new URL((await navigator.serviceWorker.getRegistration()).scope).pathname`);
    assert.equal(scope, "/tools/games/sekwe/");
    await typeText(page, "Deep.");
    await saved(page);
    await page.setOffline(true);
    try {
      await open(page, base);
      assert.equal(await pageText(page), "Deep.");
    } finally {
      await page.setOffline(false);
    }
  } finally {
    await sub.close();
    rmSync(nest, { recursive: true, force: true });
  }
});

await test("F the single file runs from disk and keeps what is written", async (page) => {
  const file = `file://${join(dist, "sekwe.html")}?debug`;
  await page.goto(file);
  await ready(page);
  await typeText(page, "From a USB stick.");
  await saved(page);
  await page.goto(file);
  await ready(page);
  assert.equal(await pageText(page), "From a USB stick.");
  assert.equal(await page.evaluate(`return document.querySelectorAll("script[src], link[rel=stylesheet]").length`), 0, "the single file loads something from outside itself");
  assert.deepEqual(page.consoleErrors, []);
});

// --- rolling from the Orangey library --------------------------------------------

const ORACLES = {
  "Starforged/Weather.orangey.json": { id: "weather", type: "list", name: "Weather", view: "wheel", items: ["Rain", "Sun", "Fog"].map((label, i) => ({ id: `w${i}`, label, weight: 1 })) },
  "Starforged/NPC.orangey.json": { id: "npc", type: "list", name: "NPC Role", view: "wheel", items: ["Smuggler", "Pilot"].map((label, i) => ({ id: `n${i}`, label, weight: 1, goesTo: "motive" })) },
  "Starforged/Motive.orangey.json": { id: "motive", type: "list", name: "NPC Motive", view: "list", items: ["Greed", "Debt"].map((label, i) => ({ id: `m${i}`, label, weight: 1 })) },
  "Inkblot.orangey.json": { id: "ink", type: "inkblot", name: "Inkblot" },
  "Tonight.orangey.json": { id: "board", type: "board", name: "Tonight", entries: [{ id: "weather", name: "Weather" }] },
};

/** Writes randomizer files where Orangey keeps a browser library: the origin's own filesystem, folder "library". */
async function seedLibrary(page, files = ORACLES) {
  await page.evaluate(`
    const files = ${JSON.stringify(files)};
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("library", { create: true });
    for (const [path, r] of Object.entries(files)) {
      const parts = path.split("/");
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const at = "2026-10-01T09:00:00.000Z";
      const file = await dir.getFileHandle(parts.at(-1), { create: true });
      const w = await file.createWritable();
      await w.write(JSON.stringify({ format: "orangey", version: 1, randomizer: { created: at, modified: at, ...r } }, null, 2));
      await w.close();
    }
  `);
}

const openSeeded = async (page, seed = "sekwe") => {
  await page.goto(`${server.origin}/index.html?debug&seed=${seed}`);
  await ready(page);
  await page.waitForFunction(`window.sekwe.library.status !== "idle"`);
};

async function press(page, key, { alt = false, ctrl = false } = {}) {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 }[key];
  const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0);
  const text = key === "Enter" ? "\r" : undefined;
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: vk, ...(text && !alt && !ctrl ? { text } : {}) });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: vk });
}

/** A real mouse click on the middle of an element, as a person would. */
async function clickOn(page, selector) {
  const box = await page.evaluate(`
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  `);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  }
}

const chips = (page) =>
  page.evaluate(`
    const out = [];
    window.sekwe.editor.state.doc.descendants((n) => {
      if (n.type.name === "roll") out.push(n.attrs.record);
    });
    return out;
  `);
const currentText = (record) => record.results.at(-1).text;

async function slashRoll(page, query) {
  await typeText(page, `/${query}`);
  await page.waitForFunction(`document.querySelector(".slash-menu .slash-item")`);
  await press(page, "Enter");
}

await test("G the library is read where Orangey keeps it: oracles, not boards, with the count in the panel", async (page) => {
  await open(page);
  await seedLibrary(page);
  await openSeeded(page);
  assert.equal(await page.evaluate(`return window.sekwe.library.status`), "ready");
  assert.deepEqual(await page.evaluate(`return window.sekwe.library.oracles.map((o) => o.name).sort()`), ["Inkblot", "NPC Motive", "NPC Role", "Weather"]);
  await page.click("#tab-oracles");
  const names = await page.evaluate(`return [...document.querySelectorAll(".oracle-tree .oracle-button")].map((b) => b.textContent)`);
  assert.deepEqual(names, ["Inkblot", "NPC Motive", "NPC Role", "Weather"]);
  assert.deepEqual(await page.evaluate(`return [...document.querySelectorAll(".oracle-tree .group-head")].map((b) => b.textContent)`), ["Starforged"]);
});

await test("G / and part of a name rolls the oracle into the text, and the journal keeps a copy of it", async (page) => {
  await open(page);
  await seedLibrary(page);
  await openSeeded(page);
  await typeText(page, "The sky: ");
  await typeText(page, "/wea");
  await page.waitForFunction(`document.querySelector(".slash-menu .slash-item .slash-main")?.textContent === "Weather"`);
  assert.equal(await page.evaluate(`return document.querySelector(".slash-menu .slash-aside").textContent`), "Starforged");
  await press(page, "Enter");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  assert.equal(await page.evaluate(`return document.querySelector(".slash-menu")`), null, "the menu stayed open");
  const [record] = await chips(page);
  assert.ok(["Rain", "Sun", "Fog"].includes(currentText(record)), currentText(record));
  assert.equal(await pageText(page), `The sky: ${currentText(record)}`, "the typed /wea was left in the text");
  await saved(page);
  const stored = await page.evaluate(`return (await window.sekwe.store.get(window.sekwe.session.view().currentId))`);
  assert.deepEqual(Object.keys(stored.oracles), [`weather@${record.source.version}`]);
  // And back after a reload, as the same chip.
  await openSeeded(page);
  assert.deepEqual(await chips(page), [record]);
  assert.deepEqual(page.consoleErrors, []);
});

await test("G dice roll by expression, and a name that matches nothing says so without eating Enter", async (page) => {
  await open(page);
  await seedLibrary(page);
  await openSeeded(page);
  await slashRoll(page, "2d6");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  const total = Number(currentText((await chips(page))[0]));
  assert.ok(total >= 2 && total <= 12, String(total));
  await typeText(page, " /zzz");
  await page.waitForFunction(`document.querySelector(".slash-item[data-kind=note]")?.textContent.includes("No oracle matches")`);
  await press(page, "Escape");
  await page.waitForFunction(`!document.querySelector(".slash-menu")`);
});

await test("H Alt+R rolls the last oracle again at the cursor; on a selected chip it re-rolls in place and keeps the history", async (page) => {
  await open(page);
  await seedLibrary(page);
  await openSeeded(page);
  await slashRoll(page, "weather");
  await page.waitForFunction(`document.querySelectorAll(".page .chip").length === 1`);
  await typeText(page, " then ");
  await press(page, "r", { alt: true });
  await page.waitForFunction(`document.querySelectorAll(".page .chip").length === 2`);
  assert.doesNotMatch(await pageText(page), /®|r$/, "Alt+R typed a character");

  await clickOn(page, ".page .chip");
  await page.waitForFunction(`document.querySelector(".chip-popover")`);
  const before = (await chips(page))[0];
  await press(page, "r", { alt: true });
  await page.waitForFunction(`document.querySelector(".page .chip").dataset.rerolled === "1"`);
  const after = (await chips(page))[0];
  assert.equal(after.results.length, 2);
  assert.deepEqual(after.results[0], before.results[0], "the first result was not kept");
  assert.equal((await chips(page)).length, 2, "re-rolling added a chip");
  // The pop-up lists both results, newest first.
  await page.waitForFunction(`document.querySelectorAll(".chip-popover .history li").length === 2`);
  await saved(page);
  await openSeeded(page);
  assert.equal((await chips(page))[0].results.length, 2, "the history did not survive a reload");
});

await test("H a chain: the result offers the oracle it goes to, and Alt+N rolls it, never by itself", async (page) => {
  await open(page);
  await seedLibrary(page);
  await openSeeded(page);
  await slashRoll(page, "npc role");
  await page.waitForFunction(`document.querySelector(".page .chip .chip-next")`);
  assert.equal(await page.evaluate(`return document.querySelector(".chip-next").textContent`), "→ NPC Motive");
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await chips(page)).length, 1, "the next oracle was rolled without being asked");
  await press(page, "n", { alt: true });
  await page.waitForFunction(`document.querySelectorAll(".page .chip").length === 2`);
  const [, next] = await chips(page);
  assert.equal(next.source.id, "motive");
  assert.ok(["Greed", "Debt"].includes(currentText(next)));
});

await test("I a wheel edited in Orangey rolls as edited once the tab is back, and a deleted one still re-rolls from the journal's copy", async (page) => {
  await open(page);
  await seedLibrary(page);
  await openSeeded(page);
  await slashRoll(page, "weather");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  const first = (await chips(page))[0];

  // Edited in Orangey (here, written straight into the library), then the tab comes back.
  await seedLibrary(page, { "Starforged/Weather.orangey.json": { ...ORACLES["Starforged/Weather.orangey.json"], items: [{ id: "s", label: "Snow", weight: 1 }] } });
  await page.evaluate(`window.dispatchEvent(new Event("focus"))`);
  await page.waitForFunction(`window.sekwe.library.byId("weather").randomizer.items[0].label === "Snow"`);
  assert.deepEqual((await chips(page))[0], first, "reading the library changed the text");
  await typeText(page, " ");
  await slashRoll(page, "weather");
  await page.waitForFunction(`document.querySelectorAll(".page .chip").length === 2`);
  assert.equal(currentText((await chips(page))[1]), "Snow");

  // Deleted from the library: the first chip still re-rolls, from its own version.
  await page.evaluate(`
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("library");
    await (await root.getDirectoryHandle("Starforged")).removeEntry("Weather.orangey.json");
  `);
  await new Promise((r) => setTimeout(r, 1100));
  await page.evaluate(`window.dispatchEvent(new Event("focus"))`);
  await page.waitForFunction(`window.sekwe.library.byId("weather") === null`);
  await clickOn(page, ".page .chip");
  await press(page, "r", { alt: true });
  await page.waitForFunction(`document.querySelector(".page .chip").dataset.rerolled === "1"`);
  assert.ok(["Rain", "Sun", "Fog"].includes(currentText((await chips(page))[0])), "the re-roll did not use the version the chip came from");
});

await test("J an inkblot lands as a small blot in the text, and Put in the text adds the picture below the paragraph", async (page) => {
  await open(page);
  await seedLibrary(page);
  await openSeeded(page);
  await typeText(page, "It looks like ");
  await slashRoll(page, "inkblot");
  await page.waitForFunction(`document.querySelector(".page .chip canvas.chip-blot")`);
  const [record] = await chips(page);
  const blot = record.results[0].blot;
  assert.ok(Number.isInteger(blot), "no blot number");
  const inked = await page.evaluate(`
    const c = document.querySelector(".chip-blot");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 120) dark++;
    return dark;
  `);
  assert.ok(inked > 20, "the thumbnail has no ink on it");
  await clickOn(page, ".page .chip");
  await page.waitForFunction(`document.querySelector(".chip-popover .put")`);
  await page.click(".chip-popover .put");
  await page.waitForFunction(`document.querySelector(".page figure.blot-picture")?.dataset.state === "drawn"`, 20000);
  const order = await page.evaluate(`return [...document.querySelector(".page").children].map((e) => e.tagName)`);
  // The empty paragraph after it is Tiptap's: there is always a line to go on writing on.
  assert.deepEqual(order, ["P", "FIGURE", "P"], "the picture is not below the paragraph");
  assert.match(await page.evaluate(`return document.querySelector("figure.blot-picture figcaption").textContent`), new RegExp(`#${blot}`));
  await saved(page);
  await openSeeded(page);
  await page.waitForFunction(`document.querySelector(".page figure.blot-picture")?.dataset.state === "drawn"`, 20000);
  assert.equal((await chips(page)).length, 1, "the chip went when the picture came");
});

await test("K opened from disk, it says it cannot see the library, and dice still roll", async (page) => {
  const file = `file://${join(dist, "sekwe.html")}?debug&seed=disk`;
  await page.goto(file);
  await ready(page);
  await page.click("#tab-oracles");
  assert.match(await page.evaluate(`return document.querySelector(".library-panel").textContent`), /opened from disk/);
  await slashRoll(page, "d20");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  assert.deepEqual(page.consoleErrors, []);
});

await test("L served beside Orangey, Sekwe rolls a wheel made in Orangey itself", async (page) => {
  const orangeyDist = join(root, "..", "orangey", "dist");
  if (!existsSync(join(orangeyDist, "index.html"))) {
    console.log("    (no Orangey build beside this folder: run npm run build in ../orangey; skipped)");
    return;
  }
  const both = serveBoth({ orangey: orangeyDist, sekwe: dist });
  await new Promise((r) => both.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${both.address().port}`;
  try {
    await page.goto(`${origin}/orangey/index.html?debug&noseed`);
    await page.waitForFunction("window.orangey && window.orangey.state.ready");
    await page.evaluate(`
      const { state } = window.orangey;
      const at = new Date().toISOString();
      await state.library.create("", { id: "made-in-orangey", type: "list", name: "Harbour Rumour", view: "wheel", created: at, modified: at,
        items: [{ id: "a", label: "The tide is late", weight: 1 }] });
      await state.library.flush();
    `);
    await page.goto(`${origin}/sekwe/index.html?debug`);
    await ready(page);
    await page.waitForFunction(`window.sekwe.library.status === "ready"`);
    await slashRoll(page, "harbour");
    await page.waitForFunction(`document.querySelector(".page .chip")`);
    assert.equal(currentText((await chips(page))[0]), "The tide is late");
  } finally {
    await new Promise((r) => both.close(r));
  }
});

// --- the second round: Tab, folders, picks, bags, commands, status, tables, styles, chapters, width, files ---

const MORE = {
  ...ORACLES,
  "Starforged/Ask.orangey.json": { id: "ask", type: "list", name: "Ask the Oracle", view: "list", offer: 3, items: ["Yes", "No", "Maybe", "Twist"].map((label, i) => ({ id: `a${i}`, label, weight: 1 })) },
  "Starforged/Deck.orangey.json": { id: "deck", type: "list", name: "Deck", view: "list", withoutReplacement: true, items: ["Ace", "King"].map((label, i) => ({ id: `d${i}`, label, weight: 1 })) },
};

const openMore = async (page) => {
  await open(page);
  await seedLibrary(page, MORE);
  await openSeeded(page);
};

await test("M Tab fills in what the matches share, then goes round the names; only Enter rolls", async (page) => {
  await openMore(page);
  await typeText(page, "/npc");
  await page.waitForFunction(`document.querySelectorAll(".slash-menu .slash-item").length === 2`);
  await press(page, "Tab");
  await page.waitForFunction(`document.querySelector(".page").textContent === "/NPC "`);
  await press(page, "Tab");
  await page.waitForFunction(`/^\\/NPC (Motive|Role)$/.test(document.querySelector(".page").textContent)`);
  const first = await pageText(page);
  await press(page, "Tab");
  await page.waitForFunction(`document.querySelector(".page").textContent !== ${JSON.stringify(first)}`);
  assert.equal((await chips(page)).length, 0, "Tab rolled something");
  await press(page, "Enter");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
});

await test("N a journal rolls only from the folders it is given, and keeps that choice", async (page) => {
  await openMore(page);
  await page.click("#tab-oracles");
  await page.click(".folders-line .link-button");
  await page.evaluate(`[...document.querySelectorAll(".folder-option")].find((l) => l.textContent.trim() === "Starforged").querySelector("input").click()`);
  await page.waitForFunction(`document.querySelector(".folders-now").textContent.trim() === "Starforged"`);
  assert.equal(await page.evaluate(`return [...document.querySelectorAll(".oracle-button")].some((b) => b.textContent === "Inkblot")`), false, "an oracle outside the folder is listed");
  await typeText(page, "/inkbl");
  await page.waitForFunction(`document.querySelector(".slash-item[data-kind=note]")`);
  await press(page, "Escape");
  await saved(page);
  await openSeeded(page);
  assert.deepEqual(await page.evaluate(`return window.sekwe.session.view().folders`), ["Starforged"]);
});

await test("N an oracle clicked in the panel rolls at the cursor, and recent oracles come first", async (page) => {
  await openMore(page);
  await typeText(page, "Outside: ");
  await page.click("#tab-oracles");
  await page.evaluate(`document.querySelector('.oracle-button[data-id="weather"]').click()`);
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  assert.match(await pageText(page), /^Outside: (Rain|Sun|Fog)$/);
  await typeText(page, " /");
  await page.waitForFunction(`document.querySelector(".slash-menu .slash-item")`);
  assert.equal(await page.evaluate(`return document.querySelector(".slash-menu .slash-main").textContent`), "Weather");
  await press(page, "Escape");
});

await test("N a word just written moves the oracle it names up the menu", async (page) => {
  await openMore(page);
  await typeText(page, "Her motive is ");
  await typeText(page, "/npc");
  await page.waitForFunction(`document.querySelector(".slash-menu .slash-item")`);
  assert.equal(await page.evaluate(`return document.querySelector(".slash-menu .slash-main").textContent`), "NPC Motive");
  await press(page, "Escape");
});

await test("O a list that offers a choice shows it at the cursor, and the pick lands, marked as picked", async (page) => {
  await openMore(page);
  await slashRoll(page, "ask the");
  await page.waitForFunction(`document.querySelectorAll(".pick-menu .slash-item").length === 3`);
  const choices = await page.evaluate(`return [...document.querySelectorAll(".pick-menu .slash-main")].map((e) => e.textContent)`);
  await press(page, "2");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  const [record] = await chips(page);
  assert.equal(currentText(record), choices[1]);
  assert.equal(record.results[0].picked, true);
  assert.equal(await page.evaluate(`return document.querySelector(".pick-menu")`), null);
});

await test("O a bag gives each outcome once, and what it has given out is saved with the journal", async (page) => {
  await openMore(page);
  await slashRoll(page, "deck");
  await page.waitForFunction(`document.querySelectorAll(".page .chip").length === 1`);
  await typeText(page, " ");
  await slashRoll(page, "deck");
  await page.waitForFunction(`document.querySelectorAll(".page .chip").length === 2`);
  const texts = (await chips(page)).map(currentText).sort();
  assert.deepEqual(texts, ["Ace", "King"]);
  await saved(page);
  const bags = await page.evaluate(`return (await window.sekwe.store.get(window.sekwe.session.view().currentId)).bags`);
  assert.deepEqual([...bags.deck].sort(), ["Ace", "King"]);
});

await test("P a journal's own command rolls everything it lists, one chip each", async (page) => {
  await openMore(page);
  await page.click("#tab-commands");
  await page.click(".new-command");
  await page.type(".command-name-input", "feeling");
  for (const step of ["weather", "2d6"]) {
    await page.type(".step-input", step);
    await page.waitForFunction(`document.querySelector(".step-suggestions button")`);
    await page.evaluate(`document.querySelector(".step-suggestions button").click()`);
  }
  await page.evaluate(`document.querySelector(".command-form button[type=submit]").click()`);
  await page.waitForFunction(`document.querySelector(".command-list .command-name")?.textContent === "/feeling"`);
  await slashRoll(page, "feel");
  await page.waitForFunction(`document.querySelectorAll(".page .chip").length === 2`);
  const [a, b] = await chips(page);
  assert.equal(a.source.kind === "oracle" && a.source.id, "weather");
  assert.equal(b.source.kind === "dice" && b.source.expression, "2d6");
  await saved(page);
  await openSeeded(page);
  assert.equal((await page.evaluate(`return window.sekwe.session.view().commands`))[0].name, "feeling");
});

await test("Q the status panel keeps its own notes per journal, and rolls land there too", async (page) => {
  await openMore(page);
  await page.click("#tab-status");
  await page.evaluate(`window.sekwe.statusEditor.commands.focus("end")`);
  await page.waitForFunction(`document.activeElement === document.querySelector(".status-page")`);
  for (const ch of "Supplies: ") {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
  }
  for (const ch of "/2d6") {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
  }
  await page.waitForFunction(`document.querySelector(".slash-menu .slash-item")`);
  await press(page, "Enter");
  await page.waitForFunction(`document.querySelector(".status-page .chip")`);
  await saved(page);
  await openSeeded(page);
  assert.match(await page.evaluate(`return document.querySelector(".status-page").textContent`), /^Supplies: \d+$/);
  assert.equal(await pageText(page), "", "the status note leaked into the story");
});

await test("R a table goes in from the toolbar; Tab moves between cells, and rows are added", async (page) => {
  await openMore(page);
  await typeText(page, "Loot");
  await page.evaluate(`document.querySelector('[aria-label="Insert a table"]').click()`);
  await page.waitForFunction(`document.querySelector(".page table")`);
  // Straight into the first cell: no re-focusing, which would move the cursor to the end.
  const typeHere = async (t) => {
    for (const ch of t) {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    }
  };
  await typeHere("Item");
  await press(page, "Tab");
  await typeHere("Qty");
  await page.waitForFunction(`document.querySelector('[aria-label="Add a row below"]')`);
  await page.evaluate(`document.querySelector('[aria-label="Add a row below"]').click()`);
  const shape = await page.evaluate(`return [...document.querySelectorAll(".page table tr")].map((r) => r.children.length)`);
  assert.deepEqual(shape, [3, 3, 3, 3]);
  assert.deepEqual(await page.evaluate(`return [...document.querySelectorAll(".page table th")].slice(0, 2).map((c) => c.textContent)`), ["Item", "Qty"]);
  await saved(page);
  await openSeeded(page);
  assert.equal(await page.evaluate(`return document.querySelectorAll(".page table tr").length`), 4);
});

await test("S highlight, colour, size and typeface style the selection, and are kept", async (page) => {
  await openMore(page);
  await typeText(page, "danger ahead");
  await page.evaluate(`window.sekwe.editor.commands.setTextSelection({ from: 1, to: 7 })`);
  await page.click('[aria-label="Highlight"]');
  await page.click('[aria-label="Yellow highlight"]');
  await page.click('[aria-label="Text colour"]');
  await page.click('[aria-label="Red text"]');
  await page.evaluate(`const s = document.querySelector('[aria-label="Text size"]'); s.value = "large"; s.dispatchEvent(new Event("change", { bubbles: true }))`);
  await page.evaluate(`const s = document.querySelector('[aria-label="Typeface"]'); s.value = "mono"; s.dispatchEvent(new Event("change", { bubbles: true }))`);
  await page.waitForFunction(`document.querySelector(".page mark.hl-yellow")`);
  await saved(page);
  await openSeeded(page);
  const styled = await page.evaluate(`
    const el = document.querySelector(".page mark.hl-yellow");
    return { text: el.textContent, classes: [...document.querySelectorAll(".page [class]")].map((e) => e.className).join(" ") };
  `);
  assert.equal(styled.text, "danger");
  for (const cls of ["hl-yellow", "tc-red", "fs-large", "ff-mono"]) assert.match(styled.classes, new RegExp(cls));
});

await test("T chapters head the story, the contents list them, and a click jumps to one", async (page) => {
  await openMore(page);
  await typeText(page, "The Wreck");
  await page.evaluate(`document.querySelector('[aria-label^="Chapter heading"]').click()`);
  await page.waitForFunction(`document.querySelector(".page h1")`);
  await page.evaluate(`window.sekwe.editor.chain().focus("end").insertContent([{ type: "paragraph" }, { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "On the beach" }] }, { type: "paragraph", content: [{ type: "text", text: "Sand." }] }]).run()`);
  await page.click("#tab-contents");
  await page.waitForFunction(`document.querySelectorAll(".outline li").length === 2`);
  const rows = await page.evaluate(`return [...document.querySelectorAll(".outline li")].map((l) => [l.className, l.textContent.trim()])`);
  assert.deepEqual(rows, [["level-1", "The Wreck"], ["level-2", "On the beach"]]);
  await page.evaluate(`[...document.querySelectorAll(".outline button")][0].click()`);
  await page.waitForFunction(`window.sekwe.editor.state.selection.$from.parent.textContent === "The Wreck"`);
});

await test("U the page can be narrow, wide or full, and the choice is kept", async (page) => {
  await open(page);
  const width = () => page.evaluate(`return Math.round(document.querySelector(".page").getBoundingClientRect().width)`);
  assert.ok(await page.evaluate(`return document.querySelector(".app").classList.contains("width-wide")`), "wide is not the default");
  const wide = await width();
  await page.evaluate(`const s = document.querySelector(".width-select"); s.value = "narrow"; s.dispatchEvent(new Event("change", { bubbles: true }))`);
  await page.waitForFunction(`document.querySelector(".app").classList.contains("width-narrow")`);
  const narrow = await width();
  assert.ok(narrow < wide, `narrow ${narrow} is not narrower than wide ${wide}`);
  await open(page);
  assert.ok(await page.evaluate(`return document.querySelector(".app").classList.contains("width-narrow")`), "the width was not kept");
});

await test("V a journal saved as a file opens again: as a copy beside the original, or replacing it", async (page) => {
  await openMore(page);
  await typeText(page, "Saved words ");
  await slashRoll(page, "weather");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  const dir = join(root, ".tmp", "files");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Without the save picker (headless Chrome has no dialog), Save downloads the file.
  await page.evaluate(`delete window.showSaveFilePicker; window.showSaveFilePicker = undefined;`);
  await page.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="save"]');
  const file = join(dir, "untitled-journal.sekwe.json");
  for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(existsSync(file), "no journal file was downloaded");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.format, "sekwe-journal");
  assert.ok(Object.keys(saved.oracles).length > 0, "the file has no oracle copies to re-roll with");

  // The plain file input, as in Firefox: Chrome's own open picker gives the test no file input to fill.
  await page.evaluate(`delete window.showOpenFilePicker; window.showOpenFilePicker = undefined;`);
  await page.send("Page.setInterceptFileChooserDialog", { enabled: true });
  const chooser = page.waitFor("Page.fileChooserOpened");
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="open"]');
  await page.click('.file-menu [data-action="browse"]');
  const { backendNodeId } = await chooser;
  await page.send("DOM.setFileInputFiles", { files: [file], backendNodeId });
  await page.waitForFunction(`document.querySelector(".dialog [data-choice=copy]")`);
  await page.click(".dialog [data-choice=copy]");
  await page.waitForFunction(`window.sekwe.session.view().journals.length === 2`);
  assert.equal(await page.evaluate(`return window.sekwe.session.view().title`), "Untitled journal 2");
  assert.match(await pageText(page), /^Saved words (Rain|Sun|Fog)$/);

  // Exports land as files too.
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="export"]');
  await page.click('.file-menu [data-action="markdown"]');
  const md = join(dir, "untitled-journal-2.md");
  for (let i = 0; i < 100 && !existsSync(md); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(readFileSync(md, "utf8"), /^# Untitled journal 2\n\nSaved words (Rain|Sun|Fog)\[\^1\]/);
  rmSync(dir, { recursive: true, force: true });
});

await test("W a journal keeps a copy of its folders, and rolls them from disk on a computer without Orangey", async (page) => {
  await openMore(page);
  await page.click("#tab-oracles");
  await page.click(".folders-line .link-button");
  await page.evaluate(`[...document.querySelectorAll(".folder-option")].find((l) => l.textContent.trim() === "Starforged").querySelector("input").click()`);
  await page.waitForFunction(`window.sekwe.session.copy?.oracles.length > 0`);
  const copy = await page.evaluate(`return window.sekwe.session.copy.oracles.map((o) => o.id).sort()`);
  assert.deepEqual(copy, ["ask", "deck", "motive", "npc", "weather"], "the copy is not exactly the chosen folder");
  await typeText(page, "Copied ");
  const dir = join(root, ".tmp", "usb");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await page.evaluate(`delete window.showSaveFilePicker; window.showSaveFilePicker = undefined;`);
  await page.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="save"]');
  const file = join(dir, "untitled-journal.sekwe.json");
  for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(existsSync(file), "no journal file was downloaded");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).copy.oracles.length, 5);

  // The other computer: the single file from disk, which sees no Orangey library.
  await page.goto(`file://${join(dist, "sekwe.html")}?debug&seed=usb`);
  await ready(page);
  // A real click first: a file chooser opens only after the person has used the page.
  await clickOn(page, ".page");
  // The plain file input, as in Firefox: Chrome's own open picker gives the test no file input to fill.
  await page.evaluate(`delete window.showOpenFilePicker; window.showOpenFilePicker = undefined;`);
  await page.send("Page.setInterceptFileChooserDialog", { enabled: true });
  const chooser = page.waitFor("Page.fileChooserOpened");
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="open"]');
  await page.click('.file-menu [data-action="browse"]');
  const { backendNodeId } = await chooser;
  await page.send("DOM.setFileInputFiles", { files: [file], backendNodeId });
  await page.waitForFunction(`/^Copied/.test(document.querySelector(".page").textContent)`);
  await page.click("#tab-oracles");
  await page.waitForFunction(`document.querySelector(".library-panel[data-copy=only]")`);
  assert.match(await page.evaluate(`return document.querySelector(".copy-note").textContent`), /copy this journal keeps/);
  assert.equal(await page.evaluate(`return document.querySelectorAll(".oracle-button").length`), 5);
  await page.evaluate(`window.sekwe.editor.commands.focus("end")`);
  await slashRoll(page, "npc role");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  await press(page, "n", { alt: true });
  await page.waitForFunction(`document.querySelectorAll(".page .chip").length === 2`);
  const rolled = await chips(page);
  assert.equal(rolled[1].source.name, "NPC Motive");
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(page.consoleErrors, []);
});

await test("X an oracle from an installed pack shows its credit on the chip, and the chip keeps it for exports", async (page) => {
  await open(page);
  await seedLibrary(page, {
    "Delve/Theme.orangey.json": { id: "theme", type: "list", name: "Delve Theme", view: "wheel", items: ["Ancient", "Hallowed"].map((label, i) => ({ id: `t${i}`, label, weight: 1 })) },
  });
  await page.evaluate(`
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("library");
    const dir = await root.getDirectoryHandle("Delve");
    const w = await (await dir.getFileHandle("orangey-pack.json", { create: true })).createWritable();
    await w.write(JSON.stringify({ format: "orangey-pack", version: 1, pack: { id: "p", title: "Delve", author: "A. Writer", version: "1.0", licence: "CC BY 4.0", homepage: "https://example.org/delve", installed: "2026-10-02T00:00:00.000Z" } }));
    await w.close();
  `);
  await openSeeded(page);
  await slashRoll(page, "delve theme");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  await clickOn(page, ".page .chip");
  await page.waitForFunction(`document.querySelector(".chip-popover .credit")`);
  assert.match(await page.evaluate(`return document.querySelector(".chip-popover .credit").textContent.replace(/\\s+/g, " ").trim()`), /^From Delve by A\. Writer · v1\.0 · CC BY 4\.0 · web page$/);
  const journal = await page.evaluate(`return await window.sekwe.session.current()`);
  const rec = JSON.stringify(journal.doc).match(/"pack":\{[^}]*\}/);
  assert.ok(rec && rec[0].includes('"author":"A. Writer"'), "the chip did not keep its pack's credit");
  assert.deepEqual(page.consoleErrors, []);
});

await test("Y an outcome that refers to another table rolls it into the chip, and says which table gave what", async (page) => {
  await open(page);
  await seedLibrary(page, {
    ...ORACLES,
    "Starforged/Morning.orangey.json": { id: "morning", type: "list", name: "Morning", view: "list", items: [{ id: "m0", label: "A {@Weather|weather} morning", weight: 1 }] },
  });
  await openSeeded(page);
  await slashRoll(page, "morning");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  const [rec] = await chips(page);
  assert.match(rec.results[0].text, /^A (Rain|Sun|Fog) morning$/);
  assert.deepEqual(rec.results[0].parts.map((p) => p.name), ["Weather"]);
  await clickOn(page, ".page .chip");
  await page.waitForFunction(`document.querySelector(".chip-popover .parts")`);
  assert.match(await page.evaluate(`return document.querySelector(".chip-popover .parts").textContent`), /^Weather: (Rain|Sun|Fog)$/);
  assert.deepEqual(page.consoleErrors, []);
});

await test("Z the side panel's width is dragged by its edge, set from the keyboard, kept, and reset by a double-click", async (page) => {
  await open(page);
  const width = () => page.evaluate(`return Math.round(document.querySelector("#shelf").getBoundingClientRect().width)`);
  const before = await width();
  const box = await page.evaluate(`
    const r = document.querySelector(".shelf-resizer").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 200 };
  `);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 5; i++) await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x - i * 20, y: box.y, button: "left", buttons: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x - 100, y: box.y, button: "left", clickCount: 1 });
  await page.waitForFunction(`Math.round(document.querySelector("#shelf").getBoundingClientRect().width) === ${before + 100}`);
  // Kept after a reload.
  await open(page);
  assert.equal(await width(), before + 100);
  // Keyboard: the edge takes focus, and an arrow makes the panel wider or narrower.
  await page.evaluate(`document.querySelector(".shelf-resizer").focus()`);
  await press(page, "ArrowRight");
  await page.waitForFunction(`Math.round(document.querySelector("#shelf").getBoundingClientRect().width) === ${before + 84}`);
  assert.equal(await page.evaluate(`return document.querySelector(".shelf-resizer").getAttribute("aria-valuenow")`), String(before + 84));
  // A double-click puts it back.
  await page.evaluate(`document.querySelector(".shelf-resizer").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await page.waitForFunction(`Math.round(document.querySelector("#shelf").getBoundingClientRect().width) === 352`);
  assert.deepEqual(page.consoleErrors, []);
});

await test("P an Orangey board is a command: /tonight rolls everything on it, and it can be made the journal's own", async (page) => {
  await openMore(page);
  await typeText(page, "/tonig");
  await page.waitForFunction(`document.querySelector(".slash-menu .slash-item[data-kind=command]")`);
  await press(page, "Enter");
  await page.waitForFunction(`document.querySelectorAll(".page .chip").length === 1`);
  assert.equal((await chips(page))[0].source.name, "Weather");
  await page.click("#tab-commands");
  await page.waitForFunction(`document.querySelector(".board-commands .adopt")`);
  assert.match(await page.evaluate(`return document.querySelector(".board-commands").textContent`), /\/tonight/);
  await page.click(".board-commands .adopt");
  await page.waitForFunction(`window.sekwe.session.view().commands.some((c) => c.name === "tonight")`);
  // Now the journal's own, it is no longer listed among the boards'.
  await page.waitForFunction(`!document.querySelector(".board-commands")`);
  assert.deepEqual(page.consoleErrors, []);
});

await test("V2 a journal is deleted from File, after a warning that says whether it has a file", async (page) => {
  await open(page);
  await typeText(page, "Keep me.");
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="new"]');
  await page.waitForFunction(`window.sekwe.session.view().journals.length === 2`);
  await page.click(".file-menu .menu-button");
  await page.click('.file-menu [data-action="delete"]');
  await page.waitForFunction(`document.querySelector(".dialog [data-choice=delete]")`);
  assert.match(await page.evaluate(`return document.querySelector(".dialog").textContent`), /never been saved to a file/);
  await page.click(".dialog [data-choice=delete]");
  await page.waitForFunction(`window.sekwe.session.view().journals.length === 1`);
  await page.waitForFunction(`document.querySelector(".page").textContent === "Keep me."`);
  // After a reload it is still gone.
  await open(page);
  assert.equal(await page.evaluate(`return window.sekwe.session.view().journals.length`), 1);
  assert.deepEqual(page.consoleErrors, []);
});

// --- report -------------------------------------------------------------------

await server.close();
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n1..${results.length}\n# pass ${results.length - failed}\n# fail ${failed}`);
process.exit(failed ? 1 : 0);

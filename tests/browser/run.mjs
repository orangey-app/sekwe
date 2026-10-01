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
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve } from "../../vendor/orangey/tests/browser/cdp.mjs";
import { serveBoth } from "../../scripts/serve-both.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dist = join(root, "dist");
if (!existsSync(join(dist, "index.html")) || !existsSync(join(dist, "storyboard.html"))) {
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
const ready = (page) => page.waitForFunction("window.storyboard && document.querySelector('.app.ready') && window.storyboard.editor");

/** Real key events, one character at a time, as a person types. */
async function typeText(page, text, { pauseEvery = 0, pauseMs = 0 } = {}) {
  await page.evaluate(`window.storyboard.editor.commands.focus("end")`);
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
  page.waitForFunction(`document.querySelector(".status").dataset.status === "saved" && !window.storyboard.session.dirty`);
/** The journal as stored in IndexedDB, read past the app. */
const storedText = (page, id) =>
  page.evaluate(`
    const id = ${id ? JSON.stringify(id) : "window.storyboard.session.view().currentId"};
    const j = await window.storyboard.store.get(id);
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
  await page.click(".menu-button");
  await page.click(".menu-item.new");
  await page.waitForFunction(`document.querySelector(".title").value === "Untitled journal 2"`);
  assert.equal(await page.evaluate(`return document.activeElement === document.querySelector(".title")`), true, "the new title is not ready to be named");
  assert.equal(await pageText(page), "");
  assert.equal(await page.evaluate(`return document.querySelector('[aria-label^="Undo"]').disabled`), true, "Undo could reach the other journal");
  await typeText(page, "Second campaign.");
  await saved(page);

  await page.click(".menu-button");
  const rows = await page.evaluate(`return [...document.querySelectorAll(".menu-item:not(.new) .name")].map((e) => e.textContent)`);
  assert.deepEqual(rows, ["Untitled journal 2", "Untitled journal"], "newest first");
  await page.evaluate(`[...document.querySelectorAll(".menu-item:not(.new)")].find((e) => e.querySelector(".name").textContent === "Untitled journal").click()`);
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

await test("C Ctrl+S saves at once instead of waiting for the pause", async (page) => {
  await open(page);
  await typeText(page, "Now.");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", modifiers: 2, windowsVirtualKeyCode: 83 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", modifiers: 2, windowsVirtualKeyCode: 83 });
  const started = Date.now();
  await saved(page);
  assert.ok(Date.now() - started < 400, "saving waited for the pause");
  assert.equal(await pageText(page), "Now.", "Ctrl+S typed into the page");
});

await test("D the app opens offline once visited, with its caches all named storyboard-", async (page) => {
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
  assert.deepEqual(caches.filter((k) => !k.startsWith("storyboard-")), [], `a cache without the prefix: ${caches}`);
});

await test("E the app works from a deep folder, where it may be published", async (page) => {
  const nest = join(root, ".tmp", "deep");
  rmSync(nest, { recursive: true, force: true });
  mkdirSync(join(nest, "tools", "games"), { recursive: true });
  cpSync(dist, join(nest, "tools", "games", "storyboard"), { recursive: true });
  const sub = await serve(nest);
  try {
    const base = `${sub.origin}/tools/games/storyboard/`;
    await open(page, base);
    const styled = await page.evaluate(`return getComputedStyle(document.querySelector(".topbar")).display`);
    assert.equal(styled, "flex", "the stylesheet did not load from the folder");
    assert.equal(await workerActive(page), "activated", "the offline worker never installed from the folder");
    const scope = await page.evaluate(`return new URL((await navigator.serviceWorker.getRegistration()).scope).pathname`);
    assert.equal(scope, "/tools/games/storyboard/");
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
  const file = `file://${join(dist, "storyboard.html")}?debug`;
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

const openSeeded = async (page, seed = "storyboard") => {
  await page.goto(`${server.origin}/index.html?debug&seed=${seed}`);
  await ready(page);
  await page.waitForFunction(`window.storyboard.library.status !== "idle"`);
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
    window.storyboard.editor.state.doc.descendants((n) => {
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
  assert.equal(await page.evaluate(`return window.storyboard.library.status`), "ready");
  assert.deepEqual(await page.evaluate(`return window.storyboard.library.oracles.map((o) => o.name).sort()`), ["Inkblot", "NPC Motive", "NPC Role", "Weather"]);
  await page.click(".shelf-toggle");
  assert.match(await page.evaluate(`return document.querySelector(".library-panel").textContent`), /4 oracles from your Orangey library/);
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
  const stored = await page.evaluate(`return (await window.storyboard.store.get(window.storyboard.session.view().currentId))`);
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
  await page.waitForFunction(`window.storyboard.library.byId("weather").randomizer.items[0].label === "Snow"`);
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
  await page.waitForFunction(`window.storyboard.library.byId("weather") === null`);
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
  const file = `file://${join(dist, "storyboard.html")}?debug&seed=disk`;
  await page.goto(file);
  await ready(page);
  await page.click(".shelf-toggle");
  assert.match(await page.evaluate(`return document.querySelector(".library-panel").textContent`), /opened from disk/);
  await slashRoll(page, "d20");
  await page.waitForFunction(`document.querySelector(".page .chip")`);
  assert.deepEqual(page.consoleErrors, []);
});

await test("L served beside Orangey, Storyboard rolls a wheel made in Orangey itself", async (page) => {
  const orangeyDist = join(root, "..", "orangey", "dist");
  if (!existsSync(join(orangeyDist, "index.html"))) {
    console.log("    (no Orangey build beside this folder: run npm run build in ../orangey; skipped)");
    return;
  }
  const both = serveBoth({ orangey: orangeyDist, storyboard: dist });
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
    await page.goto(`${origin}/storyboard/index.html?debug`);
    await ready(page);
    await page.waitForFunction(`window.storyboard.library.status === "ready"`);
    await slashRoll(page, "harbour");
    await page.waitForFunction(`document.querySelector(".page .chip")`);
    assert.equal(currentText((await chips(page))[0]), "The tide is late");
  } finally {
    await new Promise((r) => both.close(r));
  }
});

// --- report -------------------------------------------------------------------

await server.close();
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n1..${results.length}\n# pass ${results.length - failed}\n# fail ${failed}`);
process.exit(failed ? 1 : 0);

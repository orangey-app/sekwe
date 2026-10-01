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

// --- report -------------------------------------------------------------------

await server.close();
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n1..${results.length}\n# pass ${results.length - failed}\n# fail ${failed}`);
process.exit(failed ? 1 : 0);

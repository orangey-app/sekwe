import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { plan, status, sync, verifyVendor } from "../../scripts/sync-orangey.mjs";

/** A small Orangey: the four DOM-free folders, a UI folder, tests and fixtures. */
function fakeOrangey() {
  const root = mkdtempSync(join(tmpdir(), "orangey-"));
  const put = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put("package.json", JSON.stringify({ version: "9.9.9" }));
  put("src/core/rng.ts", 'export const one = 1;\r\n// written on Windows\r\n');
  put("src/model/roll.ts", 'import { one } from "../core/rng.ts";\nexport const two = one + 1;\n');
  put("src/storage/db.ts", 'import type { Colour } from "../model/colours.ts";\nexport type C = Colour;\n');
  put("src/model/colours.ts", "export interface Colour { hex: string }\n");
  put("src/import/csv.ts", "export const comma = \",\";\n");
  put("src/model/settings-file.ts", 'import { feel } from "../ui/feel.ts";\nexport const f = feel;\n');
  put("src/ui/feel.ts", "export const feel = 1;\n");
  put("tests/unit/roll.test.ts", 'import { two } from "../../src/model/roll.ts";\nconst f = (name) => `../fixtures/${name}`;\n');
  put("tests/unit/feel.test.ts", 'import { feel } from "../../src/ui/feel.ts";\n');
  put("tests/fixtures/crlf.csv", "a,b\r\n1,2\r\n");
  put("tests/browser/cdp.mjs", 'import { spawn } from "node:child_process";\nexport const launch = spawn;\n');
  return { root, put };
}

describe("copying Orangey", () => {
  let orangey, to;
  beforeEach(() => {
    orangey = fakeOrangey();
    to = join(mkdtempSync(join(tmpdir(), "vendor-")), "orangey");
  });

  test("takes the four DOM-free folders, leaves the settings file and the UI behind, and only tests that run on the copy", () => {
    const p = plan(orangey.root);
    assert.deepEqual(p.sources.sort(), [
      "src/core/rng.ts",
      "src/import/csv.ts",
      "src/model/colours.ts",
      "src/model/roll.ts",
      "src/storage/db.ts",
    ]);
    assert.deepEqual(p.tests, ["tests/unit/roll.test.ts"]);
    assert.deepEqual(p.fixtures, ["tests/fixtures/crlf.csv"]);
    assert.deepEqual(p.harness, ["tests/browser/cdp.mjs"]);
  });

  test("refuses a harness that imports anything but Node's own modules", () => {
    orangey.put("tests/browser/cdp.mjs", 'import { x } from "./helpers.mjs";\n');
    assert.throws(() => plan(orangey.root), /tests\/browser\/cdp\.mjs imports tests\/browser\/helpers\.mjs/);
  });

  test("source files arrive with LF line endings; fixtures arrive byte for byte", () => {
    const s = sync({ from: orangey.root, to });
    assert.equal(readFileSync(join(to, "src/core/rng.ts"), "utf8"), "export const one = 1;\n// written on Windows\n");
    assert.equal(readFileSync(join(to, "tests/fixtures/crlf.csv"), "utf8"), "a,b\r\n1,2\r\n");
    assert.equal(s.orangey.version, "9.9.9");
    assert.equal(s.orangey.commit, null, "a folder that is not a git checkout has no commit");
    assert.deepEqual(Object.keys(s.excluded), ["src/model/settings-file.ts"]);
  });

  test("refuses a copy that would import something it did not bring", () => {
    orangey.put("src/model/roll.ts", 'import { feel } from "../ui/feel.ts";\n');
    assert.throws(() => plan(orangey.root), /src\/model\/roll\.ts imports src\/ui\/feel\.ts, which is not copied/);
  });
});

describe("checking the copy", () => {
  let orangey, to;
  beforeEach(() => {
    orangey = fakeOrangey();
    to = join(mkdtempSync(join(tmpdir(), "vendor-")), "orangey");
    sync({ from: orangey.root, to });
  });

  test("a fresh copy passes", () => {
    assert.deepEqual(verifyVendor(to), []);
  });

  test("a hand edit is caught and named", () => {
    writeFileSync(join(to, "src/model/roll.ts"), "export const two = 3;\n");
    assert.deepEqual(verifyVendor(to), ["vendor/orangey/src/model/roll.ts was edited by hand: change Orangey and sync again"]);
  });

  test("a file added by hand, and one deleted, are caught", () => {
    writeFileSync(join(to, "src/core/extra.ts"), "export {};\n");
    unlinkSync(join(to, "src/import/csv.ts"));
    const problems = verifyVendor(to);
    assert.ok(problems.includes("vendor/orangey/src/import/csv.ts is missing"), problems.join("\n"));
    assert.ok(problems.some((p) => p.startsWith("vendor/orangey/src/core/extra.ts is not from Orangey")), problems.join("\n"));
  });

  test("a Windows checkout handing a source file back with CRLF is not an edit", () => {
    const path = join(to, "src/model/roll.ts");
    writeFileSync(path, readFileSync(path, "utf8").replace(/\n/g, "\r\n"));
    assert.deepEqual(verifyVendor(to), []);
  });

  test("a missing SOURCE.json says how to make one", () => {
    rmSync(join(to, "SOURCE.json"));
    assert.match(verifyVendor(to)[0], /SOURCE\.json is missing: run node scripts\/sync-orangey\.mjs/);
  });

  test("status names what changed in Orangey since the copy, and writes nothing", () => {
    assert.deepEqual(status({ from: orangey.root, to }).changed, []);
    orangey.put("src/model/roll.ts", 'import { one } from "../core/rng.ts";\nexport const two = one + one;\n');
    orangey.put("src/core/new.ts", "export {};\n");
    assert.deepEqual(status({ from: orangey.root, to }).changed, ["src/core/new.ts (new in Orangey)", "src/model/roll.ts (changed)"]);
    assert.deepEqual(verifyVendor(to), [], "status must not touch the copy");
  });
});

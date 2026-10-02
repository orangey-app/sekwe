/**
 * Copies Orangey's DOM-free code into vendor/orangey/, and checks that copy.
 *
 *   node scripts/sync-orangey.mjs            copy from ../orangey (or --from <dir>)
 *   node scripts/sync-orangey.mjs --status   say whether Orangey has moved on; writes nothing
 *
 * What is copied: src/core, src/model, src/import and src/storage — the four
 * folders Orangey's own `npm run check` keeps free of UI code — minus EXCLUDED,
 * plus every unit test (and the fixtures those tests read) whose imports stay
 * inside the copy. The copied tests run in Sekwe's `npm test`, so the
 * engine Sekwe rolls with is tested where it is used. Also HARNESS: the
 * dependency-free Chromium driver Orangey's browser tests use, which
 * Sekwe's browser tests use too.
 *
 * vendor/orangey/SOURCE.json records which Orangey it came from and a hash of
 * every file. `npm run check` (verifyVendor below) fails when a vendored file
 * was edited, added or removed by hand, or when one imports a file the copy
 * did not bring. Fixes go into Orangey and come back through this script.
 *
 * Source files are copied with LF line endings and hashed after that, so the
 * hashes are the same on Windows and Linux. Fixtures are copied byte for byte:
 * one of them is CRLF on purpose.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const FOLDERS = ["core", "model", "import", "storage"];

/** Left out on purpose, each with the reason. Orangey's check names the same file. */
export const EXCLUDED = {
  "src/model/settings-file.ts":
    "Orangey's own settings file (scheme, feel, mascot); it checks against timings that live in Orangey's ui/feel.ts",
};

/** Test tooling taken as it is. It may import only Node's own modules. */
export const HARNESS = ["tests/browser/cdp.mjs"];

const SOURCE = "SOURCE.json";
const SPECIFIER = /\bfrom\s*["'](\.[^"']+)["']|\bimport\s*["'](\.[^"']+)["']/g;
const FIXTURE = /\.\.\/fixtures\/([^`"'$]+)|fixtures\/\$\{/g;

const slash = (p) => p.split(sep).join("/");
const lf = (text) => text.replace(/\r\n/g, "\n");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Relative imports in a module's text, resolved against its own path (repo-relative, "/"). */
export function importsOf(relPath, text) {
  const out = [];
  for (const m of text.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2];
    out.push(slash(join(dirname(relPath), spec)));
  }
  return out;
}

const isSource = (rel) => rel.endsWith(".ts");

/**
 * Decides what to copy from an Orangey checkout: returns repo-relative paths.
 * Throws if a copied source file imports something outside the copy, because
 * then the copy would not run on its own.
 */
export function plan(from) {
  const sources = [];
  for (const folder of FOLDERS) {
    for (const file of walk(join(from, "src", folder))) {
      const rel = slash(relative(from, file));
      if (isSource(rel) && !(rel in EXCLUDED)) sources.push(rel);
    }
  }
  const inCopy = new Set(sources);
  const problems = [];
  for (const rel of sources) {
    for (const target of importsOf(rel, readFileSync(join(from, rel), "utf8"))) {
      if (!inCopy.has(target)) problems.push(`${rel} imports ${target}, which is not copied`);
    }
  }
  if (problems.length) throw new Error(`the copy would not be self-contained:\n  ${problems.join("\n  ")}`);

  // A unit test comes along when everything it imports is in the copy.
  const tests = [];
  const fixtures = new Set();
  for (const file of walk(join(from, "tests", "unit"))) {
    const rel = slash(relative(from, file));
    if (!rel.endsWith(".test.ts")) continue;
    const text = readFileSync(file, "utf8");
    if (!importsOf(rel, text).every((t) => inCopy.has(t))) continue;
    tests.push(rel);
    for (const m of text.matchAll(FIXTURE)) {
      // A fixture named by a template (`fixtures/${name}`) could be any of them.
      if (m[1]) fixtures.add(`tests/fixtures/${m[1]}`);
      else for (const f of walk(join(from, "tests", "fixtures"))) fixtures.add(slash(relative(from, f)));
    }
  }
  const harness = HARNESS.filter((rel) => existsSync(join(from, rel)));
  for (const rel of harness) {
    const imports = importsOf(rel, readFileSync(join(from, rel), "utf8"));
    if (imports.length) throw new Error(`${rel} imports ${imports.join(", ")}; the harness may import only node: modules`);
  }
  return { sources, tests, fixtures: [...fixtures].filter((f) => existsSync(join(from, f))).sort(), harness };
}

function git(from, args) {
  try {
    return execFileSync("git", ["-C", from, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Where Orangey stands: version, commit, and whether the copied folders have uncommitted changes. */
export function describe(from) {
  const pkg = JSON.parse(readFileSync(join(from, "package.json"), "utf8"));
  const commit = git(from, ["rev-parse", "HEAD"]);
  const status = commit === null ? null : git(from, ["status", "--porcelain", "--", "src", "tests"]);
  return { version: pkg.version, commit, uncommitted: status === null ? null : status.length > 0 };
}

/** The bytes a file is stored and hashed as in the copy. */
function copiedBytes(from, rel) {
  const raw = readFileSync(join(from, rel));
  return rel.startsWith("tests/fixtures/") ? raw : Buffer.from(lf(raw.toString("utf8")), "utf8");
}

export function sync({ from, to, now = new Date() }) {
  const { sources, tests, fixtures, harness } = plan(from);
  rmSync(to, { recursive: true, force: true });
  const files = {};
  for (const rel of [...sources, ...tests, ...fixtures, ...harness]) {
    const bytes = copiedBytes(from, rel);
    mkdirSync(dirname(join(to, rel)), { recursive: true });
    writeFileSync(join(to, rel), bytes);
    files[rel] = sha(bytes);
  }
  const source = {
    note: "Copied by scripts/sync-orangey.mjs. Do not edit these files: change Orangey and sync again.",
    orangey: describe(from),
    synced: now.toISOString(),
    excluded: EXCLUDED,
    counts: { sources: sources.length, tests: tests.length, fixtures: fixtures.length, harness: harness.length },
    files,
  };
  writeFileSync(join(to, SOURCE), `${JSON.stringify(source, null, 2)}\n`);
  return source;
}

/**
 * Checks vendor/orangey against its SOURCE.json: every file present and
 * unchanged, nothing extra, and every import inside the copy. Returns problems.
 */
export function verifyVendor(to) {
  const sourcePath = join(to, SOURCE);
  if (!existsSync(sourcePath)) return [`${slash(sourcePath)} is missing: run node scripts/sync-orangey.mjs`];
  const { files } = JSON.parse(readFileSync(sourcePath, "utf8"));
  const problems = [];
  const present = new Set(walk(to).map((f) => slash(relative(to, f))).filter((r) => r !== SOURCE));
  for (const [rel, hash] of Object.entries(files)) {
    if (!present.has(rel)) {
      problems.push(`vendor/orangey/${rel} is missing`);
      continue;
    }
    present.delete(rel);
    const raw = readFileSync(join(to, rel));
    // A Windows checkout may hand a source file back with CRLF; that is not an edit.
    const bytes = rel.startsWith("tests/fixtures/") ? raw : Buffer.from(lf(raw.toString("utf8")), "utf8");
    if (sha(bytes) !== hash) problems.push(`vendor/orangey/${rel} was edited by hand: change Orangey and sync again`);
  }
  for (const rel of present) problems.push(`vendor/orangey/${rel} is not from Orangey: remove it, or add it to Orangey and sync`);
  const copied = new Set(Object.keys(files));
  for (const rel of Object.keys(files).filter(isSource)) {
    if (!existsSync(join(to, rel))) continue;
    for (const target of importsOf(rel, readFileSync(join(to, rel), "utf8"))) {
      if (!copied.has(target)) problems.push(`vendor/orangey/${rel} imports ${target}, which the copy does not have`);
    }
  }
  return problems;
}

/** Compares a fresh plan of Orangey with the copy, without writing anything. */
export function status({ from, to }) {
  const recorded = JSON.parse(readFileSync(join(to, SOURCE), "utf8"));
  const { sources, tests, fixtures, harness } = plan(from);
  const now = {};
  for (const rel of [...sources, ...tests, ...fixtures, ...harness]) now[rel] = sha(copiedBytes(from, rel));
  const changed = [];
  for (const rel of new Set([...Object.keys(now), ...Object.keys(recorded.files)])) {
    if (now[rel] !== recorded.files[rel]) {
      changed.push(`${rel} (${!(rel in recorded.files) ? "new in Orangey" : !(rel in now) ? "gone from Orangey" : "changed"})`);
    }
  }
  return { recorded: recorded.orangey, current: describe(from), changed: changed.sort() };
}

// --- command line -------------------------------------------------------------

const here = dirname(dirname(fileURLToPath(import.meta.url)));
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--from");
  const from = resolve(at >= 0 ? args[at + 1] : join(here, "..", "orangey"));
  const to = join(here, "vendor", "orangey");
  if (!existsSync(join(from, "src", "core"))) {
    console.error(`no Orangey checkout at ${from} (pass --from <folder>)`);
    process.exit(1);
  }
  if (args.includes("--status")) {
    const s = status({ from, to });
    const label = (o) => `${o.version} @ ${o.commit ? o.commit.slice(0, 7) : "no git"}${o.uncommitted ? " (with uncommitted changes)" : ""}`;
    console.log(`copy:    Orangey ${label(s.recorded)}`);
    console.log(`Orangey: ${label(s.current)}`);
    if (s.changed.length === 0) console.log("the copy is up to date");
    else {
      console.log(`${s.changed.length} file(s) differ; run node scripts/sync-orangey.mjs:`);
      for (const c of s.changed) console.log(`  ${c}`);
      process.exit(1);
    }
  } else {
    const s = sync({ from, to });
    const o = s.orangey;
    console.log(`copied Orangey ${o.version} @ ${o.commit ? o.commit.slice(0, 7) : "no git"} into vendor/orangey/`);
    console.log(`  ${s.counts.sources} source files, ${s.counts.tests} unit test files, ${s.counts.fixtures} fixtures, ${s.counts.harness} test harness`);
    console.log(`  left out: ${Object.keys(EXCLUDED).join(", ")}`);
    if (o.uncommitted) console.log("  note: Orangey has uncommitted changes in src/ or tests/; commit them so SOURCE.json names the code you copied");
  }
}

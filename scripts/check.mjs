/**
 * Project checks, run as `npm run check`.
 *
 * Today: the copy of Orangey in vendor/orangey/ is exactly what
 * scripts/sync-orangey.mjs wrote — nothing edited, added or removed by hand —
 * and it imports nothing it did not bring. Fixes to that code go into Orangey
 * and come back through the sync.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyVendor } from "./sync-orangey.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const problems = verifyVendor(join(root, "vendor", "orangey"));

if (problems.length) {
  console.error(`check failed with ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("check passed (vendor/orangey matches its SOURCE.json)");

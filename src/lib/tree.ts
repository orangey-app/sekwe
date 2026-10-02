/**
 * The side panel's oracle tree: folders nested as in the library, each with
 * how many oracles it holds, the journal's folder choice, and a filter that
 * keeps only matching oracles and opens the folders they sit in. Pure, so the
 * panel only draws it.
 */

import { searchOracles, type Oracle } from "./oracles.ts";

export interface TreeFolder {
  /** "Starforged/Character"; "" for the top of the library. */
  path: string;
  name: string;
  folders: TreeFolder[];
  oracles: Oracle[];
  /** Oracles here and in every folder below. */
  count: number;
  /** The pack this folder is the top of (one pack below it, and not the same one above). */
  pack?: { title: string; author: string; version: string };
}

const inside = (folder: string, f: string) => folder === f || folder.startsWith(`${f}/`);
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Every folder on the way to `path`, outermost first: "A/B/C" → A, A/B, A/B/C. */
export function ancestors(path: string): string[] {
  if (!path) return [];
  const parts = path.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * The tree for these oracles. `extraFolders` are folders to show even when
 * empty here (all of the library's, when choosing).
 */
export function buildTree(oracles: readonly Oracle[], extraFolders: readonly string[] = []): TreeFolder {
  const root: TreeFolder = { path: "", name: "", folders: [], oracles: [], count: 0 };
  const byPath = new Map<string, TreeFolder>([["", root]]);
  const folderFor = (path: string): TreeFolder => {
    const known = byPath.get(path);
    if (known) return known;
    const up = folderFor(parentOf(path));
    const made: TreeFolder = { path, name: path.slice(path.lastIndexOf("/") + 1), folders: [], oracles: [], count: 0 };
    up.folders.push(made);
    byPath.set(path, made);
    return made;
  };
  for (const f of extraFolders) if (f) folderFor(f);
  for (const o of oracles) if (!o.linked) folderFor(o.folder).oracles.push(o);

  const packIds = new Map<string, Set<string>>();
  const finish = (f: TreeFolder): number => {
    f.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    f.oracles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const ids = new Set<string>(f.oracles.map((o) => o.pack?.id ?? ""));
    f.count = f.oracles.length;
    for (const sub of f.folders) {
      f.count += finish(sub);
      for (const id of packIds.get(sub.path) ?? []) ids.add(id);
    }
    packIds.set(f.path, ids);
    return f.count;
  };
  finish(root);
  // A pack's badge goes on the folder where it starts: one pack below, and not the same one above.
  const mark = (f: TreeFolder, above: string | null) => {
    const ids = packIds.get(f.path) ?? new Set();
    const only = ids.size === 1 ? [...ids][0] : null;
    if (f.path && only && only !== above) {
      const o = firstOracle(f);
      if (o?.pack) f.pack = { title: o.pack.title, author: o.pack.author, version: o.pack.version };
    }
    for (const sub of f.folders) mark(sub, only || null);
  };
  mark(root, null);
  return root;
}

function firstOracle(f: TreeFolder): Oracle | undefined {
  return f.oracles[0] ?? f.folders.map(firstOracle).find(Boolean);
}

/**
 * What the panel shows: the journal's folders (and the folders above them, to
 * nest in), or every folder when choosing. No folders chosen means all of them.
 */
export function visibleOracles(oracles: readonly Oracle[], chosen: readonly string[], showAll: boolean): Oracle[] {
  const shown = oracles.filter((o) => !o.linked);
  if (showAll || chosen.length === 0) return shown;
  return shown.filter((o) => chosen.some((f) => inside(o.folder, f)));
}

/**
 * The filter: the oracles whose name (or folder) matches what is typed, as the
 * slash menu finds them, and the folders that must open to show them.
 */
export function filterTree(oracles: readonly Oracle[], query: string): { oracles: Oracle[]; open: Set<string> } {
  const matches = searchOracles(oracles, query, oracles.length).map((m) => m.oracle);
  const open = new Set<string>();
  for (const o of matches) for (const a of ancestors(o.folder)) open.add(a);
  return { oracles: matches, open };
}

/** Whether a folder counts as chosen: it, or a folder above it, is in the journal's choice. */
export function isChosen(path: string, chosen: readonly string[]): { chosen: boolean; byParent: boolean } {
  if (chosen.includes(path)) return { chosen: true, byParent: false };
  const up = chosen.some((f) => path.startsWith(`${f}/`));
  return { chosen: up, byParent: up };
}

/** Every folder path in a tree, for Expand all. */
export function allPaths(f: TreeFolder): string[] {
  return f.folders.flatMap((sub) => [sub.path, ...allPaths(sub)]);
}

/**
 * Orangey's boards as commands. A board is a set of oracles rolled together
 * ("Tonight's table": weather, encounter, rumour), which is what a command is,
 * so each board in the journal's folders is offered as one: `/tonights-table`
 * rolls everything on it, one chip each.
 *
 * They are not stored in the journal: they follow the boards in Orangey (or
 * the journal's copy of them). A command of the writer's own with the same
 * name wins, and "Make it my own" copies a board's command into the journal's
 * commands, to change it there.
 */

import { COMMAND_NAME, type JournalCommand } from "./journal.ts";
import type { Board } from "./oracles.ts";

export interface BoardCommand extends JournalCommand {
  /** The board it comes from. */
  board: { id: string; name: string };
}

/** "Tonight's Table!" → "tonights-table"; null when nothing usable is left. */
export function boardCommandName(boardName: string): string | null {
  const name = boardName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32)
    .replace(/-$/, "");
  return COMMAND_NAME.test(name) ? name : null;
}

/**
 * The commands the journal's boards give: those in its folders (all of them
 * when none are chosen), named after the board, never over one of the
 * writer's own; two boards with one name are told apart as "-2", "-3".
 */
export function boardCommands(boards: readonly Board[], folders: readonly string[], own: readonly JournalCommand[]): BoardCommand[] {
  const inside = (folder: string) => folders.length === 0 || folders.some((f) => folder === f || folder.startsWith(`${f}/`));
  const taken = new Set(own.map((c) => c.name));
  const out: BoardCommand[] = [];
  const sorted = [...boards].filter((b) => inside(b.folder)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const b of sorted) {
    const base = boardCommandName(b.name);
    if (!base || b.entries.length === 0) continue;
    // The writer's own command of this name wins: the board's is not offered.
    if (taken.has(base) && own.some((c) => c.name === base)) continue;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base.slice(0, 32 - String(n).length - 1)}-${n}`;
    taken.add(name);
    out.push({
      name,
      steps: b.entries.map((e) => ({ kind: "oracle" as const, id: e.id, name: e.name })),
      board: { id: b.id, name: b.name },
    });
  }
  return out;
}

/** A board's command as the writer's own, to change in the journal: the steps only. */
export function ownCopy(c: BoardCommand): JournalCommand {
  return { name: c.name, steps: c.steps.map((s) => ({ ...s })) };
}

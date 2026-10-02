/**
 * The slash command: type "/" and part of a name, and the matching oracles
 * pop up at the cursor; Enter rolls the one highlighted into the text in place
 * of what was typed. A dice expression ("/2d6") rolls as dice, and a journal's
 * own commands ("/feeling") roll everything they list.
 *
 * Tab works as at a command prompt: it fills in as much of the name as the
 * matches share, then goes round the whole names. Only Enter rolls.
 *
 * The menu is plain DOM, positioned at the cursor, so the writer never leaves
 * the page and the text never moves. The same list serves a pick from an offer.
 */

import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { sharedPrefix } from "./oracles.ts";

export type SlashItem =
  | { kind: "oracle"; id: string; name: string; folder: string }
  | { kind: "dice"; expression: string }
  /** One of the journal's own commands. */
  | { kind: "command"; name: string; count: number }
  /** Orangey's library is in a folder on disk, and needs one click (or Enter) to open. */
  | { kind: "open-folder" }
  /** Nothing to roll: says why, and does nothing when chosen. */
  | { kind: "note"; text: string };

export interface SlashSource {
  items(query: string, editor: Editor): SlashItem[];
  choose(editor: Editor, item: SlashItem, range: Range): void;
}

export const slashKey = new PluginKey("slash");

function label(item: SlashItem): { main: string; aside?: string } {
  switch (item.kind) {
    case "oracle":
      return { main: item.name, aside: item.folder };
    case "dice":
      return { main: `Roll ${item.expression}`, aside: "dice" };
    case "command":
      return { main: `/${item.name}`, aside: `${item.count} ${item.count === 1 ? "roll" : "rolls"}` };
    case "open-folder":
      return { main: "Open my Orangey folder", aside: "to roll its oracles" };
    case "note":
      return { main: item.text };
  }
}

/** What Tab puts in for an item; null for items that are not names. */
function completion(item: SlashItem): string | null {
  return item.kind === "oracle" ? item.name : item.kind === "command" ? item.name : null;
}

export interface ListRow {
  main: string;
  aside?: string;
  kind: string;
}

/**
 * A list at the cursor: arrow keys move, Enter (or a click) chooses. The
 * slash menu and the pick from an offer are both this.
 */
export class CursorList {
  root: HTMLDivElement;
  rows: ListRow[] = [];
  active = 0;
  #choose: (index: number) => void;

  constructor(label: string, choose: (index: number) => void, className = "slash-menu") {
    this.#choose = choose;
    this.root = document.createElement("div");
    this.root.className = className;
    this.root.setAttribute("role", "listbox");
    this.root.setAttribute("aria-label", label);
    document.body.append(this.root);
  }

  set(rows: ListRow[], heading?: string): void {
    this.rows = rows;
    this.active = Math.min(this.active, Math.max(0, rows.length - 1));
    this.draw(heading);
  }

  draw(heading?: string): void {
    this.root.replaceChildren();
    if (heading) {
      const h = document.createElement("div");
      h.className = "slash-heading";
      h.textContent = heading;
      this.root.append(h);
    }
    this.rows.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "slash-item";
      row.setAttribute("role", "option");
      row.dataset.kind = r.kind;
      row.setAttribute("aria-selected", String(i === this.active));
      const m = document.createElement("span");
      m.className = "slash-main";
      m.textContent = r.main;
      row.append(m);
      if (r.aside) {
        const a = document.createElement("span");
        a.className = "slash-aside";
        a.textContent = r.aside;
        row.append(a);
      }
      // mousedown, not click: the editor must keep the focus and the selection.
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.#choose(i);
      });
      this.root.append(row);
    });
    this.root.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  move(by: number): void {
    if (this.rows.length) this.active = (this.active + by + this.rows.length) % this.rows.length;
    this.draw(this.root.querySelector(".slash-heading")?.textContent ?? undefined);
  }

  place(rect: DOMRect | null | undefined): void {
    if (!rect) return;
    const below = rect.bottom + 6;
    const fitsBelow = below + this.root.offsetHeight < innerHeight - 8;
    this.root.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - this.root.offsetWidth - 8))}px`;
    this.root.style.top = `${fitsBelow ? below : Math.max(8, rect.top - this.root.offsetHeight - 6)}px`;
  }

  remove(): void {
    this.root.remove();
  }
}

/** The caret's rectangle, for placing a list where the writer is looking. */
export function caretRect(editor: Editor): DOMRect | null {
  try {
    const c = editor.view.coordsAtPos(editor.state.selection.from);
    return new DOMRect(c.left, c.top, 0, c.bottom - c.top);
  } catch {
    return null;
  }
}

/**
 * Asks the writer to pick one of `choices` at the cursor. Enter, a click or
 * the number keys choose; Escape cancels. Resolves with the index, or null.
 */
export function pickAtCursor(editor: Editor, name: string, choices: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (index: number | null) => {
      if (done) return;
      done = true;
      list.remove();
      editor.view.dom.removeEventListener("keydown", onkey, true);
      editor.off("blur", onblur);
      resolve(index);
    };
    const list = new CursorList(`Pick from ${name}`, (i) => finish(i), "slash-menu pick-menu");
    list.set(
      choices.map((c, i) => ({ main: c, aside: i < 9 ? String(i + 1) : undefined, kind: "pick" })),
      `${name}: pick one`,
    );
    list.place(caretRect(editor));
    const onkey = (ev: KeyboardEvent) => {
      const n = Number(ev.key);
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") list.move(ev.key === "ArrowDown" ? 1 : -1);
      else if (ev.key === "Enter" || ev.key === "Tab") finish(list.active);
      else if (ev.key === "Escape") finish(null);
      else if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, choices.length)) finish(n - 1);
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onblur = () => setTimeout(() => finish(null), 150);
    editor.view.dom.addEventListener("keydown", onkey, true);
    editor.on("blur", onblur);
  });
}

/** The slash menu itself: lives and dies with one suggestion. */
function menu() {
  let list: CursorList | null = null;
  let items: SlashItem[] = [];
  let props: SuggestionProps<SlashItem> | null = null;
  /** Tab's place: the names it goes round, and the text it last put in. */
  let tab: { names: string[]; at: number; put: string } | null = null;

  const choose = (i: number) => {
    const item = items[i];
    if (item && item.kind !== "note") props?.command(item);
  };

  const replaceQuery = (text: string) => {
    if (!props) return;
    const { editor, range } = props;
    editor.chain().focus().insertContentAt({ from: range.from + 1, to: range.to }, text).run();
  };

  return {
    onStart(p: SuggestionProps<SlashItem>) {
      list = new CursorList("Oracles", choose);
      this.onUpdate(p);
    },
    onUpdate(p: SuggestionProps<SlashItem>) {
      props = p;
      items = p.items;
      // Typing by hand starts Tab over; Tab's own changes do not.
      if (tab && p.query !== tab.put) tab = null;
      list?.set(items.map((item) => ({ ...label(item), kind: item.kind })));
      list?.place(p.clientRect?.());
    },
    onKeyDown({ event }: SuggestionKeyDownProps): boolean {
      if (!list) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        list.move(event.key === "ArrowDown" ? 1 : -1);
        return true;
      }
      if (event.key === "Tab") {
        const names = items.map(completion).filter((n): n is string => n !== null);
        if (names.length === 0) return true;
        const typed = props?.query ?? "";
        if (!tab) {
          tab = { names, at: -1, put: typed };
          const shared = sharedPrefix(names);
          if (shared.length > typed.trim().length && shared.toLowerCase().startsWith(typed.trim().toLowerCase())) {
            tab.put = shared;
            replaceQuery(shared);
            return true;
          }
        }
        tab.at = (tab.at + (event.shiftKey ? tab.names.length - 1 : 1)) % tab.names.length;
        tab.put = tab.names[tab.at];
        replaceQuery(tab.put);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[list.active];
        // A note has nothing to do: Enter goes on to make a new line.
        if (!item || item.kind === "note") return false;
        choose(list.active);
        return true;
      }
      if (event.key === "Escape") {
        this.onExit();
        return true;
      }
      return false;
    },
    onExit() {
      list?.remove();
      list = null;
      tab = null;
    },
  };
}

export const SlashCommand = Extension.create<{ source: SlashSource | null }>({
  name: "slash",
  addOptions() {
    return { source: null };
  },
  addProseMirrorPlugins() {
    const source = this.options.source;
    if (!source) return [];
    const editor = this.editor;
    return [
      Suggestion<SlashItem>({
        editor,
        pluginKey: slashKey,
        char: "/",
        // "/npc mot": names have spaces in them.
        allowSpaces: true,
        // After a space or an opening bracket or quote, never inside a word:
        // "and/or" and "1/2" are text, not a command.
        allowedPrefixes: [" ", "(", "[", '"', "“", "‘", "—", "–"],
        items: ({ query }) => source.items(query, editor),
        command: ({ editor: e, range, props }) => source.choose(e, props, range),
        render: menu,
      }),
    ];
  },
});

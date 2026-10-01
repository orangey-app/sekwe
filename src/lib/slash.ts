/**
 * The slash command: type "/" and part of a name, and the matching oracles
 * pop up at the cursor; Enter rolls the one highlighted into the text in place
 * of what was typed. A dice expression ("/2d6") rolls as dice.
 *
 * The menu is plain DOM, positioned at the cursor, so the writer never leaves
 * the page and the text never moves.
 */

import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";

export type SlashItem =
  | { kind: "oracle"; id: string; name: string; folder: string }
  | { kind: "dice"; expression: string }
  /** Orangey's library is in a folder on disk, and needs one click (or Enter) to open. */
  | { kind: "open-folder" }
  /** Nothing to roll: says why, and does nothing when chosen. */
  | { kind: "note"; text: string };

export interface SlashSource {
  items(query: string): SlashItem[];
  choose(editor: Editor, item: SlashItem, range: Range): void;
}

export const slashKey = new PluginKey("slash");

function label(item: SlashItem): { main: string; aside?: string } {
  switch (item.kind) {
    case "oracle":
      return { main: item.name, aside: item.folder };
    case "dice":
      return { main: `Roll ${item.expression}`, aside: "dice" };
    case "open-folder":
      return { main: "Open my Orangey folder", aside: "to roll its oracles" };
    case "note":
      return { main: item.text };
  }
}

/** The pop-up list. Kept outside Svelte: it lives and dies with one suggestion. */
function menu() {
  let root: HTMLDivElement | null = null;
  let items: SlashItem[] = [];
  let active = 0;
  let pick: ((item: SlashItem) => void) | null = null;

  const draw = () => {
    if (!root) return;
    root.replaceChildren();
    items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "slash-item";
      row.setAttribute("role", "option");
      row.dataset.kind = item.kind;
      row.setAttribute("aria-selected", String(i === active));
      const { main, aside } = label(item);
      const m = document.createElement("span");
      m.className = "slash-main";
      m.textContent = main;
      row.append(m);
      if (aside) {
        const a = document.createElement("span");
        a.className = "slash-aside";
        a.textContent = aside;
        row.append(a);
      }
      // mousedown, not click: the editor must keep the focus and the selection.
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        pick?.(item);
      });
      root!.append(row);
    });
    root.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  };

  const place = (rect: DOMRect | null | undefined) => {
    if (!root || !rect) return;
    const below = rect.bottom + 6;
    const fitsBelow = below + root.offsetHeight < innerHeight - 8;
    root.style.left = `${Math.min(rect.left, innerWidth - root.offsetWidth - 8)}px`;
    root.style.top = `${fitsBelow ? below : Math.max(8, rect.top - root.offsetHeight - 6)}px`;
  };

  return {
    onStart(props: SuggestionProps<SlashItem>) {
      root = document.createElement("div");
      root.className = "slash-menu";
      root.setAttribute("role", "listbox");
      root.setAttribute("aria-label", "Oracles");
      document.body.append(root);
      this.onUpdate(props);
    },
    onUpdate(props: SuggestionProps<SlashItem>) {
      items = props.items;
      active = Math.min(active, Math.max(0, items.length - 1));
      pick = (item) => props.command(item);
      draw();
      place(props.clientRect?.());
    },
    onKeyDown({ event }: SuggestionKeyDownProps): boolean {
      if (!root) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (items.length) active = (active + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        draw();
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[active];
        // A note has nothing to do: Enter goes on to make a new line.
        if (!item || item.kind === "note") return false;
        pick?.(item);
        return true;
      }
      if (event.key === "Escape") {
        this.onExit();
        return true;
      }
      return false;
    },
    onExit() {
      root?.remove();
      root = null;
      active = 0;
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
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: "/",
        // "/npc mot": names have spaces in them.
        allowSpaces: true,
        // After a space or an opening bracket or quote, never inside a word:
        // "and/or" and "1/2" are text, not a command.
        allowedPrefixes: [" ", "(", "[", "\"", "“", "‘", "—", "–"],
        items: ({ query }) => source.items(query),
        command: ({ editor, range, props }) => source.choose(editor, props, range),
        render: menu,
      }),
    ];
  },
});

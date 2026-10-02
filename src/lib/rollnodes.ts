/**
 * Rolls in the document, as Tiptap sees them:
 *
 * - `roll`: an inline chip holding one RollRecord. It reads as its current
 *   result, as plain text and in an export; a thumbnail for an inkblot.
 * - `inkblot`: a picture of a blot across the page, drawn from its number.
 * - the keys: Alt+R rolls again (the selected chip, or else the last oracle at
 *   the cursor) and Alt+N follows a result that "goes to" another oracle.
 *
 * What a key or a click does is decided in RollControl, which the app passes in,
 * so the rules are testable without an editor.
 */

import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { drawBlot, drawBlotNow } from "./blot.ts";
import type { Begun, Roller } from "./roller.ts";
import { chipText, current, type RollRecord, type RollSource } from "./rolls.ts";

const THUMB_WIDTH = 40;
const PICTURE_WIDTH = 720;

const describe = (record: RollRecord): string => {
  const r = current(record);
  const what = record.source.kind === "dice" ? record.source.expression : record.source.name;
  const when = new Date(r.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const earlier = record.results.length - 1;
  return `${what} · ${when}${earlier ? ` · ${earlier} earlier` : ""}`;
};

export const RollChip = Node.create({
  name: "roll",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      record: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute("data-roll") ?? "null");
          } catch {
            return null;
          }
        },
        renderHTML: (attrs: { record: RollRecord | null }) => ({ "data-roll": JSON.stringify(attrs.record) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-roll]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const record = node.attrs.record as RollRecord | null;
    return ["span", mergeAttributes(HTMLAttributes, { class: "chip" }), record ? chipText(current(record)) : "?"];
  },

  renderText({ node }) {
    const record = node.attrs.record as RollRecord | null;
    return record ? chipText(current(record)) : "";
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "chip";
      const render = (n: PMNode) => {
        const record = n.attrs.record as RollRecord | null;
        dom.replaceChildren();
        if (!record) {
          dom.textContent = "?";
          return;
        }
        const r = current(record);
        dom.dataset.kind = r.blot !== undefined ? "inkblot" : record.source.kind;
        dom.title = describe(record);
        if (r.blot !== undefined) {
          const canvas = document.createElement("canvas");
          canvas.className = "chip-blot";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", chipText(r));
          drawBlotNow(canvas, r.blot, THUMB_WIDTH);
          dom.append(canvas);
        } else {
          const text = document.createElement("span");
          text.className = "chip-text";
          text.textContent = r.text;
          dom.append(text);
        }
        if (r.next) {
          const next = document.createElement("span");
          next.className = "chip-next";
          next.textContent = `→ ${r.next.name}`;
          dom.append(next);
        }
        if (record.results.length > 1) dom.dataset.rerolled = String(record.results.length - 1);
        else delete dom.dataset.rerolled;
      };
      render(node);
      return {
        dom,
        update: (updated: PMNode) => {
          if (updated.type.name !== "roll") return false;
          render(updated);
          return true;
        },
        // Nothing inside a chip is editable or selectable on its own.
        ignoreMutation: () => true,
        stopEvent: () => false,
      };
    };
  },
});

export const InkblotPicture = Node.create({
  name: "inkblot",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      blot: { default: null, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-blot")) || null, renderHTML: (a: { blot: number | null }) => ({ "data-blot": a.blot }) },
      from: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-from") ?? "", renderHTML: (a: { from: string }) => ({ "data-from": a.from }) },
    };
  },

  parseHTML() {
    return [{ tag: "figure[data-blot]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { class: "blot-picture" }), `Inkblot #${node.attrs.blot}`];
  },

  renderText({ node }) {
    return `[Inkblot #${node.attrs.blot}]`;
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("figure");
      dom.className = "blot-picture";
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      const caption = document.createElement("figcaption");
      dom.append(canvas, caption);
      let drawn: number | null = null;
      let gone = false;
      let observer: IntersectionObserver | null = null;
      const render = (n: PMNode) => {
        const blot = n.attrs.blot as number | null;
        caption.textContent = `Inkblot #${blot}`;
        canvas.setAttribute("aria-label", `Inkblot #${blot}`);
        if (blot === null || blot === drawn) return;
        drawn = blot;
        dom.dataset.state = "drawing";
        const start = () => {
          void drawBlot(canvas, blot, PICTURE_WIDTH, () => gone || drawn !== blot).then((ok) => {
            if (ok) dom.dataset.state = "drawn";
          });
        };
        // Only blots that are on screen are drawn, so a long journal opens quickly.
        observer?.disconnect();
        if (typeof IntersectionObserver === "undefined") return start();
        observer = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer?.disconnect();
            start();
          }
        });
        observer.observe(dom);
      };
      render(node);
      return {
        dom,
        update: (updated: PMNode) => {
          if (updated.type.name !== "inkblot") return false;
          render(updated);
          return true;
        },
        destroy: () => {
          gone = true;
          observer?.disconnect();
        },
        ignoreMutation: () => true,
      };
    };
  },
});

// --- what the keys and the menu do ------------------------------------------------

export interface RollControlOptions {
  roller: () => Roller;
  /** Says something to the writer: an oracle that has gone, nothing to roll again. */
  notice: (message: string) => void;
  /** Asks the writer to pick from an offer; the app shows the list at the cursor. */
  pick?: (editor: Editor, name: string, choices: string[]) => Promise<number | null>;
  /** Told of every oracle rolled, so the slash menu can put it first next time. */
  used?: (id: string) => void;
}

/** A chip and where it is. */
export interface ChipAt {
  pos: number;
  record: RollRecord;
}

export class RollControl {
  #o: RollControlOptions;
  /** What Alt+R rolls when no chip is selected. */
  last: RollSource | null = null;

  constructor(o: RollControlOptions) {
    this.#o = o;
  }

  /** The chip the selection is on, if it is on one. */
  selectedChip(editor: Editor): ChipAt | null {
    const sel = editor.state.selection;
    if (sel instanceof NodeSelection && sel.node.type.name === "roll" && sel.node.attrs.record) {
      return { pos: sel.from, record: sel.node.attrs.record as RollRecord };
    }
    return null;
  }

  /** The nearest chip before the cursor in the same paragraph. */
  chipBeforeCursor(editor: Editor): ChipAt | null {
    const { $from } = editor.state.selection;
    const start = $from.start();
    let found: ChipAt | null = null;
    editor.state.doc.nodesBetween(start, $from.pos, (node, pos) => {
      if (node.type.name === "roll" && node.attrs.record) found = { pos, record: node.attrs.record as RollRecord };
    });
    return found;
  }

  /** A roll that may need a pick first; null when cancelled or not found. */
  async settle(editor: Editor, begun: Begun): Promise<RollRecord | null> {
    if (begun.kind === "missing") {
      this.#o.notice(`"${begun.name}" is no longer in your library, and this journal has no copy of it.`);
      return null;
    }
    if (begun.kind === "done") return begun.record;
    const index = this.#o.pick ? await this.#o.pick(editor, begun.name, begun.choices) : 0;
    return index === null ? null : begun.finish(index);
  }

  #remember(record: RollRecord): void {
    this.last = record.source;
    if (record.source.kind === "oracle") this.#o.used?.(record.source.id);
  }

  /** Puts a roll at the cursor (or over `range`, e.g. the typed "/query"). */
  insert(editor: Editor, record: RollRecord, range?: { from: number; to: number }): boolean {
    return this.insertMany(editor, [record], range);
  }

  /** Several rolls at once, a space between each, so each still re-rolls on its own. */
  insertMany(editor: Editor, records: RollRecord[], range?: { from: number; to: number }): boolean {
    if (records.length === 0) return false;
    for (const r of records) this.#remember(r);
    const content: object[] = [];
    records.forEach((record, i) => {
      if (i) content.push({ type: "text", text: " " });
      content.push({ type: "roll", attrs: { record } });
    });
    const chain = editor.chain().focus();
    return (range ? chain.insertContentAt(range, content) : chain.insertContent(content)).run();
  }

  /** Rolls an oracle at the cursor (or over `range`), asking for a pick when it offers one. */
  async rollOracle(editor: Editor, id: string, name: string, range?: { from: number; to: number }): Promise<boolean> {
    // The typed "/query" goes first, so a pick list sits where the text will.
    if (range) {
      editor.chain().focus().deleteRange(range).run();
      range = undefined;
    }
    const record = await this.settle(editor, this.#o.roller().start(id, undefined, name));
    return record ? this.insert(editor, record) : false;
  }

  /** Re-rolls a chip in place, keeping its history and the selection on it. */
  async rerollAt(editor: Editor, at: ChipAt): Promise<boolean> {
    const record = await this.settle(editor, this.#o.roller().startReroll(at.record));
    if (!record) return true;
    // The chip may have moved while a pick was open; find it again.
    const node = editor.state.doc.nodeAt(at.pos);
    if (!node || node.type.name !== "roll") return true;
    this.#remember(record);
    const { tr } = editor.state;
    tr.setNodeMarkup(at.pos, undefined, { record });
    tr.setSelection(NodeSelection.create(tr.doc, at.pos));
    editor.view.dispatch(tr);
    return true;
  }

  /** Alt+R: the selected chip again, or else the last oracle rolled, at the cursor. */
  rollAgain(editor: Editor): boolean {
    const chip = this.selectedChip(editor);
    if (chip) {
      void this.rerollAt(editor, chip);
      return true;
    }
    const last = this.last;
    if (!last) {
      this.#o.notice("Nothing rolled yet: type / to roll an oracle.");
      return true;
    }
    if (last.kind === "dice") return this.insert(editor, this.#o.roller().dice(last.expression));
    void this.settle(editor, this.#o.roller().start(last.id, last.version, last.name)).then((r) => r && this.insert(editor, r));
    return true;
  }

  /**
   * Alt+N: follow "goes to" from the selected chip, or from the nearest chip
   * before the cursor. The next roll goes after a space at the cursor, or right
   * after a selected chip.
   */
  rollNext(editor: Editor): boolean {
    const selected = this.selectedChip(editor);
    const from = selected ?? this.chipBeforeCursor(editor);
    if (!from || !current(from.record).next) {
      this.#o.notice("This roll does not lead to another oracle.");
      return true;
    }
    void this.settle(editor, this.#o.roller().startNext(from.record)).then((record) => {
      if (!record) return;
      if (selected) {
        this.#remember(record);
        editor.chain().focus().insertContentAt(selected.pos + 1, [{ type: "text", text: " " }, { type: "roll", attrs: { record } }]).run();
      } else this.insert(editor, record);
    });
    return true;
  }

  /** "Put in the text": the blot as a picture below the paragraph holding the chip. */
  putPicture(editor: Editor, at: ChipAt): boolean {
    const r = current(at.record);
    if (r.blot === undefined) return false;
    const $pos = editor.state.doc.resolve(at.pos);
    const after = $pos.after($pos.depth);
    const from = at.record.source.kind === "oracle" ? at.record.source.name : "";
    return editor.chain().insertContentAt(after, { type: "inkblot", attrs: { blot: r.blot, from } }).run();
  }

  /** "Turn into text": the chip becomes its words, and stops being a roll. */
  toText(editor: Editor, at: ChipAt): boolean {
    const text = chipText(current(at.record));
    return editor.chain().focus().insertContentAt({ from: at.pos, to: at.pos + 1 }, text).run();
  }
}

export const RollKeys = Extension.create<{ control: RollControl | null }>({
  name: "rollKeys",
  addOptions() {
    return { control: null };
  },
  addKeyboardShortcuts() {
    return {
      "Alt-r": () => this.options.control?.rollAgain(this.editor) ?? false,
      "Alt-n": () => this.options.control?.rollNext(this.editor) ?? false,
    };
  },
});

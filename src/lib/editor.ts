/**
 * The writing surface: Tiptap with StarterKit, configured for a journal, plus
 * the rolls (chips, inkblot pictures, Alt+R / Alt+N) and the slash command.
 * Headings are chapters, scenes and beats (levels 1 to 3); the journal's title
 * lives outside the text. Tables and text styling are Sekwe's own
 * (tables.ts, marks.ts), so nothing beyond StarterKit is installed.
 */

import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { DocJSON } from "./journal.ts";
import { InkblotPicture, RollChip, RollKeys, type RollControl } from "./rollnodes.ts";
import { SlashCommand, type SlashSource } from "./slash.ts";
import { TableExtensions } from "./tables.ts";
import { MarkExtensions } from "./marks.ts";

export interface EditorOptions {
  element: HTMLElement;
  doc: DocJSON;
  onChange: () => void;
  onTransaction?: () => void;
  /** Put the cursor at the end of the text. Off when the title should be typed first. */
  focus?: boolean;
  control?: RollControl;
  slash?: SlashSource;
  /** The status panel says so to screen readers; the story is "Journal text". */
  label?: string;
}

export function createEditor(o: EditorOptions): Editor {
  return new Editor({
    element: o.element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Links and underline come with StarterKit 3; a journal has no use for
        // either yet, and a stray Ctrl+U should not change the text.
        link: false,
        underline: false,
      }),
      ...TableExtensions,
      ...MarkExtensions,
      RollChip,
      InkblotPicture,
      RollKeys.configure({ control: o.control ?? null }),
      SlashCommand.configure({ source: o.slash ?? null }),
    ],
    content: o.doc as JSONContent,
    autofocus: o.focus === false ? false : "end",
    editorProps: {
      attributes: { class: o.label === "Status" ? "status-page" : "page", spellcheck: "true", "aria-label": o.label ?? "Journal text", role: "textbox", "aria-multiline": "true" },
    },
    onUpdate: () => o.onChange(),
    onTransaction: () => o.onTransaction?.(),
  });
}

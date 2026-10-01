/**
 * The writing surface: Tiptap with StarterKit, configured for a journal, plus
 * the rolls (chips, inkblot pictures, Alt+R / Alt+N) and the slash command.
 * Headings are levels 2 and 3 (scenes and beats); level 1 is the journal's
 * title, which lives outside the text.
 */

import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { DocJSON } from "./journal.ts";
import { InkblotPicture, RollChip, RollKeys, type RollControl } from "./rollnodes.ts";
import { SlashCommand, type SlashSource } from "./slash.ts";

export interface EditorOptions {
  element: HTMLElement;
  doc: DocJSON;
  onChange: () => void;
  onTransaction?: () => void;
  /** Put the cursor at the end of the text. Off when the title should be typed first. */
  focus?: boolean;
  control?: RollControl;
  slash?: SlashSource;
}

export function createEditor(o: EditorOptions): Editor {
  return new Editor({
    element: o.element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Links and underline come with StarterKit 3; a journal has no use for
        // either yet, and a stray Ctrl+U should not change the text.
        link: false,
        underline: false,
      }),
      RollChip,
      InkblotPicture,
      RollKeys.configure({ control: o.control ?? null }),
      SlashCommand.configure({ source: o.slash ?? null }),
    ],
    content: o.doc as JSONContent,
    autofocus: o.focus === false ? false : "end",
    editorProps: {
      attributes: { class: "page", spellcheck: "true", "aria-label": "Journal text", role: "textbox", "aria-multiline": "true" },
    },
    onUpdate: () => o.onChange(),
    onTransaction: () => o.onTransaction?.(),
  });
}

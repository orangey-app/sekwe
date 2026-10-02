/**
 * Text styling beyond bold and italic: highlight, text colour, a few sizes and
 * three typefaces. Fixed choices rather than any value, so a journal stays
 * readable and exports cleanly; each is a mark of its own, so they combine.
 */

import { Mark, mergeAttributes, type Editor } from "@tiptap/core";

export const HIGHLIGHTS = [
  { name: "Yellow", value: "yellow" },
  { name: "Green", value: "green" },
  { name: "Blue", value: "blue" },
  { name: "Pink", value: "pink" },
] as const;

export const COLOURS = [
  { name: "Red", value: "red" },
  { name: "Orange", value: "orange" },
  { name: "Green", value: "green" },
  { name: "Blue", value: "blue" },
  { name: "Purple", value: "purple" },
  { name: "Grey", value: "grey" },
] as const;

export const SIZES = [
  { name: "Small", value: "small" },
  { name: "Large", value: "large" },
  { name: "Larger", value: "larger" },
] as const;

export const FONTS = [
  { name: "Sans", value: "sans" },
  { name: "Typewriter", value: "mono" },
] as const;

const allowed = (list: readonly { value: string }[]) => new Set(list.map((x) => x.value));

/** A mark that is a span (or mark element) with one named value, kept as a class. */
function choiceMark(name: string, attr: string, values: Set<string>, tag: "span" | "mark", prefix: string) {
  return Mark.create({
    name,
    addAttributes() {
      return {
        [attr]: {
          default: null,
          parseHTML: (el: HTMLElement) => {
            const v = el.getAttribute(`data-${attr}`);
            return v && values.has(v) ? v : null;
          },
          renderHTML: (attrs: Record<string, string | null>) => {
            const v = attrs[attr];
            return v ? { [`data-${attr}`]: v, class: `${prefix}-${v}` } : {};
          },
        },
      };
    },
    parseHTML() {
      return [{ tag: `${tag}[data-${attr}]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes), 0];
    },
  });
}

export const Highlight = choiceMark("highlight", "highlight", allowed(HIGHLIGHTS), "mark", "hl");
export const TextColour = choiceMark("textColour", "colour", allowed(COLOURS), "span", "tc");
export const FontSize = choiceMark("fontSize", "size", allowed(SIZES), "span", "fs");
export const FontFamily = choiceMark("fontFamily", "font", allowed(FONTS), "span", "ff");

export const MarkExtensions = [Highlight, TextColour, FontSize, FontFamily];

type Style = { mark: "highlight"; attr: "highlight" } | { mark: "textColour"; attr: "colour" } | { mark: "fontSize"; attr: "size" } | { mark: "fontFamily"; attr: "font" };

export const STYLES = {
  highlight: { mark: "highlight", attr: "highlight" },
  colour: { mark: "textColour", attr: "colour" },
  size: { mark: "fontSize", attr: "size" },
  font: { mark: "fontFamily", attr: "font" },
} as const satisfies Record<string, Style>;

/** Applies a style to the selection; null takes it off. */
export function setStyle(editor: Editor, style: Style, value: string | null): boolean {
  const chain = editor.chain().focus();
  return (value ? chain.setMark(style.mark, { [style.attr]: value }) : chain.unsetMark(style.mark)).run();
}

/** The style's value where the selection is, if any. */
export function styleAt(editor: Editor, style: Style): string | null {
  const v = editor.getAttributes(style.mark)[style.attr];
  return typeof v === "string" ? v : null;
}

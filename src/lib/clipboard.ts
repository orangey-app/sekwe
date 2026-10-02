/**
 * What Ctrl+C puts on the clipboard, for pasting into Word, Google Docs or an
 * email. ProseMirror writes the copy as HTML; this fills in what another
 * program needs to show it as it looks here:
 *
 * - highlight, text colour, size and typeface carry their look as inline
 *   styles (on the page they are classes, which only Sekwe's stylesheet knows);
 * - an inkblot becomes a picture: full size for one put in the text, small
 *   where an inkblot chip sits.
 *
 * Everything Sekwe needs to paste it back (the data- attributes) stays, so a
 * copy pasted into Sekwe is still chips and blots.
 */

import { DOMSerializer, type Schema } from "@tiptap/pm/model";
import type { RollRecord } from "./rolls.ts";
import { current } from "./rolls.ts";

/** The light-page values, as on paper: a paste lands in a white document. */
export const COPY_LOOK = {
  highlight: { yellow: "#fbeea6", green: "#cdeec4", blue: "#cfe3f6", pink: "#f7d1e1" } as Record<string, string>,
  colour: { red: "#b3261e", orange: "#b45309", green: "#2e7d32", blue: "#1d5fa8", purple: "#7b3fa0", grey: "#6b6960" } as Record<string, string>,
  size: { small: "0.85em", large: "1.25em", larger: "1.6em" } as Record<string, string>,
  font: { sans: "Arial, Helvetica, sans-serif", mono: "Consolas, 'Courier New', monospace" } as Record<string, string>,
};

/** Draws an inkblot as a PNG data address; given by the app (it needs a canvas). */
export type BlotPicture = (blot: number, width: number) => string | null;

export const BLOT_WIDTH = 480;
export const CHIP_BLOT_WIDTH = 48;

/** Adds the look and the pictures to copied HTML, in place. */
export function decorateCopy(root: ParentNode, picture: BlotPicture): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-highlight]")) {
    const v = COPY_LOOK.highlight[el.dataset.highlight ?? ""];
    if (v) el.style.backgroundColor = v;
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-colour]")) {
    const v = COPY_LOOK.colour[el.dataset.colour ?? ""];
    if (v) el.style.color = v;
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-size]")) {
    const v = COPY_LOOK.size[el.dataset.size ?? ""];
    if (v) el.style.fontSize = v;
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-font]")) {
    const v = COPY_LOOK.font[el.dataset.font ?? ""];
    if (v) el.style.fontFamily = v;
  }
  const doc = (root as Node).ownerDocument ?? document;
  for (const fig of root.querySelectorAll<HTMLElement>("figure[data-blot]")) {
    const blot = Number(fig.dataset.blot);
    const src = Number.isFinite(blot) && blot > 0 ? picture(blot, BLOT_WIDTH) : null;
    if (!src) continue;
    const img = doc.createElement("img");
    img.src = src;
    img.alt = `Inkblot #${blot}`;
    img.width = BLOT_WIDTH;
    fig.replaceChildren(img);
  }
  for (const chip of root.querySelectorAll<HTMLElement>("span[data-roll]")) {
    let record: RollRecord | null = null;
    try {
      record = JSON.parse(chip.dataset.roll ?? "null") as RollRecord | null;
    } catch {
      continue;
    }
    const blot = record?.results?.length ? current(record).blot : undefined;
    if (blot === undefined) continue;
    const src = picture(blot, CHIP_BLOT_WIDTH * 2);
    if (!src) continue;
    const img = doc.createElement("img");
    img.src = src;
    img.alt = `Inkblot #${blot}`;
    img.width = CHIP_BLOT_WIDTH;
    img.style.verticalAlign = "middle";
    chip.replaceChildren(img);
  }
}

/**
 * The editor's clipboard serializer: ProseMirror's own, with `decorateCopy`
 * applied to what it makes. Only copying goes through it; the page itself is
 * drawn as before.
 */
export function copySerializer(schema: Schema, picture: BlotPicture): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  const serializer = new DOMSerializer(base.nodes, base.marks);
  const serializeFragment = serializer.serializeFragment.bind(serializer);
  serializer.serializeFragment = ((...args: Parameters<DOMSerializer["serializeFragment"]>) => {
    const out = serializeFragment(...args);
    decorateCopy(out as unknown as ParentNode, picture);
    return out;
  }) as DOMSerializer["serializeFragment"];
  return serializer;
}

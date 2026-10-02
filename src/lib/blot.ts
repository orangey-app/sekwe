/**
 * Drawing an inkblot from its number, with Orangey's own shape maths
 * (vendor/orangey/src/core/inkblot.ts): the same number gives the same blot
 * here as in Orangey, by construction.
 *
 * A small blot (a chip's thumbnail) is drawn at once. A large one is worked
 * out a few rows at a time between frames, as Orangey does, so drawing it
 * never holds up typing.
 */

import { inkField, inkFieldNow, inkFieldRows, inkHeight, inkPaint, inkResolve, type InkField } from "../../vendor/orangey/src/core/inkblot.ts";

/** Work per frame on a large blot; the rest of the frame stays free for typing. */
const SLICE_MS = 8;
const ROWS_PER_STEP = 4;

function paint(canvas: HTMLCanvasElement, field: InkField): void {
  canvas.width = field.W;
  canvas.height = field.H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(field.W, field.H);
  inkPaint(field, 1, image.data);
  ctx.putImageData(image, 0, 0);
}

/** Even width, as the field needs; height follows the card's shape. */
const even = (w: number) => Math.max(2, Math.round(w / 2) * 2);

export function drawBlotNow(canvas: HTMLCanvasElement, seed: number, width: number): void {
  const W = even(width);
  paint(canvas, inkFieldNow(W, inkHeight(W), inkResolve(seed)));
}

/**
 * Draws a large blot over several frames. Resolves true when drawn, false if
 * `cancelled()` turned true first (the picture was removed or redrawn).
 */
export async function drawBlot(canvas: HTMLCanvasElement, seed: number, width: number, cancelled: () => boolean = () => false): Promise<boolean> {
  const W = even(width);
  const field = inkField(W, inkHeight(W), inkResolve(seed));
  for (;;) {
    if (cancelled()) return false;
    const until = performance.now() + SLICE_MS;
    let done = false;
    while (!done && performance.now() < until) done = inkFieldRows(field, ROWS_PER_STEP);
    if (done) break;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  if (cancelled()) return false;
  paint(canvas, field);
  return true;
}

/** Pictures already drawn for a copy, by blot and width: a copy drawn twice costs nothing. */
const pictures = new Map<string, string>();

/**
 * An inkblot as a PNG data address, drawn at once (for the clipboard): the
 * same picture as on the page, at `width` pixels. Null where no canvas works.
 */
export function blotPicture(seed: number, width: number): string | null {
  const key = `${seed}:${width}`;
  const known = pictures.get(key);
  if (known) return known;
  try {
    const canvas = document.createElement("canvas");
    drawBlotNow(canvas, seed, width);
    const url = canvas.toDataURL("image/png");
    if (pictures.size > 64) pictures.clear();
    pictures.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/** The same picture as PNG bytes, for a file (the Markdown export's ZIP). */
export async function blotPng(seed: number, width: number): Promise<Uint8Array | null> {
  const canvas = document.createElement("canvas");
  drawBlotNow(canvas, seed, width);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export { inkHeight };

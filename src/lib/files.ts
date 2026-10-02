/**
 * Files on the writer's computer: saving a journal (and exports), and opening
 * one. Chrome and Edge can write straight back to the same file on disk, so a
 * second Save of a journal goes to the file chosen the first time; other
 * browsers download a copy each time.
 */

type Handle = { createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>; name: string };
type PickerWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<Handle>;
};

/** The file each journal was last saved to, while the page is open. */
const handles = new Map<string, Handle>();

/** What happened: written to a file on disk, downloaded, or cancelled by the writer. */
export type SaveOutcome = "written" | "downloaded" | "cancelled";

export function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves text under `name`. With `key` (a journal id), the file chosen the
 * first time is written again without asking. `ask` forces the picker (Save as).
 */
export async function saveText(name: string, text: string, mime: string, o: { key?: string; ask?: boolean; description?: string; extension?: string } = {}): Promise<SaveOutcome> {
  const w = window as PickerWindow;
  if (!w.showSaveFilePicker) {
    download(name, text, mime);
    return "downloaded";
  }
  let handle = o.key && !o.ask ? handles.get(o.key) : undefined;
  if (!handle) {
    try {
      handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: o.extension ? [{ description: o.description ?? "File", accept: { [mime]: [o.extension] } }] : undefined,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      download(name, text, mime);
      return "downloaded";
    }
  }
  const out = await handle.createWritable();
  await out.write(text);
  await out.close();
  if (o.key) handles.set(o.key, handle);
  return "written";
}

/** Asks for a file and reads it as text; null when nothing was chosen. */
export function openText(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? { name: file.name, text: await file.text() } : null);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}

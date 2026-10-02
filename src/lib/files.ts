/**
 * Files on the writer's computer: saving a journal (and exports), and opening
 * one, the way a word processor does.
 *
 * In Chrome and Edge a journal can belong to a file on disk. Save writes
 * straight back to it; Save as asks where, and the file chosen becomes the
 * journal's from then on; opening a journal file makes that file the
 * journal's. The link is kept in the browser's storage (a file handle in
 * IndexedDB, database `sekwe-files`), so it outlives a reload; after a
 * reload the first Save asks once for permission to edit the file.
 *
 * Firefox and Safari do not let a page write to a file on disk: there every
 * save downloads a copy, and Save as asks for its name first.
 */

interface Writable {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}
type Permission = "granted" | "denied" | "prompt";
export interface FileHandle {
  name: string;
  createWritable(): Promise<Writable>;
  getFile?(): Promise<File>;
  queryPermission?(o: { mode: "readwrite" }): Promise<Permission>;
  requestPermission?(o: { mode: "readwrite" }): Promise<Permission>;
}
type FileTypes = { description: string; accept: Record<string, string[]> }[];
type PickerWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName: string; types?: FileTypes }) => Promise<FileHandle>;
  showOpenFilePicker?: (o: { types?: FileTypes; multiple?: boolean }) => Promise<FileHandle[]>;
};

/** What happened: written to a file on disk, downloaded, or cancelled by the writer. */
export type SaveOutcome = { kind: "written"; file: string } | { kind: "downloaded"; file: string } | { kind: "cancelled" };

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

/** Bytes as a download (the Markdown export's ZIP). */
export function downloadBytes(name: string, bytes: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Whether this browser can write back to a file on disk (Chrome, Edge). */
export const canWriteFiles = (): boolean => typeof (window as PickerWindow).showSaveFilePicker === "function";

/** "Salt and Iron" → "Salt and Iron.sekwe.json"; a name that already ends so is kept. */
export function withSuffix(name: string, suffix: string): string {
  const n = name.trim().replace(/[\\/:*?"<>|]/g, "-");
  return n.toLowerCase().endsWith(suffix.toLowerCase()) ? n : `${n}${suffix}`;
}

// --- which file each journal belongs to -----------------------------------------------

const DB = "sekwe-files";
const STORE = "handles";
/** This page's own memory of them, so nothing waits on storage twice. */
const memory = new Map<string, FileHandle | null>();

function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function stored<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const req = run(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(undefined);
    } catch {
      // A handle that cannot be stored (a test's stand-in) lives in memory only.
      resolve(undefined);
    }
  });
}

/** The file a journal belongs to, if any. */
export async function fileFor(key: string): Promise<FileHandle | null> {
  if (memory.has(key)) return memory.get(key)!;
  const h = (await stored<FileHandle>("readonly", (s) => s.get(key))) ?? null;
  // A file remembered while storage was being read wins over what it read.
  if (!memory.has(key)) memory.set(key, h);
  return memory.get(key)!;
}

/** From now on, Save writes this journal to this file. */
export async function rememberFile(key: string, handle: FileHandle): Promise<void> {
  memory.set(key, handle);
  await stored("readwrite", (s) => s.put(handle, key));
}

/** The journal no longer belongs to a file (it was copied, or the file is gone). */
export async function forgetFile(key: string): Promise<void> {
  memory.set(key, null);
  await stored("readwrite", (s) => s.delete(key));
}

/** May the page write to this file? Asks once after a reload; must run inside the click or key press. */
async function mayWrite(h: FileHandle): Promise<boolean> {
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await h.requestPermission?.({ mode: "readwrite" })) === "granted";
}

async function writeTo(h: FileHandle, text: string): Promise<void> {
  const out = await h.createWritable();
  await out.write(text);
  await out.close();
}

export interface SaveOptions {
  /** The journal's id: Save writes to its file, and Save as gives it one. */
  key?: string;
  /** Save as: always ask where. */
  ask?: boolean;
  description?: string;
  /** What the file name ends in: ".sekwe.json". */
  suffix?: string;
  /** For the picker's file types: ".json". */
  extension?: string;
  /** Without a file picker, Save as asks for the name with this; null cancels. */
  askName?: (suggested: string) => Promise<string | null>;
}

/**
 * Saves text. With `key`, the journal's own file is written without asking;
 * without one yet (or with `ask`), the writer picks where, and with `key`
 * that file becomes the journal's.
 */
export async function saveText(name: string, text: string, mime: string, o: SaveOptions = {}): Promise<SaveOutcome> {
  const w = window as PickerWindow;
  if (!w.showSaveFilePicker) {
    let file = name;
    if (o.ask && o.askName) {
      const chosen = (await o.askName(name))?.trim();
      if (!chosen) return { kind: "cancelled" };
      file = o.suffix ? withSuffix(chosen, o.suffix) : chosen;
    }
    download(file, text, mime);
    return { kind: "downloaded", file };
  }
  if (o.key && !o.ask) {
    const own = await fileFor(o.key);
    if (own) {
      try {
        if (await mayWrite(own)) {
          await writeTo(own, text);
          return { kind: "written", file: own.name };
        }
      } catch {
        // Moved, deleted, or refused: ask where instead, as for a new journal.
      }
    }
  }
  let handle: FileHandle;
  try {
    handle = await w.showSaveFilePicker({
      suggestedName: name,
      types: o.extension ? [{ description: o.description ?? "File", accept: { [mime]: [o.extension] } }] : undefined,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return { kind: "cancelled" };
    download(name, text, mime);
    return { kind: "downloaded", file: name };
  }
  await writeTo(handle, text);
  if (o.key) await rememberFile(o.key, handle);
  return { kind: "written", file: handle.name };
}

/**
 * Asks for a file and reads it as text; null when nothing was chosen. In
 * Chrome and Edge it comes with its handle, so Save can write back to it.
 */
export async function openText(
  accept: string,
  o: { description?: string; mime?: string; extensions?: string[] } = {},
): Promise<{ name: string; text: string; handle?: FileHandle } | null> {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: o.mime && o.extensions ? [{ description: o.description ?? "File", accept: { [o.mime]: o.extensions } }] : undefined,
      });
      const file = await handle.getFile!();
      return { name: file.name, text: await file.text(), handle };
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      // Anything else (the picker refused here): the plain way below.
    }
  }
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

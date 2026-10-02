/**
 * The open journal and everything around it: which journals exist, which one
 * is open, its title, its story and status panel, the Orangey folders it rolls
 * from, its commands, its bags, and keeping all of it saved. The Svelte
 * components only show this and call into it, so the logic is typechecked and
 * testable here.
 */

import type { Editor } from "@tiptap/core";
import { Autosaver, type SaveStatus } from "./autosave.ts";
import {
  cleanTitle,
  EMPTY_DOC,
  freshTitle,
  isJournal,
  newId,
  newJournal,
  RECENT_MAX,
  summarize,
  type DocJSON,
  type Journal,
  type JournalCommand,
  type JournalSummary,
} from "./journal.ts";
import type { JournalStore } from "./store.ts";
import type { Bags, Snapshots } from "./roller.ts";
import type { LibraryCopy } from "./copy.ts";

export interface SessionView {
  journals: JournalSummary[];
  currentId: string | null;
  title: string;
  status: SaveStatus;
  /** Set when something could not be done, in words for the writer. */
  problem: string | null;
  folders: string[];
  commands: JournalCommand[];
}

export type EditorRole = "story" | "status";

/** Makes an editor for a document; the app passes Tiptap, a test passes a fake. */
export type MakeEditor = (doc: DocJSON, onChange: () => void, role: EditorRole) => Pick<Editor, "getJSON" | "destroy">;

/** What a journal file brings with it when its journal is already here. */
export type ImportChoice = "replace" | "copy";

/** The parts of a journal that are not its text, held while it is open. */
interface Extras {
  oracles: Record<string, Record<string, unknown>>;
  bags: Record<string, string[]>;
  folders: string[];
  commands: JournalCommand[];
  recent: string[];
  copy: LibraryCopy | null;
}

/**
 * A deep copy that also takes Svelte's reactive proxies (structuredClone
 * refuses them): journals are plain JSON, so JSON is a faithful copy.
 */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const extrasOf = (j: Journal): Extras => ({
  oracles: { ...(j.oracles ?? {}) },
  bags: clone(j.bags ?? {}),
  folders: [...(j.folders ?? [])],
  commands: clone(j.commands ?? []),
  recent: [...(j.recent ?? [])],
  copy: j.copy ? clone(j.copy) : null,
});

export class Session {
  #store: JournalStore;
  #make: MakeEditor;
  #notify: (view: SessionView) => void;
  #saver: Autosaver<Journal>;
  #current: Journal | null = null;
  #editor: ReturnType<MakeEditor> | null = null;
  #statusEditor: ReturnType<MakeEditor> | null = null;
  #journals: JournalSummary[] = [];
  #title = "";
  #status: SaveStatus = "saved";
  #problem: string | null = null;
  #x: Extras = { oracles: {}, bags: {}, folders: [], commands: [], recent: [], copy: null };

  constructor(store: JournalStore, make: MakeEditor, notify: (view: SessionView) => void, saverOptions: { delayMs?: number } = {}) {
    this.#store = store;
    this.#make = make;
    this.#notify = notify;
    this.#saver = new Autosaver<Journal>({
      ...saverOptions,
      write: async (j) => {
        await this.#store.put(j);
        this.#journals = [summarize(j), ...this.#journals.filter((s) => s.id !== j.id)];
        if (this.#current?.id === j.id) this.#current = j;
      },
      onStatus: (s) => {
        this.#status = s;
        if (s === "saved") this.#problem = null;
        this.#emit();
      },
    });
  }

  view(): SessionView {
    return {
      journals: this.#journals,
      currentId: this.#current?.id ?? null,
      title: this.#title,
      status: this.#status,
      problem: this.#problem,
      folders: this.#x.folders,
      commands: this.#x.commands,
    };
  }

  #emit(): void {
    this.#notify(this.view());
  }

  get editor() {
    return this.#editor;
  }

  get statusEditor() {
    return this.#statusEditor;
  }

  /** Opens the journal used last, or the newest, or makes the first one. */
  async start(): Promise<void> {
    this.#journals = await this.#store.list();
    if (this.#journals.length === 0) {
      const first = newJournal();
      await this.#store.put(first);
      this.#journals = [summarize(first)];
    }
    const last = await this.#store.lastOpen();
    const id = this.#journals.some((j) => j.id === last) ? last! : this.#journals[0].id;
    await this.open(id);
  }

  /**
   * What gets saved: the journal as it stands, read from the editors only now.
   * Stamped when it is read, so "modified" is when the words were saved.
   */
  #snapshot(): Journal {
    const j = this.#current!;
    const saved: Journal = {
      ...j,
      title: cleanTitle(this.#title),
      doc: this.#editor!.getJSON() as DocJSON,
      modified: new Date().toISOString(),
    };
    if (this.#statusEditor) saved.status = this.#statusEditor.getJSON() as DocJSON;
    const x = this.#x;
    const keep = <K extends keyof Extras>(key: K, value: Extras[K], empty: boolean) => {
      if (empty) delete (saved as unknown as Record<string, unknown>)[key];
      else (saved as unknown as Record<string, unknown>)[key] = clone(value);
    };
    keep("oracles", x.oracles, Object.keys(x.oracles).length === 0);
    keep("bags", x.bags, Object.keys(x.bags).length === 0);
    keep("folders", x.folders, x.folders.length === 0);
    keep("commands", x.commands, x.commands.length === 0);
    keep("recent", x.recent, x.recent.length === 0);
    if (x.copy) saved.copy = clone(x.copy);
    else delete saved.copy;
    return saved;
  }

  #changed = (): void => {
    this.#saver.change(() => this.#snapshot());
  };

  readonly snapshots: Snapshots = {
    get: (key) => this.#x.oracles[key],
    // Keys are added in the order rolled, so the last one with this id is the newest.
    latest: (id) => {
      const keys = Object.keys(this.#x.oracles).filter((k) => k.startsWith(`${id}@`));
      return keys.length ? this.#x.oracles[keys[keys.length - 1]] : undefined;
    },
    put: (key, packed) => {
      this.#x.oracles[key] = packed;
      this.#changed();
    },
  };

  readonly bags: Bags = {
    get: (id) => this.#x.bags[id] ?? [],
    set: (id, labels) => {
      if (labels.length) this.#x.bags[id] = labels;
      else delete this.#x.bags[id];
      this.#changed();
    },
  };

  get recent(): readonly string[] {
    return this.#x.recent;
  }

  /** An oracle was rolled: it goes to the front of the slash menu. */
  noteUsed(id: string): void {
    this.#x.recent = [id, ...this.#x.recent.filter((r) => r !== id)].slice(0, RECENT_MAX);
    this.#changed();
  }

  setFolders(folders: string[]): void {
    this.#x.folders = [...new Set(folders)].sort((a, b) => a.localeCompare(b));
    this.#changed();
    this.#emit();
  }

  /** The journal's copy of its folders, as the open journal has it now. */
  get copy(): LibraryCopy | null {
    return this.#x.copy;
  }

  /** Keeps a new copy; the same object again (nothing changed) saves nothing. */
  setCopy(copy: LibraryCopy | null): void {
    if (copy === this.#x.copy) return;
    this.#x.copy = copy;
    this.#changed();
  }

  setCommands(commands: JournalCommand[]): void {
    this.#x.commands = clone(commands);
    this.#changed();
    this.#emit();
  }

  /**
   * Switches to another journal. The open one is saved first; if that save
   * fails, nothing switches, because the unsaved words live only in the editor.
   */
  async open(id: string): Promise<boolean> {
    if (this.#current?.id === id) return true;
    if (!(await this.flush())) return false;
    const j = await this.#store.get(id);
    if (!j) {
      this.#problem = "That journal could not be found.";
      this.#emit();
      return false;
    }
    this.#load(j);
    await this.#store.setLastOpen(id);
    this.#emit();
    return true;
  }

  #load(j: Journal): void {
    this.#editor?.destroy();
    this.#statusEditor?.destroy();
    this.#current = j;
    this.#title = j.title;
    this.#x = extrasOf(j);
    // Fresh editors per journal, so Undo never reaches into another journal.
    this.#editor = this.#make(j.doc, this.#changed, "story");
    this.#statusEditor = this.#make(j.status ?? clone(EMPTY_DOC), this.#changed, "status");
  }

  async create(): Promise<boolean> {
    if (!(await this.flush())) return false;
    const j = newJournal(freshTitle(this.#journals.map((s) => s.title)));
    await this.#store.put(j);
    this.#journals = [summarize(j), ...this.#journals];
    return this.open(j.id);
  }

  setTitle(raw: string): void {
    this.#title = raw;
    this.#changed();
    this.#emit();
  }

  /** The open journal exactly as it would be saved, after saving it. */
  async current(): Promise<Journal | null> {
    if (!this.#current) return null;
    await this.flush();
    return this.#snapshot();
  }

  /** True when a journal with this id is already here. */
  has(id: string): boolean {
    return this.#journals.some((j) => j.id === id);
  }

  /**
   * Brings in a journal from a file and opens it. If one with its id is
   * already here: "replace" overwrites it, "copy" keeps both (the file's gets
   * a new id and a name of its own).
   */
  async importJournal(raw: unknown, choice: ImportChoice = "copy"): Promise<boolean> {
    if (!isJournal(raw)) {
      this.#problem = "That file is not a Storyboard journal.";
      this.#emit();
      return false;
    }
    if (!(await this.flush())) return false;
    const j = clone(raw);
    if (this.has(j.id) && choice === "copy") {
      j.id = newId();
      j.title = freshTitle(this.#journals.map((s) => s.title), cleanTitle(j.title));
    }
    j.title = cleanTitle(j.title);
    await this.#store.put(j);
    this.#journals = [summarize(j), ...this.#journals.filter((s) => s.id !== j.id)];
    // Opened afresh even when it replaces the journal on screen.
    if (this.#current?.id === j.id) this.#current = null;
    return this.open(j.id);
  }

  /** Saves now. False, with the problem stated, when the save failed. */
  async flush(): Promise<boolean> {
    try {
      await this.#saver.flush();
      return true;
    } catch {
      this.#problem = "Could not save just now. Your writing is still here; it will keep trying.";
      this.#emit();
      return false;
    }
  }

  get dirty(): boolean {
    return this.#saver.dirty;
  }

  destroy(): void {
    this.#editor?.destroy();
    this.#statusEditor?.destroy();
    this.#editor = null;
    this.#statusEditor = null;
  }
}

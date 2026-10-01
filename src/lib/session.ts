/**
 * The open journal and everything around it: which journals exist, which one
 * is in the editor, its title, and keeping it saved. The Svelte components only
 * show this and call into it, so the logic is typechecked and testable here.
 */

import type { Editor } from "@tiptap/core";
import { Autosaver, type SaveStatus } from "./autosave.ts";
import { cleanTitle, freshTitle, newJournal, summarize, type DocJSON, type Journal, type JournalSummary } from "./journal.ts";
import type { JournalStore } from "./store.ts";

export interface SessionView {
  journals: JournalSummary[];
  currentId: string | null;
  title: string;
  status: SaveStatus;
  /** Set when something could not be done, in words for the writer. */
  problem: string | null;
}

/** Makes the editor for a document; the app passes Tiptap, a test passes a fake. */
export type MakeEditor = (doc: DocJSON, onChange: () => void) => Pick<Editor, "getJSON" | "destroy">;

export class Session {
  #store: JournalStore;
  #make: MakeEditor;
  #notify: (view: SessionView) => void;
  #saver: Autosaver<Journal>;
  #current: Journal | null = null;
  #editor: ReturnType<MakeEditor> | null = null;
  #journals: JournalSummary[] = [];
  #title = "";
  #status: SaveStatus = "saved";
  #problem: string | null = null;

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
    };
  }

  #emit(): void {
    this.#notify(this.view());
  }

  get editor() {
    return this.#editor;
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
   * What gets saved: the journal as it stands, read from the editor only now.
   * Stamped when it is read, so "modified" is when the words were saved.
   */
  #snapshot(): Journal {
    const j = this.#current!;
    return { ...j, title: cleanTitle(this.#title), doc: this.#editor!.getJSON() as DocJSON, modified: new Date().toISOString() };
  }

  #changed = (): void => {
    this.#saver.change(() => this.#snapshot());
  };

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
    this.#editor?.destroy();
    this.#current = j;
    this.#title = j.title;
    // A fresh editor per journal, so Undo never reaches into another journal.
    this.#editor = this.#make(j.doc, this.#changed);
    await this.#store.setLastOpen(id);
    this.#emit();
    return true;
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
    this.#editor = null;
  }
}

/**
 * Where journals live in the browser.
 *
 * One interface, two implementations: IndexedDB for the app, memory for the
 * unit tests (Node has no IndexedDB). Everything Sekwe keeps in the
 * browser is named "sekwe…", so it never meets Orangey's data, which
 * shares this site's storage.
 */

import { byRecent, isJournal, summarize, type Journal, type JournalSummary } from "./journal.ts";

export const DB_NAME = "sekwe";
const DB_VERSION = 1;
const JOURNALS = "journals";
const META = "meta";
const LAST_OPEN = "lastOpen";

export interface JournalStore {
  list(): Promise<JournalSummary[]>;
  get(id: string): Promise<Journal | null>;
  put(journal: Journal): Promise<void>;
  lastOpen(): Promise<string | null>;
  setLastOpen(id: string): Promise<void>;
}

export class MemoryStore implements JournalStore {
  #journals = new Map<string, Journal>();
  #last: string | null = null;
  /** Lets a test make the next writes fail. */
  failNext = 0;

  async list(): Promise<JournalSummary[]> {
    return [...this.#journals.values()].map(summarize).sort(byRecent);
  }
  async get(id: string): Promise<Journal | null> {
    const j = this.#journals.get(id);
    return j ? structuredClone(j) : null;
  }
  async put(journal: Journal): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("write failed (test)");
    }
    this.#journals.set(journal.id, structuredClone(journal));
  }
  async lastOpen(): Promise<string | null> {
    return this.#last;
  }
  async setLastOpen(id: string): Promise<void> {
    this.#last = id;
  }
}

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class IndexedDbStore implements JournalStore {
  #db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.#db = db;
  }

  static async open(name = DB_NAME): Promise<IndexedDbStore> {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(JOURNALS)) db.createObjectStore(JOURNALS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    return new IndexedDbStore(await request(req));
  }

  #tx(stores: string[], mode: IDBTransactionMode) {
    return this.#db.transaction(stores, mode);
  }

  async list(): Promise<JournalSummary[]> {
    const all = await request(this.#tx([JOURNALS], "readonly").objectStore(JOURNALS).getAll());
    return all.filter(isJournal).map(summarize).sort(byRecent);
  }

  async get(id: string): Promise<Journal | null> {
    const v = await request(this.#tx([JOURNALS], "readonly").objectStore(JOURNALS).get(id));
    return isJournal(v) ? v : null;
  }

  /** Resolves once the write is committed, not merely queued. */
  async put(journal: Journal): Promise<void> {
    const tx = this.#tx([JOURNALS], "readwrite");
    tx.objectStore(JOURNALS).put(journal);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("write aborted"));
    });
  }

  async lastOpen(): Promise<string | null> {
    const v = await request(this.#tx([META], "readonly").objectStore(META).get(LAST_OPEN));
    return typeof v === "string" ? v : null;
  }

  async setLastOpen(id: string): Promise<void> {
    const tx = this.#tx([META], "readwrite");
    tx.objectStore(META).put(id, LAST_OPEN);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Saving while the writer types, without ever getting in their way.
 *
 * A change only marks the journal dirty; nothing is read from the editor until
 * the save actually runs, `delayMs` after the last change and at an idle
 * moment. So typing costs a timer reset per keystroke, never a serialisation
 * of the whole document.
 *
 * One write at a time. A change during a write is saved right after it. A
 * failed write is retried with a growing pause, and is never allowed to
 * overwrite a newer change. `flush()` saves now and resolves when nothing is
 * left to save: for switching journals, hiding the tab and closing it.
 */

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaverOptions<T> {
  write: (snapshot: T) => Promise<void>;
  delayMs?: number;
  retryMs?: number;
  retryMaxMs?: number;
  clock?: Clock;
  /** Runs `fn` when the page is idle; defaults to requestIdleCallback where there is one. */
  idle?: (fn: () => void) => void;
  onStatus?: (status: SaveStatus, error?: unknown) => void;
}

export const SAVE_DELAY_MS = 500;
const RETRY_MS = 2000;
const RETRY_MAX_MS = 30000;
/** The longest an idle callback may wait: a busy page still saves. */
const IDLE_TIMEOUT_MS = 1000;

const defaultClock: Clock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

function defaultIdle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: IDLE_TIMEOUT_MS });
  else globalThis.setTimeout(fn, 0);
}

export class Autosaver<T> {
  #write: (snapshot: T) => Promise<void>;
  #delay: number;
  #retry: number;
  #retryMax: number;
  #clock: Clock;
  #idle: (fn: () => void) => void;
  #onStatus: (status: SaveStatus, error?: unknown) => void;

  /** How to read the latest state, set by the newest change; null when clean. */
  #pending: (() => T) | null = null;
  #timer: unknown = null;
  #saving: Promise<void> | null = null;
  #failures = 0;
  #status: SaveStatus = "saved";

  constructor(o: AutosaverOptions<T>) {
    this.#write = o.write;
    this.#delay = o.delayMs ?? SAVE_DELAY_MS;
    this.#retry = o.retryMs ?? RETRY_MS;
    this.#retryMax = o.retryMaxMs ?? RETRY_MAX_MS;
    this.#clock = o.clock ?? defaultClock;
    this.#idle = o.idle ?? defaultIdle;
    this.#onStatus = o.onStatus ?? (() => {});
  }

  get status(): SaveStatus {
    return this.#status;
  }

  #set(status: SaveStatus, error?: unknown): void {
    this.#status = status;
    this.#onStatus(status, error);
  }

  /** Something changed; `read` returns the state to save when the save runs. */
  change(read: () => T): void {
    this.#pending = read;
    if (this.#status !== "error") this.#set("unsaved");
    this.#arm(this.#delay);
  }

  #arm(ms: number): void {
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = null;
      this.#idle(() => void this.#run());
    }, ms);
  }

  async #run(): Promise<void> {
    if (this.#saving) return this.#saving;
    const read = this.#pending;
    if (!read) return;
    this.#pending = null;
    this.#set("saving");
    this.#saving = (async () => {
      try {
        await this.#write(read());
        this.#failures = 0;
        if (this.#pending) this.#set("unsaved");
        else this.#set("saved");
      } catch (error) {
        // Put it back unless something newer is already waiting.
        if (!this.#pending) this.#pending = read;
        this.#failures++;
        this.#set("error", error);
        this.#arm(Math.min(this.#retry * 2 ** (this.#failures - 1), this.#retryMax));
      } finally {
        this.#saving = null;
      }
    })();
    await this.#saving;
    // A change arrived during the write: save it now rather than after a delay.
    if (this.#pending && this.#status !== "error") await this.#run();
  }

  /**
   * Save now. Resolves when nothing is pending, or rejects if a write fails
   * (the change stays queued and is retried).
   */
  async flush(): Promise<void> {
    if (this.#timer !== null) {
      this.#clock.clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#saving) await this.#saving;
    if (!this.#pending) return;
    await this.#run();
    if (this.#status === "error") throw new Error("could not save");
  }

  get dirty(): boolean {
    return this.#pending !== null || this.#saving !== null;
  }
}

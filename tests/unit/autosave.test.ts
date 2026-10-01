import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Autosaver, type Clock, type SaveStatus } from "../../src/lib/autosave.ts";

/** A clock the test moves by hand, and an idle hook that runs at once. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
  };
  async function advance(ms: number) {
    const until = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await settle();
    }
    now = until;
    await settle();
  }
  return { clock, advance, pending: () => timers.size };
}

/** Let promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function harness(opts: { fail?: number; slowWrite?: boolean } = {}) {
  const { clock, advance, pending } = fakeClock();
  const writes: string[] = [];
  const statuses: SaveStatus[] = [];
  let fail = opts.fail ?? 0;
  let release: (() => void) | null = null;
  const saver = new Autosaver<string>({
    clock,
    idle: (fn) => fn(),
    delayMs: 500,
    retryMs: 1000,
    retryMaxMs: 4000,
    onStatus: (s) => statuses.push(s),
    write: async (text) => {
      if (opts.slowWrite) await new Promise<void>((r) => (release = r));
      if (fail > 0) {
        fail--;
        throw new Error("disk full");
      }
      writes.push(text);
    },
  });
  return { saver, writes, statuses, advance, pending, release: () => release?.() };
}

describe("autosave", () => {
  test("waits for a pause in typing, then saves once, reading the text only then", async () => {
    const h = harness();
    let reads = 0;
    let text = "";
    for (const ch of "Hello") {
      text += ch;
      h.saver.change(() => (reads++, text));
      await h.advance(100);
    }
    assert.deepEqual(h.writes, [], "saved while still typing");
    assert.equal(reads, 0, "the editor was read before the save ran");
    await h.advance(500);
    assert.deepEqual(h.writes, ["Hello"]);
    assert.equal(reads, 1);
    assert.equal(h.saver.status, "saved");
  });

  test("a change during a slow write is saved right after it, never lost", async () => {
    const h = harness({ slowWrite: true });
    let text = "one";
    h.saver.change(() => text);
    await h.advance(500);
    assert.equal(h.saver.status, "saving");
    text = "one two";
    h.saver.change(() => text);
    h.release();
    await settle();
    h.release();
    await settle();
    assert.deepEqual(h.writes, ["one", "one two"]);
    assert.equal(h.saver.status, "saved");
  });

  test("a failed write is retried with a growing pause, and says so meanwhile", async () => {
    const h = harness({ fail: 2 });
    h.saver.change(() => "draft");
    await h.advance(500);
    assert.equal(h.saver.status, "error");
    assert.deepEqual(h.writes, []);
    await h.advance(999);
    assert.deepEqual(h.writes, [], "retried too soon");
    await h.advance(1);
    assert.equal(h.saver.status, "error", "second attempt also fails");
    await h.advance(2000);
    assert.deepEqual(h.writes, ["draft"]);
    assert.equal(h.saver.status, "saved");
  });

  test("a retry never puts back an older text over a newer change", async () => {
    const h = harness({ fail: 1 });
    let text = "old";
    h.saver.change(() => text);
    await h.advance(500);
    text = "new";
    h.saver.change(() => text);
    await h.advance(5000);
    assert.deepEqual(h.writes, ["new"]);
  });

  test("flush saves at once, and resolves only when nothing is left", async () => {
    const h = harness();
    h.saver.change(() => "before switching");
    assert.equal(h.saver.dirty, true);
    await h.saver.flush();
    assert.deepEqual(h.writes, ["before switching"]);
    assert.equal(h.saver.dirty, false);
    assert.equal(h.pending(), 0, "a timer was left behind");
    await h.saver.flush();
    assert.deepEqual(h.writes, ["before switching"], "flushing a clean saver wrote again");
  });

  test("flush rejects when the write fails, and the change stays queued", async () => {
    const h = harness({ fail: 1 });
    h.saver.change(() => "precious");
    await assert.rejects(h.saver.flush(), /could not save/);
    assert.equal(h.saver.dirty, true);
    await h.advance(1000);
    assert.deepEqual(h.writes, ["precious"]);
  });
});

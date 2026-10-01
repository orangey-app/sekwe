<script lang="ts">
  import { onMount } from "svelte";
  import type { Editor, Range } from "@tiptap/core";
  import Toolbar from "./components/Toolbar.svelte";
  import JournalMenu from "./components/JournalMenu.svelte";
  import ChipPopover from "./components/ChipPopover.svelte";
  import LibraryPanel from "./components/LibraryPanel.svelte";
  import { createEditor } from "./lib/editor.ts";
  import { IndexedDbStore, MemoryStore, type JournalStore } from "./lib/store.ts";
  import { Session, type SessionView } from "./lib/session.ts";
  import type { SaveStatus } from "./lib/autosave.ts";
  import { diceExpression, OracleLibrary, searchOracles, type LibraryStatus } from "./lib/oracles.ts";
  import { Roller } from "./lib/roller.ts";
  import { RollControl } from "./lib/rollnodes.ts";
  import type { SlashItem, SlashSource } from "./lib/slash.ts";
  import { sourceFor } from "../vendor/orangey/src/core/rng.ts";
  import { locateLibrary } from "../vendor/orangey/src/storage/locate.ts";
  import { regrantFolder } from "../vendor/orangey/src/storage/fsdir.ts";

  let view: SessionView = $state({ journals: [], currentId: null, title: "", status: "saved", problem: null });
  let tick = $state(0);
  let editor: Editor | null = $state(null);
  let ready = $state(false);
  let shelfOpen = $state(false);
  let storageNote: string | null = $state(null);
  let notice: string | null = $state(null);
  let libraryStatus: LibraryStatus = $state("idle");
  let oracleCount = $state(0);
  let pageHost: HTMLElement;
  let titleInput: HTMLInputElement;
  let session: Session;
  /** A new journal is named first: its editor must not take the focus. */
  let nameNext = false;

  const params = new URLSearchParams(location.search);
  const debug = params.has("debug");
  /** A page opened from disk is a site of its own, and cannot see Orangey's storage. */
  const fromDisk = location.protocol === "file:";

  // Rolls come from the crypto source; a test may fix a seed with ?debug&seed=…
  const rng = sourceFor(debug ? params.get("seed") : null);
  const library = new OracleLibrary(
    () => locateLibrary("read"),
    () => regrantFolder("read"),
  );
  library.onChange(() => {
    libraryStatus = library.status;
    oracleCount = library.oracles.length;
  });
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (message: string) => {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 5000);
  };
  const roller = new Roller(library, () => session.snapshots, () => rng);
  const control = new RollControl({ roller: () => roller, notice: say });

  async function openFolder() {
    if (await library.openFolder()) say("Your Orangey folder is open.");
    else say("The folder was not opened.");
  }

  const slash: SlashSource = {
    items(query: string): SlashItem[] {
      const out: SlashItem[] = [];
      const dice = diceExpression(query);
      if (dice) out.push({ kind: "dice", expression: dice });
      if (library.status === "needs-folder") out.push({ kind: "open-folder" });
      for (const m of searchOracles(library.oracles, query, 8)) {
        out.push({ kind: "oracle", id: m.oracle.id, name: m.oracle.name, folder: m.oracle.folder });
      }
      if (out.length === 0) {
        out.push({
          kind: "note",
          text:
            fromDisk || library.status === "unavailable"
              ? "No Orangey library here; dice work: /2d6"
              : library.status === "ready"
                ? `No oracle matches “${query.trim()}”`
                : "Your Orangey library is empty; dice work: /2d6",
        });
      }
      return out;
    },
    choose(e: Editor, item: SlashItem, range: Range) {
      if (item.kind === "oracle") {
        const record = roller.oracle(item.id);
        if (record) control.insert(e, record, range);
        else say(`"${item.name}" can no longer be found.`);
      } else if (item.kind === "dice") {
        control.insert(e, roller.dice(item.expression), range);
      } else if (item.kind === "open-folder") {
        e.chain().focus().deleteRange(range).run();
        void openFolder();
      }
    },
  };

  const STATUS: Record<SaveStatus, string> = {
    saved: "Saved",
    unsaved: "Edited",
    saving: "Saving…",
    error: "Not saved — retrying",
  };

  onMount(() => {
    let disposed = false;
    (async () => {
      let store: JournalStore;
      try {
        store = await IndexedDbStore.open();
      } catch {
        // Private windows in some browsers refuse IndexedDB. Writing still
        // works; it just will not outlast the tab, and the page says so.
        store = new MemoryStore();
        storageNote = "This browser is not letting Storyboard keep anything: your writing will be lost when the tab closes.";
      }
      if (disposed) return;
      session = new Session(
        store,
        (doc, onChange) => {
          pageHost.replaceChildren();
          const e = createEditor({ element: pageHost, doc, onChange, onTransaction: () => tick++, focus: !nameNext, control, slash });
          nameNext = false;
          editor = e;
          return e;
        },
        (v) => (view = v),
      );
      await session.start();
      ready = true;
      if (debug) {
        (window as unknown as { storyboard: unknown }).storyboard = { session, store, library, control, get editor() { return editor; } };
      }
      if (fromDisk) libraryStatus = "unavailable";
      else await library.load();
    })();

    // Hiding or closing the tab saves at once rather than after the pause.
    const save = () => {
      if (session?.dirty) void session.flush();
    };
    // Coming back to the tab reads the library again, so a wheel just edited
    // in Orangey rolls as edited. It never touches what is already in the text.
    let lastRead = 0;
    const reread = () => {
      if (fromDisk || library.status === "idle" || library.status === "needs-folder") return;
      if (Date.now() - lastRead < 1000) return;
      lastRead = Date.now();
      void library.refresh();
    };
    const onvisibility = () => (document.visibilityState === "hidden" ? save() : reread());
    document.addEventListener("visibilitychange", onvisibility);
    addEventListener("pagehide", save);
    addEventListener("focus", reread);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onvisibility);
      removeEventListener("pagehide", save);
      removeEventListener("focus", reread);
      session?.destroy();
    };
  });

  async function create() {
    nameNext = true;
    const made = await session.create();
    nameNext = false;
    if (made) {
      titleInput.focus();
      titleInput.select();
    }
  }

  function onkeydown(ev: KeyboardEvent) {
    // Ctrl/⌘+S saves now instead of opening the browser's "Save page" dialog.
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      void session?.flush();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="app" class:ready>
  <header class="topbar">
    <JournalMenu journals={view.journals} currentId={view.currentId} onopen={(id) => session.open(id)} oncreate={create} />
    <input
      class="title"
      bind:this={titleInput}
      value={view.title}
      maxlength="120"
      aria-label="Journal title"
      placeholder="Untitled journal"
      oninput={(ev) => session.setTitle((ev.target as HTMLInputElement).value)}
      onkeydown={(ev) => ev.key === "Enter" && (ev.preventDefault(), editor?.commands.focus())} />
    <span class="status" data-status={view.status} role="status" aria-live="polite">{STATUS[view.status]}</span>
    <button
      type="button"
      class="shelf-toggle"
      class:attention={libraryStatus === "needs-folder"}
      aria-expanded={shelfOpen}
      aria-controls="shelf"
      onclick={() => (shelfOpen = !shelfOpen)}>Oracles</button>
  </header>

  {#if storageNote || view.problem}
    <p class="notice" role="alert">{view.problem ?? storageNote}</p>
  {/if}

  <Toolbar {editor} {tick} />

  <div class="body">
    <main class="sheet">
      <div class="page-host" bind:this={pageHost}></div>
    </main>
    <aside id="shelf" class="shelf" hidden={!shelfOpen} aria-label="Oracles">
      <LibraryPanel status={libraryStatus} count={oracleCount} {fromDisk} onopenfolder={openFolder} />
    </aside>
  </div>

  <ChipPopover {editor} {control} {tick} />

  {#if notice}
    <p class="toast" role="status">{notice}</p>
  {/if}
</div>

<script lang="ts">
  import { onMount } from "svelte";
  import type { Editor } from "@tiptap/core";
  import Toolbar from "./components/Toolbar.svelte";
  import JournalMenu from "./components/JournalMenu.svelte";
  import { createEditor } from "./lib/editor.ts";
  import { IndexedDbStore, MemoryStore, type JournalStore } from "./lib/store.ts";
  import { Session, type SessionView } from "./lib/session.ts";
  import type { SaveStatus } from "./lib/autosave.ts";

  let view: SessionView = $state({ journals: [], currentId: null, title: "", status: "saved", problem: null });
  let tick = $state(0);
  let editor: Editor | null = $state(null);
  let ready = $state(false);
  let shelfOpen = $state(false);
  let storageNote: string | null = $state(null);
  let pageHost: HTMLElement;
  let titleInput: HTMLInputElement;
  let session: Session;
  /** A new journal is named first: its editor must not take the focus. */
  let nameNext = false;

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
          const e = createEditor({ element: pageHost, doc, onChange, onTransaction: () => tick++, focus: !nameNext });
          nameNext = false;
          editor = e;
          return e;
        },
        (v) => (view = v),
      );
      await session.start();
      ready = true;
      if (new URLSearchParams(location.search).has("debug")) {
        (window as unknown as { storyboard: unknown }).storyboard = { session, store, get editor() { return editor; } };
      }
    })();

    // Hiding or closing the tab saves at once rather than after the pause.
    const save = () => {
      if (session?.dirty) void session.flush();
    };
    const onvisibility = () => document.visibilityState === "hidden" && save();
    document.addEventListener("visibilitychange", onvisibility);
    addEventListener("pagehide", save);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onvisibility);
      removeEventListener("pagehide", save);
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
    <button type="button" class="shelf-toggle" aria-expanded={shelfOpen} aria-controls="shelf" onclick={() => (shelfOpen = !shelfOpen)}>Oracles</button>
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
      <p class="shelf-empty">Oracles from your Orangey library will sit here, ready to roll into the text.</p>
    </aside>
  </div>
</div>

<script lang="ts">
  import { onMount } from "svelte";
  import type { Editor, Range } from "@tiptap/core";
  import Toolbar from "./components/Toolbar.svelte";
  import FileMenu from "./components/FileMenu.svelte";
  import ChipPopover from "./components/ChipPopover.svelte";
  import LibraryPanel from "./components/LibraryPanel.svelte";
  import CommandsPanel from "./components/CommandsPanel.svelte";
  import ContentsPanel from "./components/ContentsPanel.svelte";
  import SidePanel from "./components/SidePanel.svelte";
  import { createEditor } from "./lib/editor.ts";
  import { IndexedDbStore, MemoryStore, type JournalStore } from "./lib/store.ts";
  import { Session, type SessionView } from "./lib/session.ts";
  import type { SaveStatus } from "./lib/autosave.ts";
  import { diceExpression, inFolders, OracleLibrary, searchOracles, type LibraryStatus, type Oracle } from "./lib/oracles.ts";
  import { Roller } from "./lib/roller.ts";
  import { fromCopy, keepCopy } from "./lib/copy.ts";
  import { RollControl } from "./lib/rollnodes.ts";
  import { pickAtCursor, type SlashItem, type SlashSource } from "./lib/slash.ts";
  import { fileStem, FILE_SUFFIX, outline, toFile, toHtml, toMarkdown, type OutlineEntry } from "./lib/export.ts";
  import { openText, saveText, download } from "./lib/files.ts";
  import { loadPrefs, savePrefs, WIDTHS, type PageWidth } from "./lib/prefs.ts";
  import type { JournalCommand } from "./lib/journal.ts";
  import type { RollRecord } from "./lib/rolls.ts";
  import { sourceFor } from "../vendor/orangey/src/core/rng.ts";
  import { locateLibrary } from "../vendor/orangey/src/storage/locate.ts";
  import { regrantFolder } from "../vendor/orangey/src/storage/fsdir.ts";

  let view: SessionView = $state({ journals: [], currentId: null, title: "", status: "saved", problem: null, folders: [], commands: [] });
  let tick = $state(0);
  let editor: Editor | null = $state(null);
  let statusEditor: Editor | null = $state(null);
  /** The editor being written in: the story or the status panel. The toolbar and the panel's rolls act on it. */
  let active: Editor | null = $state(null);
  let ready = $state(false);
  let storageNote: string | null = $state(null);
  let notice: string | null = $state(null);
  let libraryStatus: LibraryStatus = $state("idle");
  let oracleList: Oracle[] = $state([]);
  /** How many of those come from the journal's copy, and when it was saved. */
  let keptCount = $state(0);
  let copySaved: string | null = $state(null);
  let outlineEntries: OutlineEntry[] = $state([]);
  let duplicate: { raw: unknown; title: string } | null = $state(null);
  let pageHost: HTMLElement;
  let statusHost: HTMLElement;
  let titleInput: HTMLInputElement;
  let session: Session;
  /** A new journal is named first: its editor must not take the focus. */
  let nameNext = false;

  const prefs = $state(loadPrefs());
  $effect(() => savePrefs({ width: prefs.width, panelOpen: prefs.panelOpen, panelTab: prefs.panelTab }));

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
  let lastLive: Oracle[] | null = null;
  library.onChange(() => {
    libraryStatus = library.status;
    oracleList = library.oracles;
    keptCount = library.fromCopy;
    if (library.live !== lastLive) {
      lastLive = library.live;
      syncCopy();
    }
  });

  /**
   * Brings the journal's copy of its folders up to date with the library here
   * and hands it to the library (copy.ts has the rules). Runs when the library
   * is read, when another journal opens, and when the folders change.
   */
  function syncCopy() {
    if (!session?.view().currentId) return;
    const next = keepCopy(library.live, session.view().folders, session.copy);
    session.setCopy(next);
    copySaved = next?.saved ?? null;
    library.setKept(fromCopy(next));
  }
  let lastJournalKey = "";
  function onView(v: SessionView) {
    view = v;
    const key = JSON.stringify([v.currentId, v.folders]);
    if (key !== lastJournalKey) {
      lastJournalKey = key;
      syncCopy();
    }
  }
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (message: string) => {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 5000);
  };
  const roller = new Roller(library, () => session.snapshots, () => rng, () => new Date(), () => session.bags);
  roller.onRefill = (name) => say(`The bag “${name}” had given out everything; it is full again.`);
  const control = new RollControl({
    roller: () => roller,
    notice: say,
    pick: (e, name, choices) => pickAtCursor(e, name, choices),
    used: (id) => session.noteUsed(id),
  });

  async function openFolder() {
    if (await library.openFolder()) say("Your Orangey folder is open.");
    else say("The folder was not opened.");
  }

  /** The oracles this journal rolls from: its folders, or all of them. */
  const usable = () => inFolders(library.oracles, session?.view().folders ?? []);

  /** The words just before the "/" being typed, for ranking oracles they name. */
  function contextBefore(e: Editor, query: string): string {
    const { from } = e.state.selection;
    const text = e.state.doc.textBetween(Math.max(0, from - 240), from, " ", " ");
    return text.slice(0, Math.max(0, text.length - query.length - 1));
  }

  const slash: SlashSource = {
    items(query: string, e: Editor): SlashItem[] {
      const out: SlashItem[] = [];
      const q = query.trim().toLowerCase();
      for (const c of session.view().commands) {
        if (q && c.name.startsWith(q.split(" ")[0])) out.push({ kind: "command", name: c.name, count: c.steps.length });
      }
      const dice = diceExpression(query);
      if (dice) out.push({ kind: "dice", expression: dice });
      if (library.status === "needs-folder") out.push({ kind: "open-folder" });
      for (const m of searchOracles(usable(), query, 8, { recent: session.recent, context: contextBefore(e, query) })) {
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
      if (item.kind === "oracle") void control.rollOracle(e, item.id, item.name, range);
      else if (item.kind === "dice") control.insert(e, roller.dice(item.expression), range);
      else if (item.kind === "command") void runCommand(e, item.name, range);
      else if (item.kind === "open-folder") {
        e.chain().focus().deleteRange(range).run();
        void openFolder();
      }
    },
  };

  /** A journal's own command: every roll it lists, one chip each, in order. */
  async function runCommand(e: Editor, name: string, range: Range) {
    const command = session.view().commands.find((c) => c.name === name);
    e.chain().focus().deleteRange(range).run();
    if (!command) return;
    const records: RollRecord[] = [];
    for (const step of command.steps) {
      if (step.kind === "dice") records.push(roller.dice(step.expression));
      else {
        const r = await control.settle(e, roller.start(step.id, undefined, step.name));
        if (r) records.push(r);
      }
    }
    control.insertMany(e, records);
  }

  const STATUS: Record<SaveStatus, string> = {
    saved: "Saved",
    unsaved: "Edited",
    saving: "Saving…",
    error: "Not saved — retrying",
  };

  function refreshContents() {
    outlineEntries = editor ? outline(editor.state.doc) : [];
  }

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
        storageNote = "This browser is not letting Storyboard keep anything: your writing will be lost when the tab closes. Save it to a file from the File menu.";
      }
      if (disposed) return;
      session = new Session(
        store,
        (doc, onChange, role) => {
          const host = role === "story" ? pageHost : statusHost;
          host.replaceChildren();
          const e = createEditor({
            element: host,
            doc,
            onChange: () => {
              onChange();
              if (role === "story") refreshContents();
            },
            onTransaction: () => tick++,
            focus: role === "story" && !nameNext,
            control,
            slash,
            label: role === "story" ? undefined : "Status",
          });
          e.on("focus", () => (active = e));
          if (role === "story") {
            nameNext = false;
            editor = e;
            active = e;
            queueMicrotask(refreshContents);
          } else statusEditor = e;
          return e;
        },
        onView,
      );
      await session.start();
      ready = true;
      if (debug) {
        (window as unknown as { storyboard: unknown }).storyboard = {
          session,
          store,
          library,
          control,
          get editor() {
            return editor;
          },
          get statusEditor() {
            return statusEditor;
          },
        };
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

  // --- files ---------------------------------------------------------------------------

  async function saveToFile(ask = false) {
    const j = await session.current();
    if (!j) return;
    const outcome = await saveText(`${fileStem(j.title)}${FILE_SUFFIX}`, toFile(j), "application/json", {
      key: j.id,
      ask,
      description: "Storyboard journal",
      extension: ".json",
    });
    if (outcome === "written") say("Saved to the file.");
    else if (outcome === "downloaded") say("The journal file is in your downloads.");
  }

  async function openFile() {
    const file = await openText(".json,application/json");
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(file.text);
    } catch {
      say(`“${file.name}” is not a Storyboard journal.`);
      return;
    }
    const id = (raw as { id?: unknown })?.id;
    if (typeof id === "string" && session.has(id)) {
      duplicate = { raw, title: String((raw as { title?: unknown }).title ?? "This journal") };
      return;
    }
    if (await session.importJournal(raw)) say(`Opened “${view.title}”.`);
  }

  async function resolveDuplicate(choice: "replace" | "copy" | null) {
    const d = duplicate;
    duplicate = null;
    if (!d || !choice) return;
    if (await session.importJournal(d.raw, choice)) say(choice === "replace" ? "The journal was replaced by the file." : "The file was opened as a copy.");
  }

  async function exportAs(kind: "markdown" | "html") {
    const j = await session.current();
    if (!j) return;
    if (kind === "markdown") download(`${fileStem(j.title)}.md`, toMarkdown(j), "text/markdown");
    else download(`${fileStem(j.title)}.html`, toHtml(j), "text/html");
    say(kind === "markdown" ? "The Markdown file is in your downloads." : "The web page is in your downloads.");
  }

  function print() {
    void session.flush();
    window.print();
  }

  // --- the side panel ------------------------------------------------------------------

  function rollFromPanel(o: Oracle) {
    const target = active ?? editor;
    if (target) void control.rollOracle(target, o.id, o.name);
  }

  function jump(entry: OutlineEntry) {
    if (!editor) return;
    editor.chain().focus().setTextSelection(entry.pos + 1).run();
    const dom = editor.view.nodeDOM(entry.pos) as HTMLElement | null;
    dom?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function onkeydown(ev: KeyboardEvent) {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod || ev.altKey) return;
    const k = ev.key.toLowerCase();
    // Ctrl/⌘+S saves in the browser now; with Shift, to a file.
    if (k === "s") {
      ev.preventDefault();
      if (ev.shiftKey) void saveToFile();
      else void session?.flush();
    } else if (k === "o" && !ev.shiftKey) {
      ev.preventDefault();
      void openFile();
    } else if (k === "p" && !ev.shiftKey) {
      ev.preventDefault();
      print();
    }
  }

  const setWidth = (w: PageWidth) => (prefs.width = w);
  const setFolders = (f: string[]) => session.setFolders(f);
  const setCommands = (c: JournalCommand[]) => session.setCommands(c);
</script>

<svelte:window {onkeydown} />

<div class="app width-{prefs.width}" class:ready class:panel-open={prefs.panelOpen}>
  <header class="topbar">
    <FileMenu
      journals={view.journals}
      currentId={view.currentId}
      oncreate={create}
      onswitch={(id) => session.open(id)}
      onbrowse={openFile}
      onsave={() => saveToFile()}
      onsaveas={() => saveToFile(true)}
      onmarkdown={() => exportAs("markdown")}
      onhtml={() => exportAs("html")}
      onprint={print} />
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
    <select class="width-select" aria-label="Page width" title="Page width" value={prefs.width} onchange={(ev) => setWidth((ev.target as HTMLSelectElement).value as PageWidth)}>
      {#each WIDTHS as w (w.value)}<option value={w.value}>{w.label}</option>{/each}
    </select>
    <button
      type="button"
      class="shelf-toggle"
      class:attention={libraryStatus === "needs-folder"}
      aria-expanded={prefs.panelOpen}
      aria-controls="shelf"
      onclick={() => (prefs.panelOpen = !prefs.panelOpen)}>Side panel</button>
  </header>

  {#if storageNote || view.problem}
    <p class="notice" role="alert">{view.problem ?? storageNote}</p>
  {/if}

  <Toolbar editor={active} {tick} />

  <div class="body">
    <main class="sheet">
      <div class="page-host" bind:this={pageHost}></div>
    </main>
    <aside id="shelf" class="shelf side" hidden={!prefs.panelOpen} aria-label="Side panel">
      <SidePanel bind:tab={prefs.panelTab}>
        {#snippet status()}
          <p class="hint status-hint">Keep track of anything here: health, supplies, threads, people. Tables and rolls work here too.</p>
          <div class="status-host" bind:this={statusHost}></div>
        {/snippet}
        {#snippet oracles()}
          <LibraryPanel
            status={libraryStatus}
            oracles={oracleList}
            kept={keptCount}
            {copySaved}
            folders={view.folders}
            {fromDisk}
            onopenfolder={openFolder}
            onfolders={setFolders}
            onroll={rollFromPanel} />
        {/snippet}
        {#snippet contents()}
          <ContentsPanel entries={outlineEntries} onjump={jump} />
        {/snippet}
        {#snippet commands()}
          <CommandsPanel commands={view.commands} oracles={inFolders(oracleList, view.folders)} onchange={setCommands} />
        {/snippet}
      </SidePanel>
    </aside>
  </div>

  <ChipPopover editor={active} {control} {tick} />

  {#if duplicate}
    <div class="dialog-backdrop">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dup-title">
        <h2 id="dup-title">“{duplicate.title}” is already here</h2>
        <p>This file is a saved copy of a journal you already have. Replace the journal with the file, or keep both?</p>
        <div class="form-actions">
          <button type="button" class="open-folder" data-choice="replace" onclick={() => resolveDuplicate("replace")}>Replace it</button>
          <button type="button" class="open-folder" data-choice="copy" onclick={() => resolveDuplicate("copy")}>Keep both</button>
          <button type="button" class="link-button" data-choice="cancel" onclick={() => resolveDuplicate(null)}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}

  {#if notice}
    <p class="toast" role="status">{notice}</p>
  {/if}
</div>

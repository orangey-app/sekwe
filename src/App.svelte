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
  import { canWriteFiles, fileFor, forgetFile, openText, rememberFile, saveText, download, type FileHandle } from "./lib/files.ts";
  import { clampPanelWidth, loadPrefs, PANEL_DEFAULT, PANEL_MAX, PANEL_MIN, savePrefs, WIDTHS, type PageWidth } from "./lib/prefs.ts";
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
  let duplicate: { raw: unknown; title: string; handle?: FileHandle } | null = $state(null);
  /** The file the open journal belongs to (Chrome, Edge), for the File menu. */
  let currentFile: string | null = $state(null);
  /** Save as without a file picker: the name being asked for. */
  let namePrompt: { resolve: (name: string | null) => void } | null = $state(null);
  let nameValue = $state("");
  let nameInput: HTMLInputElement | undefined = $state();
  $effect(() => {
    if (namePrompt && nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  });
  function askName(suggested: string): Promise<string | null> {
    nameValue = suggested;
    return new Promise((resolve) => (namePrompt = { resolve }));
  }
  function answerName(name: string | null) {
    const p = namePrompt;
    namePrompt = null;
    p?.resolve(name);
  }
  // Several can be under way at once (a switch, then a save): only the latest counts.
  let fileAsk = 0;
  async function refreshFile() {
    const ask = ++fileAsk;
    const id = session?.view().currentId;
    const name = id ? ((await fileFor(id))?.name ?? null) : null;
    if (ask === fileAsk && id === session?.view().currentId) currentFile = name;
  }
  let pageHost: HTMLElement;
  let statusHost: HTMLElement;
  let titleInput: HTMLInputElement;
  let session: Session;
  /** A new journal is named first: its editor must not take the focus. */
  let nameNext = false;

  const prefs = $state(loadPrefs());
  $effect(() => savePrefs({ width: prefs.width, panelWidth: prefs.panelWidth, panelOpen: prefs.panelOpen, panelTab: prefs.panelTab }));

  // The side panel's width: drag its left edge, or focus the edge and use the
  // arrow keys; a double-click puts it back. Kept per browser.
  let windowWidth = $state(typeof innerWidth === "number" ? innerWidth : 1280);
  const panelWidth = $derived(clampPanelWidth(prefs.panelWidth, windowWidth));
  let dragging = $state(false);
  function startResize(ev: PointerEvent) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const handle = ev.currentTarget as HTMLElement;
    handle.setPointerCapture(ev.pointerId);
    const startX = ev.clientX;
    const startW = panelWidth;
    dragging = true;
    const move = (e: PointerEvent) => (prefs.panelWidth = clampPanelWidth(startW + (startX - e.clientX), windowWidth));
    const end = () => {
      dragging = false;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function resizeKey(ev: KeyboardEvent) {
    const step = ev.shiftKey ? 64 : 16;
    const by: Record<string, number> = { ArrowLeft: step, ArrowRight: -step };
    if (ev.key in by) prefs.panelWidth = clampPanelWidth(panelWidth + by[ev.key], windowWidth);
    else if (ev.key === "Home") prefs.panelWidth = PANEL_MIN;
    else if (ev.key === "End") prefs.panelWidth = PANEL_MAX;
    else return;
    ev.preventDefault();
  }

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
      void refreshFile();
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
        storageNote = "This browser is not letting Sekwe keep anything: your writing will be lost when the tab closes. Save it to a file from the File menu.";
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
        (window as unknown as { sekwe: unknown }).sekwe = {
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
      description: "Sekwe journal",
      suffix: FILE_SUFFIX,
      extension: ".json",
      askName,
    });
    if (outcome.kind === "written") say(`Saved to ${outcome.file}.`);
    else if (outcome.kind === "downloaded") say(`${outcome.file} is in your downloads.`);
    await refreshFile();
  }

  async function openFile() {
    const file = await openText(".json,application/json", { description: "Sekwe journal", mime: "application/json", extensions: [".json"] });
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(file.text);
    } catch {
      say(`“${file.name}” is not a Sekwe journal.`);
      return;
    }
    const id = (raw as { id?: unknown })?.id;
    if (typeof id === "string" && session.has(id)) {
      duplicate = { raw, title: String((raw as { title?: unknown }).title ?? "This journal"), handle: file.handle };
      return;
    }
    if (await session.importJournal(raw)) {
      // Opened from its file: Save writes back to it.
      if (file.handle && view.currentId) await rememberFile(view.currentId, file.handle);
      await refreshFile();
      say(`Opened “${view.title}”.`);
    }
  }

  async function resolveDuplicate(choice: "replace" | "copy" | null) {
    const d = duplicate;
    duplicate = null;
    if (!d || !choice) return;
    if (await session.importJournal(d.raw, choice)) {
      // Replaced: the journal now belongs to the file opened. Kept as a copy:
      // the copy has no file yet, so Save cannot write over the original's.
      const id = view.currentId;
      if (id && choice === "replace") {
        if (d.handle) await rememberFile(id, d.handle);
      } else if (id) await forgetFile(id);
      await refreshFile();
      say(choice === "replace" ? "The journal was replaced by the file." : "The file was opened as a copy.");
    }
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
    // Ctrl/⌘+S saves to the journal's file (asking where the first time);
    // with Shift, Save as. The browser copy is saved as you type anyway.
    if (k === "s") {
      ev.preventDefault();
      void saveToFile(ev.shiftKey);
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

<svelte:window {onkeydown} bind:innerWidth={windowWidth} />

<div class="app width-{prefs.width}" class:ready class:panel-open={prefs.panelOpen} class:resizing={dragging}>
  <header class="topbar">
    <FileMenu
      journals={view.journals}
      currentId={view.currentId}
      oncreate={create}
      onswitch={(id) => session.open(id)}
      onbrowse={openFile}
      {currentFile}
      canWrite={canWriteFiles()}
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
    {#if prefs.panelOpen}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="shelf-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-controls="shelf"
        aria-label="Side panel width"
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        aria-valuenow={panelWidth}
        tabindex="0"
        title="Drag to change the side panel's width; double-click for the usual width"
        onpointerdown={startResize}
        onkeydown={resizeKey}
        ondblclick={() => (prefs.panelWidth = PANEL_DEFAULT)}></div>
    {/if}
    <aside id="shelf" class="shelf side" hidden={!prefs.panelOpen} aria-label="Side panel" style:width="{panelWidth}px">
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

  {#if namePrompt}
    <div class="dialog-backdrop">
      <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="name-title" onsubmit={(ev) => (ev.preventDefault(), answerName(nameValue))}>
        <h2 id="name-title">Save as</h2>
        <p>This browser saves a copy into your downloads under this name.</p>
        <input class="file-name" bind:this={nameInput} bind:value={nameValue} aria-label="File name" onkeydown={(ev) => ev.key === "Escape" && answerName(null)} />
        <div class="form-actions">
          <button type="submit" class="open-folder" data-choice="save">Save</button>
          <button type="button" class="link-button" data-choice="cancel" onclick={() => answerName(null)}>Cancel</button>
        </div>
      </form>
    </div>
  {/if}

  {#if notice}
    <p class="toast" role="status">{notice}</p>
  {/if}
</div>

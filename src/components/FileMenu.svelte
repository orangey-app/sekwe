<script lang="ts">
  import type { JournalSummary } from "../lib/journal.ts";

  // A word processor's File menu: New, Open (recent journals, then a file),
  // Save, Export and Print, in the order people expect them.
  let {
    journals,
    currentId,
    currentFile,
    canWrite,
    oncreate,
    onswitch,
    onbrowse,
    onsave,
    onsaveas,
    onmarkdown,
    onprint,
    ondelete,
  }: {
    journals: JournalSummary[];
    currentId: string | null;
    /** The file the open journal belongs to, when it has one (Chrome, Edge). */
    currentFile: string | null;
    /** Whether this browser can write to a file at all; elsewhere both saves download. */
    canWrite: boolean;
    oncreate: () => void;
    onswitch: (id: string) => void;
    onbrowse: () => void;
    onsave: () => void;
    onsaveas: () => void;
    onmarkdown: () => void;
    onprint: () => void;
    ondelete: () => void;
  } = $props();

  let open = $state(false);
  let sub: "open" | null = $state(null);
  let root: HTMLElement;
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function close() {
    open = false;
    sub = null;
  }
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
</script>

<svelte:window onpointerdown={(ev) => open && !root.contains(ev.target as Node) && close()} onkeydown={(ev) => open && ev.key === "Escape" && close()} />

<div class="file-menu journal-menu" bind:this={root}>
  <button type="button" class="menu-button" aria-haspopup="menu" aria-expanded={open} onclick={() => (open ? close() : (open = true))}>File ▾</button>
  {#if open}
    <div class="menu" role="menu">
      <button type="button" role="menuitem" class="menu-item" data-action="new" onmouseenter={() => (sub = null)} onclick={run(oncreate)}><span>New journal</span></button>

      <div class="has-sub" role="none" onmouseenter={() => (sub = "open")}>
        <button type="button" role="menuitem" class="menu-item" data-action="open" aria-haspopup="menu" aria-expanded={sub === "open"} onclick={() => (sub = sub === "open" ? null : "open")}><span>Open</span><span class="when">▸</span></button>
        {#if sub === "open"}
          <div class="menu sub-menu" role="menu" aria-label="Open">
            <div class="menu-label">Recent journals</div>
            {#each journals as j (j.id)}
              <button type="button" role="menuitemradio" aria-checked={j.id === currentId} class="menu-item recent" class:current={j.id === currentId} onclick={run(() => onswitch(j.id))}>
                <span class="name">{j.title}</span>
                <span class="when">{when(j.modified)}</span>
              </button>
            {/each}
            <hr />
            <button type="button" role="menuitem" class="menu-item" data-action="browse" onclick={run(onbrowse)}><span>Browse for a journal file…</span><span class="when">{mod}O</span></button>
          </div>
        {/if}
      </div>

      <hr />
      <button type="button" role="menuitem" class="menu-item" data-action="save" title={currentFile ? `Writes to ${currentFile}` : undefined} onmouseenter={() => (sub = null)} onclick={run(onsave)}>
        <span class="save-label">{#if currentFile}Save to <em>{currentFile}</em>{:else if canWrite}Save to a file…{:else}Download a copy{/if}</span><span class="when">{mod}S</span>
      </button>
      <button type="button" role="menuitem" class="menu-item" data-action="saveas" onmouseenter={() => (sub = null)} onclick={run(onsaveas)}><span>Save as…</span><span class="when">{mod}Shift+S</span></button>
      <hr />

      <button type="button" role="menuitem" class="menu-item" data-action="markdown" title="Copying the text (Ctrl+A, Ctrl+C) gives rich text for Word or Google Docs" onmouseenter={() => (sub = null)} onclick={run(onmarkdown)}><span>Export as Markdown</span></button>

      <button type="button" role="menuitem" class="menu-item" data-action="print" onmouseenter={() => (sub = null)} onclick={run(onprint)}><span>Print, or save as PDF</span><span class="when">{mod}P</span></button>
      <hr />
      <button type="button" role="menuitem" class="menu-item danger" data-action="delete" onmouseenter={() => (sub = null)} onclick={run(ondelete)}><span>Delete this journal…</span></button>
    </div>
  {/if}
</div>

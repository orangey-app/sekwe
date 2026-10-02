<script lang="ts">
  import type { JournalSummary } from "../lib/journal.ts";

  // A word processor's File menu: New, Open (recent journals, then a file),
  // Save, Export and Print, in the order people expect them.
  let {
    journals,
    currentId,
    oncreate,
    onswitch,
    onbrowse,
    onsave,
    onsaveas,
    onmarkdown,
    onhtml,
    onprint,
  }: {
    journals: JournalSummary[];
    currentId: string | null;
    oncreate: () => void;
    onswitch: (id: string) => void;
    onbrowse: () => void;
    onsave: () => void;
    onsaveas: () => void;
    onmarkdown: () => void;
    onhtml: () => void;
    onprint: () => void;
  } = $props();

  let open = $state(false);
  let sub: "open" | "export" | null = $state(null);
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
      <button type="button" role="menuitem" class="menu-item" data-action="save" onmouseenter={() => (sub = null)} onclick={run(onsave)}><span>Save to a file</span><span class="when">{mod}Shift+S</span></button>
      <button type="button" role="menuitem" class="menu-item" data-action="saveas" onmouseenter={() => (sub = null)} onclick={run(onsaveas)}><span>Save as…</span></button>
      <hr />

      <div class="has-sub" role="none" onmouseenter={() => (sub = "export")}>
        <button type="button" role="menuitem" class="menu-item" data-action="export" aria-haspopup="menu" aria-expanded={sub === "export"} onclick={() => (sub = sub === "export" ? null : "export")}><span>Export</span><span class="when">▸</span></button>
        {#if sub === "export"}
          <div class="menu sub-menu" role="menu" aria-label="Export">
            <button type="button" role="menuitem" class="menu-item" data-action="markdown" onclick={run(onmarkdown)}><span>Markdown</span></button>
            <button type="button" role="menuitem" class="menu-item" data-action="html" onclick={run(onhtml)}><span>Web page</span></button>
          </div>
        {/if}
      </div>

      <button type="button" role="menuitem" class="menu-item" data-action="print" onmouseenter={() => (sub = null)} onclick={run(onprint)}><span>Print, or save as PDF</span><span class="when">{mod}P</span></button>
    </div>
  {/if}
</div>

<script lang="ts">
  import type { JournalSummary } from "../lib/journal.ts";

  let {
    journals,
    currentId,
    onopen,
    oncreate,
  }: {
    journals: JournalSummary[];
    currentId: string | null;
    onopen: (id: string) => void;
    oncreate: () => void;
  } = $props();

  let open = $state(false);
  let root: HTMLElement;

  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function close() {
    open = false;
  }

  function onwindowpointer(ev: PointerEvent) {
    if (open && root && !root.contains(ev.target as Node)) close();
  }
</script>

<svelte:window onpointerdown={onwindowpointer} onkeydown={(ev) => open && ev.key === "Escape" && close()} />

<div class="journal-menu" bind:this={root}>
  <button type="button" class="menu-button" aria-haspopup="menu" aria-expanded={open} title="Journals" onclick={() => (open = !open)}>
    Journals ▾
  </button>
  {#if open}
    <div class="menu" role="menu">
      <button type="button" role="menuitem" class="menu-item new" onclick={() => (close(), oncreate())}>+ New journal</button>
      {#each journals as j (j.id)}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={j.id === currentId}
          class="menu-item"
          class:current={j.id === currentId}
          onclick={() => (close(), onopen(j.id))}>
          <span class="name">{j.title}</span>
          <span class="when">{when(j.modified)}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

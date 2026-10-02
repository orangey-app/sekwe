<script lang="ts">
  import type { OutlineEntry } from "../lib/export.ts";

  let { entries, onjump }: { entries: OutlineEntry[]; onjump: (entry: OutlineEntry) => void } = $props();
</script>

<section class="contents-panel">
  {#if entries.length === 0}
    <p class="hint">Chapters, scenes and beats you head with the toolbar's Chapter, Scene and Beat appear here; click one to jump to it.</p>
  {:else}
    <ol class="outline">
      {#each entries as e (e.pos)}
        <li class="level-{e.level}"><button type="button" class="link-button" onclick={() => onjump(e)}>{e.text}</button></li>
      {/each}
    </ol>
  {/if}
</section>

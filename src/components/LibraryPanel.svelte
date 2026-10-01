<script lang="ts">
  import type { LibraryStatus } from "../lib/oracles.ts";

  let {
    status,
    count,
    fromDisk,
    onopenfolder,
  }: { status: LibraryStatus; count: number; fromDisk: boolean; onopenfolder: () => void } = $props();
</script>

<section class="library-panel" data-status={status}>
  <h2>Oracles</h2>
  {#if fromDisk}
    <p>This copy was opened from disk, so it cannot see your Orangey library: browsers keep each site's storage apart, and a file on disk is a site of its own. Open Storyboard from its web address to roll your oracles.</p>
  {:else if status === "idle"}
    <p>Looking for your Orangey library…</p>
  {:else if status === "ready"}
    <p><strong>{count}</strong> {count === 1 ? "oracle" : "oracles"} from your Orangey library.</p>
    <p class="hint">Type <kbd>/</kbd> in the text and part of a name to roll one, or <kbd>/2d6</kbd> for dice. <kbd>Alt+R</kbd> rolls the last one again.</p>
  {:else if status === "empty"}
    <p>Your Orangey library has nothing to roll yet. Wheels and lists you make in Orangey on this site show up here.</p>
    <p class="hint">Dice work already: type <kbd>/2d6</kbd> in the text.</p>
  {:else if status === "needs-folder"}
    <p>Orangey keeps your library in a folder on your computer. The browser asks once per visit before Storyboard may read it.</p>
    <button type="button" class="open-folder" onclick={onopenfolder}>Open my Orangey folder</button>
  {:else}
    <p>This browser is not letting Storyboard read Orangey's storage on this site. Dice still work: type <kbd>/2d6</kbd>.</p>
  {/if}
</section>

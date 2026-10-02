<script lang="ts">
  import { folderPaths, type LibraryStatus, type Oracle } from "../lib/oracles.ts";
  import { allPaths, buildTree, filterTree, isChosen, visibleOracles, type TreeFolder } from "../lib/tree.ts";

  let {
    status,
    oracles,
    kept,
    copySaved,
    folders,
    openFolders,
    fromDisk,
    onopenfolder,
    onfolders,
    onopen,
    onroll,
  }: {
    status: LibraryStatus;
    oracles: Oracle[];
    /** How many of the oracles come from the journal's own copy of its folders. */
    kept: number;
    /** When that copy last changed. */
    copySaved: string | null;
    /** The journal's chosen folders; empty means every folder. */
    folders: string[];
    /** The folders open in the tree, kept with the journal. */
    openFolders: string[];
    fromDisk: boolean;
    onopenfolder: () => void;
    onfolders: (folders: string[]) => void;
    onopen: (open: string[]) => void;
    onroll: (oracle: Oracle) => void;
  } = $props();

  /** Every folder, with a box to add it to the journal's choice. */
  let showAll = $state(false);
  let query = $state("");
  /** Nothing from Orangey here, but the journal brought its own copy. */
  const copyOnly = $derived(oracles.length > 0 && kept === oracles.length);
  const savedOn = $derived(copySaved ? new Date(copySaved).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

  const visible = $derived(visibleOracles(oracles, folders, showAll));
  const filtered = $derived(query.trim() ? filterTree(visible, query) : null);
  const tree = $derived(buildTree(filtered ? filtered.oracles : visible, showAll && !filtered ? folderPaths(oracles) : []));
  /** Open: what the journal remembers, or while filtering, whatever holds a match. */
  const isOpen = (path: string) => (filtered ? filtered.open.has(path) : openFolders.includes(path));

  function toggle(path: string) {
    if (filtered) return;
    onopen(openFolders.includes(path) ? openFolders.filter((p) => p !== path) : [...openFolders, path]);
  }

  function pick(path: string, on: boolean) {
    // Ticking a folder replaces any of its subfolders already chosen: the folder covers them.
    const rest = folders.filter((f) => f !== path && !f.startsWith(`${path}/`));
    onfolders(on ? [...rest, path] : rest);
  }
</script>

<section class="library-panel" data-status={status} data-copy={copyOnly ? "only" : kept > 0 ? "some" : "none"}>
  {#if fromDisk && !copyOnly}
    <p>This copy was opened from disk, so it cannot see your Orangey library: browsers keep each site's storage apart, and a file on disk is a site of its own. Open Sekwe from its web address to roll your oracles.</p>
  {:else if status === "idle" && !copyOnly}
    <p>Looking for your Orangey library…</p>
  {:else if status === "needs-folder"}
    <p>Orangey keeps your library in a folder on your computer. The browser asks once per visit before Sekwe may read it.</p>
    <button type="button" class="open-folder" onclick={onopenfolder}>Open my Orangey folder</button>
  {:else if status === "unavailable" && !copyOnly}
    <p>This browser is not letting Sekwe read Orangey's storage on this site. Dice still work: type <kbd>/2d6</kbd>.</p>
  {:else if status === "empty" && !copyOnly}
    <p>Your Orangey library has nothing to roll yet. Wheels and lists you make in Orangey on this site show up here.</p>
    <p class="hint">Dice work already: type <kbd>/2d6</kbd> in the text.</p>
  {/if}
  {#if copyOnly}
    <p class="copy-note">Rolling from the copy this journal keeps of its folders{#if savedOn}, saved {savedOn}{/if}. Orangey's library is not here, so the copy is used instead.</p>
  {:else if kept > 0 && status === "ready"}
    <p class="copy-note">{kept} {kept === 1 ? "oracle comes" : "oracles come"} from this journal's own copy: the library here does not have {kept === 1 ? "it" : "them"}.</p>
  {/if}
  {#if oracles.length > 0}
    <div class="folders-line">
      <span class="folders-now">
        {#if folders.length === 0}All folders{:else}{folders.join(", ")}{/if}
      </span>
      <label class="show-all"><input type="checkbox" bind:checked={showAll} /> Choose folders</label>
    </div>
    {#if showAll}
      <p class="hint">Tick the folders this journal rolls from; none ticked means all of them. The journal keeps a copy of the folders you choose, so it can roll them on a computer without Orangey.{#if folders.length} <button type="button" class="link-button use-all" onclick={() => onfolders([])}>Use every folder</button>{/if}</p>
    {/if}
    <div class="tree-tools">
      <input class="tree-filter" type="search" placeholder="Filter oracles" aria-label="Filter oracles" bind:value={query} />
      <button type="button" class="link-button expand-all" disabled={!!filtered} onclick={() => onopen(allPaths(tree))}>Expand all</button>
      <button type="button" class="link-button collapse-all" disabled={!!filtered} onclick={() => onopen([])}>Collapse all</button>
    </div>
    <p class="hint">Click an oracle to roll it at the cursor, or type <kbd>/</kbd> in the text. <kbd>Alt+R</kbd> rolls the last one again.</p>
    {#if filtered && filtered.oracles.length === 0}
      <p class="hint">No oracle matches “{query.trim()}”.</p>
    {/if}
    <div class="oracle-tree" role="tree" aria-label="Oracles">
      {@render branch(tree)}
    </div>
  {/if}
</section>

{#snippet branch(f: TreeFolder)}
  <ul role="group">
    {#each f.folders as sub (sub.path)}
      {@const open = isOpen(sub.path)}
      {@const pickState = isChosen(sub.path, folders)}
      <li class="tree-folder" role="treeitem" aria-expanded={open} aria-selected="false">
        <div class="folder-row">
          {#if showAll}
            <input
              type="checkbox"
              class="folder-pick"
              aria-label="Roll from {sub.path}"
              checked={pickState.chosen}
              disabled={pickState.byParent}
              onchange={(ev) => pick(sub.path, (ev.target as HTMLInputElement).checked)} />
          {/if}
          <button type="button" class="folder-head" data-path={sub.path} aria-expanded={open} onclick={() => toggle(sub.path)}>
            <span class="caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
            <span class="folder-name">{sub.name}</span>
            {#if sub.pack}<span class="pack-badge" title="{sub.pack.title} by {sub.pack.author}">pack {sub.pack.version}</span>{/if}
            <span class="folder-count">{sub.count}</span>
          </button>
        </div>
        {#if open}{@render branch(sub)}{/if}
      </li>
    {/each}
    {#each f.oracles as o (o.id)}
      <li role="treeitem" aria-selected="false">
        <button type="button" class="oracle-button" data-id={o.id} onmousedown={(ev) => ev.preventDefault()} onclick={() => onroll(o)}>{o.name}</button>
      </li>
    {/each}
  </ul>
{/snippet}

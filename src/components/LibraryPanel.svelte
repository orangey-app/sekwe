<script lang="ts">
  import { folderPaths, inFolders, type LibraryStatus, type Oracle } from "../lib/oracles.ts";

  let {
    status,
    oracles,
    kept,
    copySaved,
    folders,
    fromDisk,
    onopenfolder,
    onfolders,
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
    fromDisk: boolean;
    onopenfolder: () => void;
    onfolders: (folders: string[]) => void;
    onroll: (oracle: Oracle) => void;
  } = $props();

  let choosing = $state(false);
  /** Nothing from Orangey here, but the journal brought its own copy. */
  const copyOnly = $derived(oracles.length > 0 && kept === oracles.length);
  const savedOn = $derived(copySaved ? new Date(copySaved).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
  const all = $derived(folderPaths(oracles));
  const top = $derived(all.filter((f) => !f.includes("/")));
  const shown = $derived(inFolders(oracles, folders));

  /** The oracles to show, grouped by folder, folders in order and "" (the top) first. */
  const groups = $derived.by(() => {
    const by = new Map<string, Oracle[]>();
    for (const o of shown) {
      const list = by.get(o.folder) ?? [];
      list.push(o);
      by.set(o.folder, list);
    }
    return [...by.entries()]
      .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
      .map(([folder, list]) => ({ folder, list: list.sort((a, b) => a.name.localeCompare(b.name)) }));
  });

  let closed: Set<string> = $state(new Set());
  function toggleGroup(folder: string) {
    const next = new Set(closed);
    if (next.has(folder)) next.delete(folder);
    else next.add(folder);
    closed = next;
  }

  function toggleFolder(folder: string, on: boolean) {
    onfolders(on ? [...folders, folder] : folders.filter((f) => f !== folder));
  }
</script>

<section class="library-panel" data-status={status} data-copy={copyOnly ? "only" : kept > 0 ? "some" : "none"}>
  {#if fromDisk && !copyOnly}
    <p>This copy was opened from disk, so it cannot see your Orangey library: browsers keep each site's storage apart, and a file on disk is a site of its own. Open Storyboard from its web address to roll your oracles.</p>
  {:else if status === "idle" && !copyOnly}
    <p>Looking for your Orangey library…</p>
  {:else if status === "needs-folder"}
    <p>Orangey keeps your library in a folder on your computer. The browser asks once per visit before Storyboard may read it.</p>
    <button type="button" class="open-folder" onclick={onopenfolder}>Open my Orangey folder</button>
  {:else if status === "unavailable" && !copyOnly}
    <p>This browser is not letting Storyboard read Orangey's storage on this site. Dice still work: type <kbd>/2d6</kbd>.</p>
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
      <button type="button" class="link-button" aria-expanded={choosing} onclick={() => (choosing = !choosing)}>{choosing ? "Done" : "Choose folders"}</button>
    </div>
    {#if choosing}
      <fieldset class="folder-choice">
        <legend>Folders this journal rolls from</legend>
        {#if top.length === 0}
          <p class="hint">Your library has no folders; every oracle is at the top.</p>
        {/if}
        {#each all as f (f)}
          <label class="folder-option" style:padding-left="{(f.split('/').length - 1) * 1.1}rem">
            <input type="checkbox" checked={folders.includes(f)} onchange={(ev) => toggleFolder(f, (ev.target as HTMLInputElement).checked)} />
            {f.split("/").at(-1)}
          </label>
        {/each}
        {#if folders.length}
          <button type="button" class="link-button" onclick={() => onfolders([])}>Use every folder</button>
        {/if}
        <p class="hint">The journal keeps a copy of the folders you choose, so it can roll them on a computer without Orangey.</p>
      </fieldset>
    {/if}
    <p class="hint">Click an oracle to roll it at the cursor, or type <kbd>/</kbd> in the text. <kbd>Alt+R</kbd> rolls the last one again.</p>
    <div class="oracle-tree">
      {#each groups as g (g.folder)}
        <div class="oracle-group">
          {#if g.folder}
            <button type="button" class="group-head" aria-expanded={!closed.has(g.folder)} onclick={() => toggleGroup(g.folder)}>{g.folder}</button>
          {/if}
          {#if !closed.has(g.folder)}
            <ul>
              {#each g.list as o (o.id)}
                <li><button type="button" class="oracle-button" data-id={o.id} onmousedown={(ev) => ev.preventDefault()} onclick={() => onroll(o)}>{o.name}</button></li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

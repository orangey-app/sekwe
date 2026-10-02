<script lang="ts" module>
  export type Tab = "status" | "oracles" | "contents" | "commands";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  let { tab = $bindable(), status, oracles, contents, commands }: { tab: Tab; status: Snippet; oracles: Snippet; contents: Snippet; commands: Snippet } = $props();

  const TABS: { id: Tab; label: string }[] = [
    { id: "status", label: "Status" },
    { id: "oracles", label: "Oracles" },
    { id: "contents", label: "Contents" },
    { id: "commands", label: "Commands" },
  ];
</script>

<div class="side-tabs" role="tablist" aria-label="Side panel">
  {#each TABS as t (t.id)}
    <button type="button" role="tab" id="tab-{t.id}" aria-selected={tab === t.id} aria-controls="pane-{t.id}" onclick={() => (tab = t.id)}>{t.label}</button>
  {/each}
</div>
<!-- Every pane stays in the page, so the status editor keeps its place and undo. -->
<div class="side-pane" id="pane-status" role="tabpanel" aria-labelledby="tab-status" hidden={tab !== "status"}>{@render status()}</div>
<div class="side-pane" id="pane-oracles" role="tabpanel" aria-labelledby="tab-oracles" hidden={tab !== "oracles"}>{@render oracles()}</div>
<div class="side-pane" id="pane-contents" role="tabpanel" aria-labelledby="tab-contents" hidden={tab !== "contents"}>{@render contents()}</div>
<div class="side-pane" id="pane-commands" role="tabpanel" aria-labelledby="tab-commands" hidden={tab !== "commands"}>{@render commands()}</div>

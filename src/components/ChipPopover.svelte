<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import type { ChipAt, RollControl } from "../lib/rollnodes.ts";
  import { chipText, current } from "../lib/rolls.ts";
  import { drawBlot } from "../lib/blot.ts";
  import { creditText } from "../lib/export.ts";

  // Shown while the selection is on a chip; `tick` changes with every editor transaction.
  let { editor, control, tick }: { editor: Editor | null; control: RollControl; tick: number } = $props();

  const at: ChipAt | null = $derived.by(() => {
    void tick;
    return editor ? control.selectedChip(editor) : null;
  });

  let box = $state({ left: 0, top: 0 });
  let preview: HTMLCanvasElement | undefined = $state();
  let drawnBlot: number | null = null;

  $effect(() => {
    if (!editor || !at) return;
    const dom = editor.view.nodeDOM(at.pos) as HTMLElement | null;
    const rect = dom?.getBoundingClientRect();
    if (rect) box = { left: Math.max(8, Math.min(rect.left, innerWidth - 336)), top: rect.bottom + 8 };
  });

  $effect(() => {
    const blot = at ? current(at.record).blot : undefined;
    if (!preview || blot === undefined || blot === drawnBlot) return;
    drawnBlot = blot;
    const canvas = preview;
    void drawBlot(canvas, blot, 320, () => drawnBlot !== blot);
  });

  const when = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
</script>

{#if editor && at}
  {@const r = current(at.record)}
  {@const source = at.record.source}
  <div class="chip-popover" role="dialog" aria-label="Roll" style:left="{box.left}px" style:top="{box.top}px" onmousedown={(ev) => ev.preventDefault()}>
    <p class="from">
      {source.kind === "dice" ? source.expression : source.name}
      {#if r.detail}<span class="detail">{r.detail}</span>{/if}
      {#if r.rolled?.length}<span class="detail">{r.rolled.join(" · ")}</span>{/if}
      {#if r.parts?.length}<span class="detail parts">{r.parts.map((p) => `${p.name}: ${p.text}`).join(" · ")}</span>{/if}
    </p>
    {#if source.kind === "oracle" && source.pack}
      <p class="credit">
        From {creditText(source.pack)}
        {#if source.pack.homepage && /^https?:\/\//i.test(source.pack.homepage)}· <a href={source.pack.homepage} target="_blank" rel="noopener">web page</a>{/if}
      </p>
    {/if}
    {#if r.blot !== undefined}
      <canvas class="blot-preview" bind:this={preview} role="img" aria-label={chipText(r)}></canvas>
    {/if}
    <div class="actions">
      <button type="button" onclick={() => editor && control.rerollAt(editor, at)}>Roll again <kbd>Alt+R</kbd></button>
      {#if r.next}
        <button type="button" onclick={() => editor && control.rollNext(editor)}>Roll {r.next.name} <kbd>Alt+N</kbd></button>
      {/if}
      {#if r.blot !== undefined}
        <button type="button" class="put" onclick={() => editor && control.putPicture(editor, at)}>Put in the text</button>
      {/if}
      <button type="button" class="to-text" title="Keep the words and stop it being a roll" onclick={() => editor && control.toText(editor, at)}>Turn into text</button>
    </div>
    {#if at.record.results.length > 1}
      <ol class="history" reversed aria-label="Earlier results">
        {#each [...at.record.results].reverse() as h, i (h.at + i)}
          <li class:now={i === 0}><span>{chipText(h)}</span><span class="at">{when(h.at)}</span></li>
        {/each}
      </ol>
    {/if}
  </div>
{/if}

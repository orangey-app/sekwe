<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import { COLOURS, FONTS, HIGHLIGHTS, SIZES, STYLES, setStyle, styleAt } from "../lib/marks.ts";
  import { tableCommands } from "../lib/tables.ts";

  // `editor` is whichever is being written in: the story or the status panel.
  // `tick` changes on every transaction, so active states are read again.
  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  type Item = {
    label: string;
    title: string;
    run: (e: Editor) => void;
    active?: (e: Editor) => boolean;
    enabled?: (e: Editor) => boolean;
    cls?: string;
  };

  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const heading = (level: 1 | 2 | 3) => (e: Editor) => e.chain().focus().toggleHeading({ level }).run();

  const groups: Item[][] = [
    [
      { label: "Chapter", title: `Chapter heading (${mod}Alt+1)`, run: heading(1), active: (e) => e.isActive("heading", { level: 1 }) },
      { label: "Scene", title: `Scene heading (${mod}Alt+2)`, run: heading(2), active: (e) => e.isActive("heading", { level: 2 }) },
      { label: "Beat", title: `Smaller heading (${mod}Alt+3)`, run: heading(3), active: (e) => e.isActive("heading", { level: 3 }) },
    ],
    [
      { label: "B", title: `Bold (${mod}B)`, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold"), cls: "bold" },
      { label: "I", title: `Italic (${mod}I)`, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic"), cls: "italic" },
    ],
    [
      { label: "• List", title: `Bulleted list (${mod}Shift+8)`, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
      { label: "1. List", title: `Numbered list (${mod}Shift+7)`, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
      { label: "Quote", title: `Quote (${mod}Shift+B)`, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
      { label: "—", title: "Separator", run: (e) => e.chain().focus().setHorizontalRule().run() },
      { label: "Table", title: "Insert a table", run: (e) => tableCommands.insert(e), enabled: (e) => !tableCommands.inTable(e) },
    ],
    [
      { label: "Undo", title: `Undo (${mod}Z)`, run: (e) => e.chain().focus().undo().run(), enabled: (e) => e.can().undo() },
      { label: "Redo", title: `Redo (${mod}Shift+Z)`, run: (e) => e.chain().focus().redo().run(), enabled: (e) => e.can().redo() },
    ],
  ];

  const tableItems: Item[] = [
    { label: "+ Row", title: "Add a row below", run: (e) => tableCommands.addRow(e) },
    { label: "+ Column", title: "Add a column to the right", run: (e) => tableCommands.addColumn(e) },
    { label: "− Row", title: "Delete this row", run: (e) => tableCommands.deleteRow(e) },
    { label: "− Column", title: "Delete this column", run: (e) => tableCommands.deleteColumn(e) },
    { label: "Delete table", title: "Delete the whole table", run: (e) => tableCommands.deleteTable(e) },
  ];

  const isActive = (item: Item, _tick: number) => (editor && item.active ? item.active(editor) : false);
  const isEnabled = (item: Item, _tick: number) => (editor ? (item.enabled ? item.enabled(editor) : true) : false);
  const inTable = $derived.by(() => (void tick, editor ? tableCommands.inTable(editor) : false));
  const current = (style: (typeof STYLES)[keyof typeof STYLES], _tick: number) => (editor ? (styleAt(editor, style) ?? "") : "");

  let open: "highlight" | "colour" | null = $state(null);
  function apply(style: (typeof STYLES)[keyof typeof STYLES], value: string | null) {
    if (editor) setStyle(editor, style, value);
    open = null;
  }
</script>

<svelte:window onpointerdown={(ev) => open && !(ev.target as HTMLElement).closest(".swatch-menu, .swatch-button") && (open = null)} />

<div class="toolbar" role="toolbar" aria-label="Formatting">
  {#each groups as group, g (g)}
    <div class="group">
      {#each group as item (item.label)}
        <button
          type="button"
          class="tool {item.cls ?? ''}"
          title={item.title}
          aria-label={item.title}
          aria-pressed={item.active ? isActive(item, tick) : undefined}
          disabled={!isEnabled(item, tick)}
          onmousedown={(ev) => ev.preventDefault()}
          onclick={() => editor && item.run(editor)}>{item.label}</button>
      {/each}
    </div>
  {/each}

  <div class="group styles">
    <div class="swatch-wrap">
      <button type="button" class="tool swatch-button" title="Highlight" aria-label="Highlight" aria-expanded={open === "highlight"} disabled={!editor} onmousedown={(ev) => ev.preventDefault()} onclick={() => (open = open === "highlight" ? null : "highlight")}><mark class="hl-{current(STYLES.highlight, tick) || 'yellow'}">ab</mark></button>
      {#if open === "highlight"}
        <div class="swatch-menu" role="menu">
          {#each HIGHLIGHTS as h (h.value)}
            <button type="button" role="menuitem" class="swatch hl-{h.value}" title={h.name} aria-label="{h.name} highlight" onmousedown={(ev) => ev.preventDefault()} onclick={() => apply(STYLES.highlight, h.value)}></button>
          {/each}
          <button type="button" role="menuitem" class="swatch-none" onmousedown={(ev) => ev.preventDefault()} onclick={() => apply(STYLES.highlight, null)}>None</button>
        </div>
      {/if}
    </div>
    <div class="swatch-wrap">
      <button type="button" class="tool swatch-button" title="Text colour" aria-label="Text colour" aria-expanded={open === "colour"} disabled={!editor} onmousedown={(ev) => ev.preventDefault()} onclick={() => (open = open === "colour" ? null : "colour")}><span class="colour-a tc-{current(STYLES.colour, tick) || 'red'}">A</span></button>
      {#if open === "colour"}
        <div class="swatch-menu" role="menu">
          {#each COLOURS as c (c.value)}
            <button type="button" role="menuitem" class="swatch tc-bg-{c.value}" title={c.name} aria-label="{c.name} text" onmousedown={(ev) => ev.preventDefault()} onclick={() => apply(STYLES.colour, c.value)}></button>
          {/each}
          <button type="button" role="menuitem" class="swatch-none" onmousedown={(ev) => ev.preventDefault()} onclick={() => apply(STYLES.colour, null)}>None</button>
        </div>
      {/if}
    </div>
    <select class="style-select" title="Text size" aria-label="Text size" disabled={!editor} value={current(STYLES.size, tick)} onchange={(ev) => apply(STYLES.size, (ev.target as HTMLSelectElement).value || null)}>
      <option value="">Normal size</option>
      {#each SIZES as s (s.value)}<option value={s.value}>{s.name}</option>{/each}
    </select>
    <select class="style-select" title="Typeface" aria-label="Typeface" disabled={!editor} value={current(STYLES.font, tick)} onchange={(ev) => apply(STYLES.font, (ev.target as HTMLSelectElement).value || null)}>
      <option value="">Story serif</option>
      {#each FONTS as f (f.value)}<option value={f.value}>{f.name}</option>{/each}
    </select>
  </div>

  {#if inTable}
    <div class="group table-tools" aria-label="Table">
      {#each tableItems as item (item.label)}
        <button type="button" class="tool" title={item.title} aria-label={item.title} onmousedown={(ev) => ev.preventDefault()} onclick={() => editor && item.run(editor)}>{item.label}</button>
      {/each}
    </div>
  {/if}
</div>

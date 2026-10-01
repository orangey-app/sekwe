<script lang="ts">
  import type { Editor } from "@tiptap/core";

  // `tick` changes on every editor transaction, so the active states below
  // are read again whenever the selection or the text changes.
  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  type Item = {
    label: string;
    title: string;
    run: (e: Editor) => void;
    active?: (e: Editor) => boolean;
    enabled?: (e: Editor) => boolean;
  };

  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

  const groups: Item[][] = [
    [
      { label: "Scene", title: `Scene heading (${mod}Alt+2)`, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
      { label: "Beat", title: `Smaller heading (${mod}Alt+3)`, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
    ],
    [
      { label: "B", title: `Bold (${mod}B)`, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
      { label: "I", title: `Italic (${mod}I)`, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
    ],
    [
      { label: "• List", title: `Bulleted list (${mod}Shift+8)`, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
      { label: "1. List", title: `Numbered list (${mod}Shift+7)`, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
      { label: "Quote", title: `Quote (${mod}Shift+B)`, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
      { label: "—", title: "Separator", run: (e) => e.chain().focus().setHorizontalRule().run() },
    ],
    [
      { label: "Undo", title: `Undo (${mod}Z)`, run: (e) => e.chain().focus().undo().run(), enabled: (e) => e.can().undo() },
      { label: "Redo", title: `Redo (${mod}Shift+Z)`, run: (e) => e.chain().focus().redo().run(), enabled: (e) => e.can().redo() },
    ],
  ];

  const isActive = (item: Item, _tick: number) => (editor && item.active ? item.active(editor) : false);
  const isEnabled = (item: Item, _tick: number) => (editor ? (item.enabled ? item.enabled(editor) : true) : false);
</script>

<div class="toolbar" role="toolbar" aria-label="Formatting">
  {#each groups as group, g (g)}
    <div class="group">
      {#each group as item (item.label)}
        <button
          type="button"
          class="tool"
          class:bold={item.label === "B"}
          class:italic={item.label === "I"}
          title={item.title}
          aria-label={item.title}
          aria-pressed={item.active ? isActive(item, tick) : undefined}
          disabled={!isEnabled(item, tick)}
          onmousedown={(ev) => ev.preventDefault()}
          onclick={() => editor && item.run(editor)}>{item.label}</button>
      {/each}
    </div>
  {/each}
</div>

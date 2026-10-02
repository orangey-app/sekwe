# Status — where the work stands

Read this first when picking the work up again.

## Done

- **Step 1 (in Orangey):** the offline worker deletes only its own caches;
  the roll engine moved to `src/model/roll.ts`.
- **Step 2:** Orangey's DOM-free folders kept free of UI imports (checked);
  custom colours in `src/model/colours.ts`; a real offline install in
  Orangey's subpath test. Here: this folder, the sync script and its checks.
- **Step 3: the editor shell.** Svelte 5 + Tiptap 3 page, many journals
  switched in place, autosave to IndexedDB, offline worker, single-file build,
  unit and browser tests. Packages: Vite 8.3, Svelte 5.57, Tiptap 3.31,
  TypeScript 7.0 (see package-lock.json).

- **Step 4, first slice: rolling.** Orangey's library-location rule moved to
  its `src/storage/locate.ts` (shared through the sync). Here: the library
  reader (`src/lib/oracles.ts`), roll records and the roller with journal
  snapshots (`rolls.ts`, `roller.ts`), the chip, the inkblot picture and
  Alt+R / Alt+N (`rollnodes.ts`), the slash command (`slash.ts`), the chip's
  pop-up and the oracle panel, and `scripts/serve-both.mjs`.

- **Round 2 (from writing with it, 1 Oct):** page width setting; Tab
  completion; folders per journal and a browsable oracle panel; recent and
  context ranking; picks and bags (bags in the journal); per-journal commands;
  a status panel (second editor per journal); tables (`src/lib/tables.ts`, on
  prosemirror-tables from @tiptap/pm); text styling (`src/lib/marks.ts`);
  chapters with a Contents list; save/open journal files, Markdown and HTML
  export with roll footnotes, print/PDF (`src/lib/export.ts`, `files.ts`);
  Turn into text.

- **Round 3 (2 Oct):** a journal keeps a copy of its chosen folders
  (`src/lib/copy.ts`; option a: no folders, no copy), so it rolls without
  Orangey. In Orangey: packs (`src/model/pack.ts`, `src/ui/packs.ts`, the
  pack methods in `src/storage/library.ts`) and tables inside tables
  (`src/model/refs.ts`, `{@Name|id}`, the `{@` picker in
  `src/ui/components/refpicker.ts`). Here: pack credit on chips and in
  exports, `allowSnapshots: false` respected, references rolled, kept and
  shown.

## Next

- Chip menu: copy a link to the oracle, open it in Orangey.
- Boards in the slash menu: roll every oracle on one, or leave them out.
- Deleting a journal (opening files as copies adds journals).
- Export images: the inkblot picture as an image in the web page export.

## Notes for whoever builds next

- Logic goes in `src/lib/*.ts`, which is typechecked and unit-tested.
  TypeScript 7 does not look inside `.svelte` files and `svelte-check` is not
  installed, so components stay thin.
- `tsconfig.json` checks `src/` only: `@types/node` is not installed, so the
  tests (which use node:test) are run, not typechecked.
- The packages were installed on Windows. To work in a Linux sandbox, unpack
  the node_modules archive and add the Linux builds of the five native
  packages (Rolldown, Rollup, Lightning CSS, TypeScript, @napi-rs/lzma), at the
  versions in package-lock.json, with `npm pack` on a machine that has the
  registry.

## Decisions (2 Oct 2026)

- References store ids behind names: `{@Name|id}`; the editor shows `{@Name}`;
  a hand-typed `{@Name}` gets its id when one table has that name.
- References in shared links stay text (a link carries one wheel, no bundling).
- Pack id is generated at first publish (no separate short name: an install
  link carries the file's address). Installed packs are locked, with "Make an
  editable copy". `allowSnapshots: false` means no whole-table copy in the
  journal (copy or snapshot); words already rolled stay.
- Order was: journal copy, then packs, then references.

## Decisions (1 Oct 2026)

- Own folder and repo; final name and address decided later, tested locally
  until then. Every path relative so the address is a deploy setting.
- MIT licence. No mascot. Its own plain look (not Orangey's).
- Many journals, switched in place from a menu; slim toolbar plus shortcuts.
- Chapters are headings in one document, with a Contents list. Commands are
  per journal only. Text styling from fixed choices, not any font or size.
- Pack = Orangey library file plus an optional `manifest`; randomizer version
  = hash of outcomes and weights; bags belong to the journal; a chain offers
  the next roll and never rolls it by itself.

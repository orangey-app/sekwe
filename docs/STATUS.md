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

## Next — step 4, second slice

- Picks: a list with `offer` shows its choices at the cursor; the pick lands,
  marked as picked.
- Bags: what a bag has drawn is kept in the journal.
- The shelf: pinned oracles as buttons, a shared default that each journal
  can override.
- The chip's full menu: turn into text, copy link, open in Orangey.
- Boards in the slash menu (roll every oracle on it?), to be decided.

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

## Decisions (1 Oct 2026)

- Own folder and repo; final name and address decided later, tested locally
  until then. Every path relative so the address is a deploy setting.
- MIT licence. No mascot. Its own plain look (not Orangey's).
- Many journals, switched in place from a menu; slim toolbar plus shortcuts.
- Pack = Orangey library file plus an optional `manifest`; randomizer version
  = hash of outcomes and weights; bags belong to the journal; a chain offers
  the next roll and never rolls it by itself.

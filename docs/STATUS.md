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

## Next — step 4: rolling

Rolling from the user's Orangey library, read where Orangey keeps it (OPFS
folder `library`, IndexedDB database `orangey`, or a folder on disk the user
picked, which needs one permission click): the slash command, the re-roll key,
the shelf, and roll chips in the text.

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

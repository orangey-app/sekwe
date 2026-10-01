# Storyboard (working title)

A writing page for solo roleplaying games. You write the story; when it needs
an answer, an oracle from [Orangey](https://github.com/orangey-app/orangey)
rolls straight into the text at the cursor. No page switching, no server, no
account, and it works offline.

**Status:** journals, formatting, autosave and offline work, and oracles from
your Orangey library roll into the text (`/` and a name, Alt+R, Alt+N). Picks,
bags, the shelf and the chip's full menu come next. `docs/STATUS.md` says where the work
stands; the plan and the decisions behind it are in the project's plan
document.

## Trying it

```
npm run dev       a live page at http://localhost:5173 (no offline worker in this mode)
npm run build     dist/ (the site, with its offline worker) and dist/storyboard.html (one file)
npm run preview   serves dist/ at http://localhost:4173, offline worker included
npm run serve:both  Orangey and Storyboard together at http://127.0.0.1:4321 (build both first)
```

Storyboard reads the Orangey library of the site it is served from: browsers
keep each site's storage apart, so it only sees a library made in Orangey at
the same address. That is what `serve:both` is for when trying it locally.

## Rolling

- **`/` and part of a name** (`/npc mot`) rolls an oracle into the text;
  `/2d6` rolls dice. Arrow keys choose, Enter rolls, Escape closes.
- **Alt+R** rolls the last oracle again at the cursor; with a chip selected
  (click it), it re-rolls that chip, keeping the earlier results.
- **Alt+N** follows an outcome that goes to another oracle (the chip shows
  "→ name"). It never rolls by itself.
- An **inkblot** lands as a small blot; click it and choose *Put in the text*
  for the full picture below the paragraph.
- Every oracle rolled is copied into the journal, so a journal re-rolls
  offline, on another computer, or after the wheel is deleted. A wheel edited
  in Orangey rolls as edited from the next roll (Storyboard reads the library
  again whenever its tab comes back); what is already in the text never changes.

`dist/storyboard.html` also opens straight from disk: double-click it.

Journals are kept in this browser (IndexedDB, database `storyboard`) and saved
half a second after you stop typing; Ctrl+S saves at once. Opening and saving
journal files comes in a later stage.

## How it relates to Orangey

Orangey is where oracles are made and tested; Storyboard is where they are
played. Both read the same files, and Storyboard rolls them with Orangey's own
engine, so a roll means the same thing in both.

That engine is copied, not shared as a package. `vendor/orangey/` holds
Orangey's DOM-free folders (`src/core`, `src/model`, `src/import`,
`src/storage`) and the unit tests that run on them, as of one Orangey commit:

```
node scripts/sync-orangey.mjs            copy from ..\orangey (or --from <folder>)
node scripts/sync-orangey.mjs --status   has Orangey moved on since the copy?
```

`vendor/orangey/SOURCE.json` records the Orangey version and commit, and a
hash of every file. `npm run check` fails if anything in `vendor/` was edited
by hand, so a fix to that code goes into Orangey first and comes back through
the sync. `src/model/settings-file.ts` is left out on purpose: it is Orangey's
own settings file, and the one model file allowed to reach into Orangey's UI.

## Checks

```
npm run check          the copy of Orangey is untouched
npm run typecheck      the TypeScript in src/ (not inside .svelte files: keep logic in src/lib)
npm test               unit tests: Storyboard's own, and Orangey's on the copy
npm run test:browser   the built app in Chrome (run npm run build first)
```

Node 22.6 or newer and `npm install`. The browser tests drive a local Chrome
or Chromium (set `CHROME_PATH` if it is not found), with the dependency-free
harness that comes from Orangey in `vendor/orangey/tests/browser/`.

## Layout

```
src/lib/        journal format, browser storage, autosave, the session, the editor setup
src/components/ the toolbar and the journal menu
src/App.svelte  the page: title bar, toolbar, the text, the oracle shelf
tests/unit/     node --test, no browser
tests/browser/  the built app in Chromium
vendor/orangey/ copied from Orangey by the sync script; never edited here
```

## Licence

MIT; see `LICENSE`. The code in `vendor/orangey/` comes from Orangey, also
MIT (Copyright (c) 2026 Amogh Kinikar and Orangey contributors). None of
Orangey's mascot artwork, which is not MIT-licensed, is copied.

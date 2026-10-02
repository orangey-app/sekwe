# Sekwe

*sekʷe*, said SEK-weh: from two old roots that sound alike, *sekʷ-* "to
tell" and *sekʷ-* "to follow". You tell the story; the oracles say where it
goes next.

A writing page for solo roleplaying games. You write the story; when it needs
an answer, an oracle from [Orangey](https://github.com/orangey-app/orangey)
rolls straight into the text at the cursor. No page switching, no server, no
account, and it works offline.

**Status:** journals with chapters, a status panel, tables and text styling;
oracles from your Orangey library roll into the text and the status panel;
journals save to files and export as Markdown or PDF, and copy as rich text. Works
offline. `docs/STATUS.md` says where the work stands; the plan and the decisions behind it are in the project's plan
document.

## Trying it

**Online:** <https://orangey-app.github.io/sekwe/>, beside Orangey at
<https://orangey-app.github.io/orangey/>, so it reads the library you made
there. Publishing is described in `docs/PUBLISHING.md`.

**Locally:**

```
npm run dev       a live page at http://localhost:5173 (no offline worker in this mode)
npm run build     dist/ (the site, with its offline worker) and dist/sekwe.html (one file)
npm run preview   serves dist/ at http://localhost:4173, offline worker included
npm run serve:both  Orangey and Sekwe together at http://127.0.0.1:4321 (build both first)
```

Sekwe reads the Orangey library of the site it is served from: browsers
keep each site's storage apart, so it only sees a library made in Orangey at
the same address. That is what `serve:both` is for when trying it locally.

## Writing

- **The page**: Narrow, Wide or Full (the menu beside the title).
- **Chapter, Scene and Beat** headings; the side panel's *Contents* lists them,
  and a click jumps there. Printing starts each chapter on a new page.
- **Highlight, text colour, size and typeface** from the toolbar, from fixed
  choices so a journal stays readable and exports cleanly.
- **Tables** from the toolbar, in the story or the status panel. Tab moves
  between cells (and adds a row at the end); the toolbar adds and removes rows
  and columns while you are in one.
- **The status panel** (side panel, *Status*) is a second page per journal for
  health, supplies, threads: always beside the story. Rolls work there too.

## Files

The *File* menu works like a word processor's: **New journal**; **Open**, with
your recent journals and **Browse for a journal file…** (Ctrl+O; a journal
already here can be replaced or kept beside the copy); **Save** (Ctrl+S) and
**Save as…** (Ctrl+Shift+S); **Export as Markdown** (a ZIP with a picture
for each inkblot, when there are any); and
**Print, or save as PDF** (Ctrl+P).

In Chrome and Edge a journal belongs to a file on disk. Save writes straight
back to it, asking where only the first time; Save as asks, and the file chosen
becomes the journal's; a journal opened from its file saves back to that file,
and one kept as a copy starts with no file. The menu shows the file's name.
The link survives a reload (the first Save after one may ask permission to edit
the file). Firefox and Safari cannot write to a file on disk, so there each
save downloads a copy, and Save as asks for the name first.

The journal you write in is kept in this browser and saved as you type; a
saved file is a portable copy and your backup. Clearing the site's data, or
moving to another browser, loses whatever was not saved to a file. Exports put each roll's
words in the text with a footnote naming its oracle and earlier results, and
add the status panel at the end. A journal file holds the copies of the
oracles it rolled, so it re-rolls on any computer.

To put the story into Word, Google Docs or an email, select it (Ctrl+A) and
copy (Ctrl+C): the copy keeps headings, styling and colours, and the inkblots
come as pictures. Rolls paste as their words, without the footnotes.

## Rolling

- **`/` and part of a name** (`/npc mot`) rolls an oracle into the text;
  `/2d6` rolls dice. Arrow keys choose, Enter rolls, Escape closes. **Tab**
  fills in what the matches share, then goes round the names; it never rolls.
- The menu puts **recently rolled oracles first**, and moves up oracles named
  by a word you just wrote ("her motive is /npc" → NPC Motive).
- **Folders**: the side panel's *Oracles* shows the library as a tree,
  folders closed until you open them (each journal remembers which), with
  Expand all / Collapse all and a filter box. Tick **Choose folders** to pick
  which folders this journal rolls from. A click on an oracle rolls it at the
  cursor.
- **Picks**: a list that offers a choice shows its outcomes at the cursor;
  Enter, a click or the number keys pick one, and the chip says it was picked.
- **Bags**: a list drawn without putting back gives each outcome once per
  journal, and refills itself (with a note) when it has given everything.
- **Commands** (side panel, *Commands*): `/feeling` can roll several oracles
  and dice at once, one chip each. Each journal has its own.
- **Alt+R** rolls the last oracle again at the cursor; with a chip selected
  (click it), it re-rolls that chip, keeping the earlier results.
- **Alt+N** follows an outcome that goes to another oracle (the chip shows
  "→ name"). It never rolls by itself.
- An **inkblot** lands as a small blot; click it and choose *Put in the text*
  for the full picture below the paragraph.
- Click any chip for its pop-up: roll again, follow its chain, earlier
  results, and **Turn into text**.
- **Tables inside tables**: an outcome made in Orangey as "A {@Weather}
  morning" rolls Weather into the chip ("A foggy morning"); the chip's pop-up
  says which table gave what.
- **Packs**: a roll from a pack installed in Orangey shows its credit
  ("From Delve Oracles by A. Writer · v1.2 · CC BY 4.0") on the chip's pop-up,
  and every pack used is credited once at the end of an export.
- Every oracle rolled is copied into the journal, so a journal re-rolls
  offline, on another computer, or after the wheel is deleted (unless its
  pack's author asks apps not to keep copies; then re-rolling needs the pack).
- **A journal with folders chosen keeps a copy of them**, with whatever their
  outcomes go to or refer to, so on a computer without Orangey (the journal
  file on a USB stick, opened in `sekwe.html` from disk) you can still
  roll them from the slash menu and the panel. Where Orangey's library is
  present it wins, and the copy is refreshed from it; a folder this computer's
  library does not have is kept as it was. With no folders chosen, nothing
  extra is copied. A wheel edited
  in Orangey rolls as edited from the next roll (Sekwe reads the library
  again whenever its tab comes back); what is already in the text never changes.

`dist/sekwe.html` also opens straight from disk: double-click it.

Journals are kept in this browser (IndexedDB, database `sekwe`) and saved
half a second after you stop typing (and at once when you save to a file).

## How it relates to Orangey

Orangey is where oracles are made and tested; Sekwe is where they are
played. Both read the same files, and Sekwe rolls them with Orangey's own
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
npm test               unit tests: Sekwe's own, and Orangey's on the copy
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

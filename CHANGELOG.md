# Changelog

## Unreleased

- **A journal keeps a copy of its folders.** With folders chosen, the journal
  holds those folders' oracles (and what they go to or refer to), so it rolls
  on a computer without Orangey: save it to a file, open it in
  `storyboard.html` from disk, and the slash menu and panel still work. The
  library here wins and refreshes the copy; with no folders chosen, nothing
  extra is copied. The panel says when it is rolling from the copy.
- **Pack credit.** Rolls from a pack installed in Orangey carry its credit,
  shown on the chip's pop-up and once per pack at the end of a Markdown or
  web page export. A pack whose author asks for no copies in journals is left
  out of the journal's copy and its snapshots.
- **Tables inside tables.** Orangey outcomes like "A {@Weather} morning" roll
  the table they name into the chip; the pop-up and the export's footnote say
  which table gave what. The tables referred to are kept with the journal too.
- **A wider page, your choice of width**: Narrow, Wide (the new default,
  about 92 characters) or Full.
- **Tab completes in the slash menu**, as at a command prompt: what the
  matches share first, then each whole name in turn. Only Enter rolls.
- **Folders per journal.** Choose which Orangey folders a journal rolls from;
  the side panel lists their oracles, grouped by folder, and a click rolls one
  at the cursor. The slash menu searches only those folders.
- **Smarter order in the slash menu**: oracles rolled recently come first,
  and an oracle named by a word you just wrote moves up.
- **Picks and bags.** A list that offers a choice shows it at the cursor and
  lands the pick, marked as picked; a bag gives each outcome once per journal
  and refills itself when empty. Re-rolling a bag's chip puts its old answer
  back first.
- **Your own commands**, per journal: `/feeling` rolls several oracles and
  dice at once, made in the side panel's Commands.
- **A status panel**: a second page per journal beside the story, for health,
  supplies, threads; it takes tables and rolls too.
- **Tables**, in the story and the status panel, with Tab between cells and
  toolbar buttons for rows and columns. Built on prosemirror-tables, which
  comes with Tiptap: nothing new to install.
- **Text styling**: highlight and text colour from small palettes, three
  sizes, and three typefaces (story serif, sans, typewriter).
- **Chapters**: a Chapter heading above Scene and Beat, and a Contents list in
  the side panel that jumps to any of them. Printing starts each chapter on a
  new page.
- **Files**: save a journal to a file (and in Chrome and Edge, save again to
  the same file), open one (replacing the journal it came from, or beside it),
  export as Markdown or a web page with a footnote per roll, and print or save
  as PDF with a print layout that shows only the story.
- **Turn into text** in a chip's pop-up: keeps the words, stops the roll.
- The side panel is now four tabs: Status, Oracles, Contents, Commands.
- **One File menu, as in a word processor**: New, Open (recent journals, then
  Browse for a file), Save, Save as, Export, Print. It replaces the separate
  Journals button.

- **Oracles roll into the text.** Type `/` and part of a name: the matching
  oracles from your Orangey library pop up at the cursor, with their folders,
  and Enter rolls one in place of what was typed. `/2d6` and any dice
  expression roll as dice. A roll sits in the text as a chip.
- **Rolling again.** Alt+R rolls the last oracle again at the cursor. Click a
  chip and Alt+R re-rolls it in place; its earlier results stay, listed in the
  chip's pop-up, and the chip carries a ↻ count.
- **Chains.** An outcome that goes to another oracle shows "→ name" in its
  chip, and Alt+N rolls that oracle. It is never rolled by itself.
- **Inkblots.** A small blot in the text, drawn with Orangey's own shape
  maths; the pop-up shows it large, and *Put in the text* places the full
  picture below the paragraph, drawn a few rows at a time and only when on
  screen. It is stored as its number.
- **The library, read where Orangey keeps it**, with Orangey's own code: the
  browser's storage, or a folder on disk after one click (*Open my Orangey
  folder*). Storyboard only reads it, and reads it again when its tab comes
  back, so an edit in Orangey counts from the next roll. Opened from disk,
  Storyboard says it cannot see the library; dice still roll.
- **Every oracle rolled is copied into the journal** (each version once, with
  the oracle a chain leads to), so a journal re-rolls without the library.
- **`npm run serve:both`** serves Orangey and Storyboard from one local
  address, so they share storage as they will when published.

- **A page to write on.** One screen: the journal's title, a slim toolbar
  (scene and beat headings, bold, italic, lists, quote, separator, undo and
  redo) and the text, set in a serif at a comfortable width, light or dark
  with the system. The usual shortcuts and Markdown typing work (`## ` makes a
  scene heading).
- **Journals, switched in place.** The Journals menu makes a new one (ready to
  be named) or opens another, newest first, without leaving the page. Each
  journal keeps its own undo history, and the app reopens the one used last.
- **Autosave.** Half a second after typing stops, at an idle moment, so a save
  never holds up a keystroke; at once on Ctrl+S, and when the tab is hidden or
  closed. A failed save says so, keeps the words, and retries; a journal is
  never switched away from while its words are unsaved.
- **Offline.** The site precaches itself (caches named `storyboard-…`, so
  Orangey's on the same site are never touched), and `storyboard.html` is the
  whole app in one file that runs from disk. Every path is relative.
- **Tests.** 29 unit tests of its own (10 of them for the sync) and 8 browser tests: typing and reloading,
  journals, no lost keystrokes during saves, Ctrl+S, offline, a deep folder,
  and the single file from disk. The Chromium harness now comes from Orangey
  through the sync.

- **The folder is set up.** Readme, licence, and a copy of Orangey's
  DOM-free code in `vendor/orangey/`, made by `scripts/sync-orangey.mjs`,
  which also says when Orangey has moved on (`--status`). `npm run check`
  fails if that copy is edited by hand or imports something it did not bring;
  `npm test` runs Storyboard's own tests and Orangey's unit tests on the copy.

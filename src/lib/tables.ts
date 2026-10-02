/**
 * Tables, for the story and the status panel, built on prosemirror-tables
 * (which comes with Tiptap's @tiptap/pm, so nothing more to install).
 *
 * A new table has a header row and two rows of cells. Tab and Shift+Tab move
 * between cells; the toolbar adds and removes rows and columns. Cells hold
 * paragraphs, so a roll can land in a cell like anywhere else.
 */

import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  tableEditing,
} from "@tiptap/pm/tables";
import type { Command } from "@tiptap/pm/state";

const cellAttrs = {
  colspan: { default: 1, parseHTML: (el: HTMLElement) => Number(el.getAttribute("colspan") ?? 1) },
  rowspan: { default: 1, parseHTML: (el: HTMLElement) => Number(el.getAttribute("rowspan") ?? 1) },
  colwidth: { default: null, rendered: false },
};

/** prosemirror-tables finds its nodes by `tableRole` in the schema; this passes it through. */
const TableRoles = Extension.create({
  name: "tableRoles",
  extendNodeSchema(extension) {
    const role = (extension.config as { tableRole?: string }).tableRole;
    return role ? { tableRole: role } : {};
  },
});

export const Table = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  isolating: true,
  ...({ tableRole: "table" } as object),
  parseHTML() {
    return [{ tag: "table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes(HTMLAttributes, { class: "sb-table" }), ["tbody", 0]];
  },
  addProseMirrorPlugins() {
    return [tableEditing()];
  },
  addKeyboardShortcuts() {
    const run = (cmd: Command) => () => cmd(this.editor.state, this.editor.view.dispatch);
    return {
      Tab: () => (isInTable(this.editor.state) ? run(goToNextCell(1))() || run(addRowAfter)() && run(goToNextCell(1))() : false),
      "Shift-Tab": () => (isInTable(this.editor.state) ? run(goToNextCell(-1))() : false),
    };
  },
});

export const TableRow = Node.create({
  name: "tableRow",
  content: "(tableCell | tableHeader)*",
  ...({ tableRole: "row" } as object),
  parseHTML() {
    return [{ tag: "tr" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["tr", HTMLAttributes, 0];
  },
});

export const TableCell = Node.create({
  name: "tableCell",
  content: "block+",
  isolating: true,
  ...({ tableRole: "cell" } as object),
  addAttributes() {
    return cellAttrs;
  },
  parseHTML() {
    return [{ tag: "td" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["td", HTMLAttributes, 0];
  },
});

export const TableHeader = Node.create({
  name: "tableHeader",
  content: "block+",
  isolating: true,
  ...({ tableRole: "header_cell" } as object),
  addAttributes() {
    return cellAttrs;
  },
  parseHTML() {
    return [{ tag: "th" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["th", HTMLAttributes, 0];
  },
});

export const TableExtensions = [TableRoles, Table, TableRow, TableHeader, TableCell];

const cell = (type: "tableCell" | "tableHeader") => ({ type, content: [{ type: "paragraph" }] });

/** A table to start from: a header row and two rows, three columns. */
export function newTable(cols = 3, rows = 3): object {
  return {
    type: "table",
    content: Array.from({ length: rows }, (_, r) => ({
      type: "tableRow",
      content: Array.from({ length: cols }, () => cell(r === 0 ? "tableHeader" : "tableCell")),
    })),
  };
}

export const tableCommands = {
  /** Puts a table in and the cursor in its first cell, ready to type. */
  insert: (editor: Editor) => {
    const from = editor.state.selection.from;
    if (!editor.chain().focus().insertContent(newTable()).run()) return false;
    let at = -1;
    editor.state.doc.nodesBetween(Math.max(0, from - 2), editor.state.doc.content.size, (node, pos) => {
      if (at < 0 && node.type.name === "table") at = pos;
      return at < 0;
    });
    // table, row, cell, paragraph: the text starts four steps in.
    if (at >= 0) editor.chain().setTextSelection(at + 4).run();
    return true;
  },
  inTable: (editor: Editor) => isInTable(editor.state),
  addRow: (editor: Editor) => addRowAfter(editor.state, editor.view.dispatch),
  addColumn: (editor: Editor) => addColumnAfter(editor.state, editor.view.dispatch),
  deleteRow: (editor: Editor) => deleteRow(editor.state, editor.view.dispatch),
  deleteColumn: (editor: Editor) => deleteColumn(editor.state, editor.view.dispatch),
  deleteTable: (editor: Editor) => deleteTable(editor.state, editor.view.dispatch),
};

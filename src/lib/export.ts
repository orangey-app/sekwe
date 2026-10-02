/**
 * A journal as Markdown, and as the file Sekwe saves and opens. (Rich text
 * for Word or Docs is Ctrl+C: clipboard.ts.) Written from the stored document (Tiptap JSON), not from the screen,
 * so it runs and is tested without a browser.
 *
 * A roll exports as the words it shows. With `notes` on (the default), each
 * roll also gets a footnote naming its oracle and any earlier results, so the
 * story still says which answers came from the dice.
 */

import { current, chipText, type PackCredit, type RollRecord } from "./rolls.ts";
import type { DocJSON, Journal } from "./journal.ts";

export interface ExportOptions {
  /** Footnotes naming each roll's oracle and earlier results. */
  notes?: boolean;
  /**
   * Inkblots put in the text as pictures: `![Inkblot #42](inkblot-42.png)`,
   * the files going beside the Markdown (blotsIn lists them). Off: a line of text.
   */
  pictures?: boolean;
  /** The status panel, after the story under its own heading. */
  status?: boolean;
}

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const kids = (n: PMNode) => n.content ?? [];

/** What a roll's footnote says: its oracle, and what came up before. */
export function rollNote(record: RollRecord): string {
  const what = record.source.kind === "dice" ? record.source.expression : record.source.name;
  const r = current(record);
  const parts = [r.picked ? `${what}, picked` : what];
  if (r.detail && record.source.kind === "dice") parts.push(r.detail);
  for (const p of r.parts ?? []) parts.push(`${p.name}: ${p.text}`);
  const earlier = record.results.slice(0, -1).map(chipText);
  if (earlier.length) parts.push(`earlier: ${earlier.join(", ")}`);
  return parts.join("; ");
}

/** The packs the rolls came from, once each, in the order first rolled. */
class Credits {
  #by = new Map<string, PackCredit>();
  note(record: RollRecord): void {
    const p = record.source.kind === "oracle" ? record.source.pack : undefined;
    if (p) this.#by.set(`${p.title}\u0000${p.author}\u0000${p.version}`, p);
  }
  get all(): PackCredit[] {
    return [...this.#by.values()];
  }
}

/** "Delve by A. Writer · v1.0 · CC BY 4.0", as the credit at the end says it. */
export function creditText(p: PackCredit): string {
  return [`${p.title} by ${p.author}`, `v${p.version}`, p.licence].filter(Boolean).join(" · ");
}

/** The file an inkblot's picture is saved as, beside the Markdown. */
export const blotFile = (blot: number) => `inkblot-${blot}.png`;

/** The inkblots put in the text (not the chips), in order, once each: the pictures a Markdown export needs. */
export function blotsIn(...docs: (DocJSON | undefined)[]): number[] {
  const out: number[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "inkblot" && typeof n.attrs?.blot === "number" && !out.includes(n.attrs.blot)) out.push(n.attrs.blot);
    kids(n).forEach(walk);
  };
  for (const d of docs) if (d) walk(d as unknown as PMNode);
  return out;
}

// --- Markdown --------------------------------------------------------------------------

const mdEscape = (s: string) => s.replace(/([\\`*_[\]#|<>])/g, "\\$1");

class MarkdownWriter {
  notes: string[] = [];
  credits = new Credits();
  #opts: ExportOptions;
  constructor(opts: ExportOptions) {
    this.#opts = opts;
  }

  inline(nodes: PMNode[]): string {
    return nodes.map((n) => this.inlineNode(n)).join("");
  }

  inlineNode(n: PMNode): string {
    if (n.type === "text") {
      let t = mdEscape(n.text ?? "");
      for (const m of n.marks ?? []) {
        if (m.type === "bold") t = `**${t}**`;
        else if (m.type === "italic") t = `*${t}*`;
        else if (m.type === "strike") t = `~~${t}~~`;
        else if (m.type === "code") t = `\`${n.text}\``;
        else if (m.type === "highlight") t = `==${t}==`;
      }
      return t;
    }
    if (n.type === "hardBreak") return "  \n";
    if (n.type === "roll") {
      const record = n.attrs?.record as RollRecord | null;
      if (!record) return "";
      const text = mdEscape(chipText(current(record)));
      this.credits.note(record);
      if (!this.#opts.notes) return text;
      this.notes.push(rollNote(record));
      return `${text}[^${this.notes.length}]`;
    }
    return this.inline(kids(n));
  }

  block(n: PMNode, indent = ""): string {
    switch (n.type) {
      case "heading":
        return `${"#".repeat(Number(n.attrs?.level ?? 1))} ${this.inline(kids(n))}`;
      case "paragraph":
        return indent + this.inline(kids(n));
      case "blockquote":
        return kids(n).map((c) => this.block(c).split("\n").map((l) => `> ${l}`).join("\n")).join("\n>\n");
      case "horizontalRule":
        return "---";
      case "bulletList":
      case "orderedList":
        return kids(n)
          .map((item, i) => {
            const bullet = n.type === "bulletList" ? "- " : `${i + 1}. `;
            const [first, ...rest] = kids(item);
            const head = indent + bullet + (first ? this.block(first).trimStart() : "");
            const more = rest.map((c) => this.block(c, indent + "   ")).filter(Boolean);
            return [head, ...more].join("\n");
          })
          .join("\n");
      case "codeBlock":
        return "```\n" + kids(n).map((t) => t.text ?? "").join("") + "\n```";
      case "inkblot":
        return this.#opts.pictures && n.attrs?.blot ? `![Inkblot #${n.attrs.blot}](${blotFile(Number(n.attrs.blot))})` : `*[Inkblot #${n.attrs?.blot}]*`;
      case "table": {
        const rows = kids(n).map((row) => kids(row).map((cell) => kids(cell).map((p) => this.inline(kids(p))).join(" ").replace(/\n/g, " ")));
        if (rows.length === 0) return "";
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
        const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
        return [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
      }
      default:
        return kids(n).map((c) => this.block(c, indent)).join("\n\n");
    }
  }

  doc(d: DocJSON): string {
    return kids(d as unknown as PMNode)
      .map((n) => this.block(n))
      .filter((s) => s.trim() !== "")
      .join("\n\n");
  }
}

export function toMarkdown(j: Journal, opts: ExportOptions = {}): string {
  const o = { notes: true, status: true, ...opts };
  const w = new MarkdownWriter(o);
  const parts = [`# ${mdEscape(j.title)}`, w.doc(j.doc)];
  if (o.status && j.status && hasText(j.status)) parts.push("---", "## Status", w.doc(j.status));
  let out = parts.filter(Boolean).join("\n\n");
  const credits = w.credits.all;
  if (credits.length) {
    out += "\n\n---\n\nOracles from " + credits.map((p) => mdEscape(creditText(p)) + (p.homepage && /^https?:\/\/[^\s<>]+$/i.test(p.homepage) ? ` (<${p.homepage}>)` : "")).join("; ") + ".";
  }
  if (w.notes.length) out += "\n\n" + w.notes.map((n, i) => `[^${i + 1}]: ${n}`).join("\n");
  return out + "\n";
}

// --- the journal file ------------------------------------------------------------------

export const FILE_SUFFIX = ".sekwe.json";

/** The journal as a file: the same object Sekwe stores, pretty-printed. */
export function toFile(j: Journal): string {
  return `${JSON.stringify(j, null, 2)}\n`;
}

/** A file name from a title: "The Drowned Coast" → "the-drowned-coast". */
export function fileStem(title: string): string {
  const stem = title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return stem || "journal";
}

function hasText(d: DocJSON): boolean {
  const walk = (n: PMNode): boolean => (n.type === "text" && !!n.text?.trim()) || n.type === "roll" || n.type === "inkblot" || n.type === "table" || kids(n).some(walk);
  return walk(d as unknown as PMNode);
}

// --- chapters --------------------------------------------------------------------------

export interface OutlineEntry {
  level: number;
  text: string;
  /** Position of the heading in the document, for jumping to it. */
  pos: number;
}

/** The headings of a document, in order: chapters, scenes and beats. */
export function outline(doc: { descendants(f: (node: { type: { name: string }; attrs: Record<string, unknown>; textContent: string }, pos: number) => boolean | void): void }): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      out.push({ level: Number(node.attrs.level ?? 1), text: node.textContent.trim() || "Untitled", pos });
      return false;
    }
    // Headings sit at the top level; nothing below a block needs looking at.
    return node.type.name === "doc";
  });
  return out;
}

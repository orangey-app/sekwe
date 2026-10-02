/**
 * A journal as Markdown, as a web page, and as the file Sekwe saves and
 * opens. Written from the stored document (Tiptap JSON), not from the screen,
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
        return `*[Inkblot #${n.attrs?.blot}]*`;
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

// --- HTML ------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

class HtmlWriter {
  notes: string[] = [];
  credits = new Credits();
  #opts: ExportOptions;
  constructor(opts: ExportOptions) {
    this.#opts = opts;
  }

  node(n: PMNode): string {
    const inner = () => kids(n).map((c) => this.node(c)).join("");
    switch (n.type) {
      case "doc":
        return inner();
      case "text": {
        let t = esc(n.text ?? "");
        for (const m of n.marks ?? []) {
          const a = m.attrs ?? {};
          if (m.type === "bold") t = `<strong>${t}</strong>`;
          else if (m.type === "italic") t = `<em>${t}</em>`;
          else if (m.type === "strike") t = `<s>${t}</s>`;
          else if (m.type === "code") t = `<code>${t}</code>`;
          else if (m.type === "highlight" && a.highlight) t = `<mark class="hl-${esc(String(a.highlight))}">${t}</mark>`;
          else if (m.type === "textColour" && a.colour) t = `<span class="tc-${esc(String(a.colour))}">${t}</span>`;
          else if (m.type === "fontSize" && a.size) t = `<span class="fs-${esc(String(a.size))}">${t}</span>`;
          else if (m.type === "fontFamily" && a.font) t = `<span class="ff-${esc(String(a.font))}">${t}</span>`;
        }
        return t;
      }
      case "hardBreak":
        return "<br>";
      case "paragraph":
        return `<p>${inner()}</p>`;
      case "heading": {
        const l = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1) + 1));
        return `<h${l}>${inner()}</h${l}>`;
      }
      case "blockquote":
        return `<blockquote>${inner()}</blockquote>`;
      case "horizontalRule":
        return `<hr>`;
      case "bulletList":
        return `<ul>${inner()}</ul>`;
      case "orderedList":
        return `<ol>${inner()}</ol>`;
      case "listItem":
        return `<li>${inner()}</li>`;
      case "codeBlock":
        return `<pre><code>${inner()}</code></pre>`;
      case "table":
        return `<table>${inner()}</table>`;
      case "tableRow":
        return `<tr>${inner()}</tr>`;
      case "tableHeader":
        return `<th>${inner()}</th>`;
      case "tableCell":
        return `<td>${inner()}</td>`;
      case "inkblot":
        return `<figure class="blot">[Inkblot #${esc(String(n.attrs?.blot ?? ""))}]</figure>`;
      case "roll": {
        const record = n.attrs?.record as RollRecord | null;
        if (!record) return "";
        const text = esc(chipText(current(record)));
        this.credits.note(record);
        if (!this.#opts.notes) return `<span class="roll">${text}</span>`;
        this.notes.push(rollNote(record));
        const k = this.notes.length;
        return `<span class="roll">${text}</span><sup><a href="#note-${k}" id="ref-${k}">${k}</a></sup>`;
      }
      default:
        return inner();
    }
  }
}

const PAGE_CSS = `
body { font: 18px/1.6 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; color: #26251f; background: #fffefb; max-width: 44rem; margin: 3rem auto; padding: 0 1.25rem; }
h1 { font-size: 2rem; margin-bottom: 2rem; } h2 { font-size: 1.6rem; margin-top: 2.5em; } h3 { font-size: 1.3rem; margin-top: 2em; } h4 { font-size: 1.1rem; }
blockquote { margin: 0 0 1em; padding-left: 1em; border-left: 3px solid #e2dfd6; color: #6b6960; }
hr { border: none; text-align: center; margin: 2em 0; } hr::after { content: "⁂"; color: #6b6960; }
table { border-collapse: collapse; margin: 1em 0; } th, td { border: 1px solid #d8d4c8; padding: .3em .6em; text-align: left; vertical-align: top; } th { background: #f1efe8; } td p, th p { margin: 0; }
.roll { background: #e9eef3; border-radius: 3px; padding: 0 .25em; } sup a { text-decoration: none; color: #3a5a7a; font-size: .75em; }
.notes { margin-top: 3em; border-top: 1px solid #e2dfd6; font-size: .85em; color: #6b6960; }
.hl-yellow { background: #fbeea6; } .hl-green { background: #cdeec4; } .hl-blue { background: #cfe3f6; } .hl-pink { background: #f7d1e1; }
.tc-red { color: #b3261e; } .tc-orange { color: #b45309; } .tc-green { color: #2e7d32; } .tc-blue { color: #1d5fa8; } .tc-purple { color: #7b3fa0; } .tc-grey { color: #6b6960; }
.fs-small { font-size: .85em; } .fs-large { font-size: 1.25em; } .fs-larger { font-size: 1.6em; }
.ff-sans { font-family: system-ui, sans-serif; } .ff-mono { font-family: ui-monospace, "Courier New", monospace; }
.blot { color: #6b6960; font-style: italic; text-align: center; }
.status { margin-top: 3em; border-top: 1px solid #e2dfd6; }
.credits { margin-top: 3em; font-size: .85em; color: #6b6960; }
`;

export function toHtml(j: Journal, opts: ExportOptions = {}): string {
  const o = { notes: true, status: true, ...opts };
  const w = new HtmlWriter(o);
  const story = w.node(j.doc as unknown as PMNode);
  const status = o.status && j.status && hasText(j.status) ? `<section class="status"><h2>Status</h2>${w.node(j.status as unknown as PMNode)}</section>` : "";
  const notes = w.notes.length
    ? `<section class="notes"><ol>${w.notes.map((n, i) => `<li id="note-${i + 1}">${esc(n)} <a href="#ref-${i + 1}">↩</a></li>`).join("")}</ol></section>`
    : "";
  const credits = w.credits.all.length
    ? `<p class="credits">Oracles from ${w.credits.all.map((p) => esc(creditText(p)) + (p.homepage && /^https?:\/\//i.test(p.homepage) ? ` (<a href="${esc(p.homepage)}">web page</a>)` : "")).join("; ")}.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(j.title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<h1>${esc(j.title)}</h1>
${story}
${status}
${credits}
${notes}
</body>
</html>
`;
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

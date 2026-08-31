import "katex/dist/katex.min.css";
import renderMathInElement from "katex/contrib/auto-render";
import { renderMarkdownImage, rewriteHtmlMedia } from "./media";

type Line = { startLine: number };

export type MarkdownBlock =
  | (Line & { type: "frontmatter"; lines: string[] })
  | (Line & { type: "heading"; depth: number; text: string })
  | (Line & { type: "paragraph"; lines: string[] })
  | (Line & { type: "code"; language: string; lines: string[] })
  | (Line & { type: "table"; rows: string[][]; aligns: Array<"left" | "center" | "right"> })
  | (Line & { type: "list"; ordered: boolean; items: string[] })
  | (Line & { type: "quote"; lines: string[] })
  | (Line & { type: "html"; lines: string[] })
  | (Line & { type: "rule" });

export interface ParsedMarkdown {
  blocks: MarkdownBlock[];
  diagnostics: string[];
}

export interface OutlineItem {
  id: string;
  depth: number;
  text: string;
}

const calloutPattern = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;

export function parseMarkdown(source: string): ParsedMarkdown {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  const diagnostics: string[] = [];
  let index = 0;

  if (lines[0] === "---" || lines[0] === "+++" || lines[0] === "{") {
    const frontmatter = readFrontmatter(lines);
    if (frontmatter) {
      blocks.push({ type: "frontmatter", startLine: 1, lines: frontmatter.lines });
      index = frontmatter.nextIndex;
    }
  }

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}(```+|~~~+)\s*([^`]*)$/);
    if (fence) {
      const result = readFence(lines, index, fence[1]);
      blocks.push({
        type: "code",
        startLine: index + 1,
        language: (fence[2] ?? "").trim().split(/\s+/)[0] ?? "",
        lines: result.lines
      });
      if (!result.closed) {
        diagnostics.push(`Unclosed code fence starting at line ${index + 1}.`);
      }
      index = result.nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push({ type: "heading", startLine: index + 1, depth: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "rule", startLine: index + 1 });
      index += 1;
      continue;
    }

    if (looksLikeTable(lines, index)) {
      const result = readTable(lines, index);
      blocks.push(result.table);
      index = result.nextIndex;
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const result = readList(lines, index, /^\s*\d+[.)]\s+/.test(line));
      blocks.push(result.list);
      index = result.nextIndex;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const result = readQuote(lines, index);
      blocks.push(result.quote);
      index = result.nextIndex;
      continue;
    }

    if (looksLikeHtml(line)) {
      const result = readHtml(lines, index);
      blocks.push({ type: "html", startLine: index + 1, lines: result.lines });
      index = result.nextIndex;
      continue;
    }

    const paragraph = readParagraph(lines, index);
    blocks.push({ type: "paragraph", startLine: index + 1, lines: paragraph.lines });
    index = paragraph.nextIndex;
  }

  return { blocks, diagnostics };
}

export function outlineFromParsed(parsed: ParsedMarkdown): OutlineItem[] {
  const used = new Map<string, number>();
  const items: OutlineItem[] = [];

  for (const block of parsed.blocks) {
    if (block.type !== "heading") continue;
    const base = slugify(block.text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    items.push({
      id: count === 0 ? base : `${base}-${count}`,
      depth: block.depth,
      text: stripHeadingMarks(block.text)
    });
  }

  return items;
}

export function renderMarkdown(parsed: ParsedMarkdown, baseDir: string | null = null): string {
  const outline = outlineFromParsed(parsed);
  let headingIndex = 0;
  const body = parsed.blocks
    .filter((block) => block.type !== "frontmatter")
    .map((block) => {
      if (block.type === "heading") {
        const item = outline[headingIndex] ?? { id: "section", depth: block.depth, text: block.text };
        headingIndex += 1;
        return markLine(
          `<h${block.depth} id="${escapeHtml(item.id)}">${renderInline(block.text, baseDir)}</h${block.depth}>`,
          block.startLine
        );
      }
      return markLine(renderBlock(block, baseDir), block.startLine);
    })
    .join("\n");
  const diagnostics = parsed.diagnostics.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const warning = diagnostics ? `<aside class="diagnostics"><strong>Rendering notes</strong><ul>${diagnostics}</ul></aside>` : "";

  const html = `${warning}${body}`;

  // KaTeX typesets real math in a detached node so the main preview
  // only re-renders when the debounced source actually changes.
  const host = document.createElement("div");
  host.innerHTML = html;
  try {
    renderMathInElement(host, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false }
      ],
      throwOnError: false,
      strict: false
    });
  } catch {
    // Rendering falls back to the raw LaTeX text on failure.
  }
  return host.innerHTML;
}

function renderBlock(block: MarkdownBlock, baseDir: string | null): string {
  switch (block.type) {
    case "heading":
      return `<h${block.depth}>${renderInline(block.text, baseDir)}</h${block.depth}>`;
    case "paragraph":
      return `<p>${renderInline(block.lines.join(" "), baseDir)}</p>`;
    case "code":
      return renderCode(block);
    case "table":
      return renderTable(block, baseDir);
    case "list":
      return renderList(block, baseDir);
    case "quote":
      return renderQuote(block, baseDir);
    case "html":
      return `<div class="raw-html">${rewriteHtmlMedia(block.lines.join("\n"), baseDir)}</div>`;
    case "rule":
      return "<hr>";
    case "frontmatter":
      return "";
  }
}

function renderCode(block: Extract<MarkdownBlock, { type: "code" }>): string {
  const language = block.language ? ` data-language="${escapeHtml(block.language)}"` : "";
  const content = escapeHtml(block.lines.join("\n"));
  if (block.language.toLowerCase() === "mermaid") {
    return `<figure class="diagram"><figcaption>Mermaid</figcaption><pre><code${language}>${content}</code></pre></figure>`;
  }
  const label = escapeHtml(block.language || "text");
  return `<figure class="code-block"><figcaption class="code-toolbar"><span>${label}</span><button type="button" class="copy-code">Copy</button></figcaption><pre><code${language}>${content}</code></pre></figure>`;
}

function renderTable(block: Extract<MarkdownBlock, { type: "table" }>, baseDir: string | null): string {
  const [head = [], ...body] = block.rows;
  const headings = head
    .map((cell, index) => `<th class="${block.aligns[index] ?? "left"}">${renderInline(cell, baseDir)}</th>`)
    .join("");
  const rows = body
    .map((row) => `<tr>${row.map((cell, index) => `<td class="${block.aligns[index] ?? "left"}">${renderInline(cell, baseDir)}</td>`).join("")}</tr>`)
    .join("");

  return `<div class="table-wrap"><table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderList(block: Extract<MarkdownBlock, { type: "list" }>, baseDir: string | null): string {
  const tag = block.ordered ? "ol" : "ul";
  if (block.ordered) {
    const items = block.items.map((item) => `<li>${renderInline(item, baseDir)}</li>`).join("");
    return `<${tag}>${items}</${tag}>`;
  }

  const hasTasks = block.items.some((item) => /^\[[ xX]\]\s*/.test(item));
  if (!hasTasks) {
    const items = block.items.map((item) => `<li>${renderInline(item, baseDir)}</li>`).join("");
    return `<${tag}>${items}</${tag}>`;
  }

  const items = block.items
    .map((item) => {
      const match = item.match(/^\[([ xX])\]\s*(.*)$/);
      if (!match) return `<li>${renderInline(item, baseDir)}</li>`;
      const checked = match[1].toLowerCase() === "x";
      const checkbox = `<input type="checkbox" class="task-checkbox" disabled ${checked ? "checked" : ""}>`;
      const label = checked ? `<del>${renderInline(match[2] ?? "", baseDir)}</del>` : renderInline(match[2] ?? "", baseDir);
      return `<li class="task-item">${checkbox}<span>${label}</span></li>`;
    })
    .join("");
  return `<${tag} class="task-list">${items}</${tag}>`;
}

function renderQuote(block: Extract<MarkdownBlock, { type: "quote" }>, baseDir: string | null): string {
  const first = block.lines[0] ?? "";
  const callout = first.match(calloutPattern);
  if (callout) {
    const title = callout[1].toUpperCase();
    const rest = [callout[2], ...block.lines.slice(1)].filter(Boolean).join(" ");
    return `<aside class="callout ${title.toLowerCase()}"><strong>${title}</strong><p>${renderInline(rest, baseDir)}</p></aside>`;
  }
  return `<blockquote>${block.lines.map((line) => `<p>${renderInline(line, baseDir)}</p>`).join("")}</blockquote>`;
}

function renderInline(value: string, baseDir: string | null): string {
  let text = escapeHtml(value);
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, destination: string) =>
    renderMarkdownImage(alt, destination, baseDir)
  );
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
    const safeUrl = String(url).trim();
    if (!/^(https?:|mailto:|#|\.{0,2}\/|[A-Za-z]:\\)/.test(safeUrl)) {
      return label;
    }
    return `<a href="${escapeHtml(safeUrl)}">${label}</a>`;
  });
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/_([^_]+)_/g, "<em>$1</em>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // Math is left in place here; KaTeX auto-render typesets it in renderMarkdown.
  return text;
}

function readFrontmatter(lines: string[]): { lines: string[]; nextIndex: number } | null {
  const opener = lines[0];
  if (opener === "---" || opener === "+++") {
    const closing = opener;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index] === closing) {
        return { lines: lines.slice(0, index + 1), nextIndex: index + 1 };
      }
    }
  }

  if (opener === "{") {
    for (let index = 1; index < Math.min(lines.length, 80); index += 1) {
      if (lines[index] === "}") {
        return { lines: lines.slice(0, index + 1), nextIndex: index + 1 };
      }
    }
  }

  return null;
}

function readFence(lines: string[], start: number, fence: string): { lines: string[]; nextIndex: number; closed: boolean } {
  const marker = fence[0];
  const size = fence.length;
  const body: string[] = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    if (new RegExp(`^ {0,3}${escapeRegExp(marker)}{${size},}\\s*$`).test(lines[index] ?? "")) {
      return { lines: body, nextIndex: index + 1, closed: true };
    }
    body.push(lines[index] ?? "");
  }

  return { lines: body, nextIndex: lines.length, closed: false };
}

function looksLikeTable(lines: string[], index: number): boolean {
  const head = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  return head.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator);
}

function readTable(lines: string[], start: number): { table: Extract<MarkdownBlock, { type: "table" }>; nextIndex: number } {
  const rows: string[][] = [];
  const aligns = splitTableRow(lines[start + 1] ?? "").map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    return "left";
  });
  let index = start;

  while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim()) {
    if (index !== start + 1) {
      rows.push(splitTableRow(lines[index] ?? ""));
    }
    index += 1;
  }

  return { table: { type: "table", startLine: start + 1, rows, aligns }, nextIndex: index };
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of trimmed) {
    if (char === "\\" && !escaped) {
      escaped = true;
      current += char;
      continue;
    }
    if (char === "|" && !escaped) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    escaped = false;
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function readList(lines: string[], start: number, ordered: boolean): { list: Extract<MarkdownBlock, { type: "list" }>; nextIndex: number } {
  const items: string[] = [];
  let index = start;
  const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;

  while (index < lines.length) {
    const match = (lines[index] ?? "").match(pattern);
    if (!match) break;
    items.push(match[1]);
    index += 1;
  }

  return { list: { type: "list", startLine: start + 1, ordered, items }, nextIndex: index };
}

function readQuote(lines: string[], start: number): { quote: Extract<MarkdownBlock, { type: "quote" }>; nextIndex: number } {
  const body: string[] = [];
  let index = start;

  while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
    body.push((lines[index] ?? "").replace(/^>\s?/, ""));
    index += 1;
  }

  return { quote: { type: "quote", startLine: start + 1, lines: body }, nextIndex: index };
}

function looksLikeHtml(line: string): boolean {
  return /^ {0,3}<\/?[a-zA-Z][\w:-]*[\s>/]|^ {0,3}<!--|^ {0,3}<!doctype/i.test(line);
}

function readHtml(lines: string[], start: number): { lines: string[]; nextIndex: number } {
  const body: string[] = [];
  let index = start;
  while (index < lines.length && (lines[index] ?? "").trim()) {
    body.push(lines[index] ?? "");
    index += 1;
  }
  return { lines: body, nextIndex: index };
}

function readParagraph(lines: string[], start: number): { lines: string[]; nextIndex: number } {
  const body: string[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) break;
    if (/^(#{1,6})\s+/.test(line) || /^>\s?/.test(line) || /^ {0,3}(```+|~~~+)/.test(line)) break;
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line) || looksLikeTable(lines, index) || looksLikeHtml(line)) break;
    body.push(line.trim());
    index += 1;
  }

  return { lines: body, nextIndex: index };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHeadingMarks(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

function slugify(text: string): string {
  const slug = stripHeadingMarks(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function markLine(html: string, line: number): string {
  return html.replace(/^<([a-zA-Z0-9-]+)/, `<$1 data-line="${line}"`);
}

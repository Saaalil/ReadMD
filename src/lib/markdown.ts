import "katex/dist/katex.min.css";
import renderMathInElement from "katex/contrib/auto-render";
import MarkdownIt, { type Token } from "markdown-it";
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
  tokens: Token[];
  lineOffset: number;
}

export interface OutlineItem {
  id: string;
  depth: number;
  text: string;
}

const calloutPattern = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;

const md = new MarkdownIt("commonmark", { html: true }).enable(["table", "strikethrough"]);

export function parseMarkdown(source: string): ParsedMarkdown {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let lineOffset = 0;

  if (lines[0] === "---" || lines[0] === "+++" || lines[0] === "{") {
    const frontmatter = readFrontmatter(lines);
    if (frontmatter) {
      blocks.push({ type: "frontmatter", startLine: 1, lines: frontmatter.lines });
      lineOffset = frontmatter.nextIndex;
    }
  }

  const body = lines.slice(lineOffset);
  const tokens = md.parse(body.join("\n"), {});
  blocks.push(...tokensToBlocks(tokens, lineOffset));

  return { blocks, diagnostics: findUnclosedFences(body, lineOffset), tokens, lineOffset };
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
  return `${warning}${body}`;
}

export function typesetMath(root: HTMLElement): void {
  try {
    renderMathInElement(root, {
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
}

function tokensToBlocks(tokens: Token[], offset: number): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];

    switch (token.type) {
      case "heading_open": {
        const inline = tokens[index + 1];
        blocks.push({
          type: "heading",
          startLine: startLineOf(token, offset),
          depth: Number(token.tag.slice(1)) || 1,
          text: inline?.type === "inline" ? inline.content : ""
        });
        index = closeIndex(tokens, index, "heading_close") + 1;
        continue;
      }
      case "paragraph_open": {
        const inline = tokens[index + 1];
        blocks.push({
          type: "paragraph",
          startLine: startLineOf(token, offset),
          lines: (inline?.type === "inline" ? inline.content : "").split("\n")
        });
        index = closeIndex(tokens, index, "paragraph_close") + 1;
        continue;
      }
      case "fence":
      case "code_block": {
        blocks.push({
          type: "code",
          startLine: startLineOf(token, offset),
          language: token.type === "fence" ? (token.info.trim().split(/\s+/)[0] ?? "") : "",
          lines: token.content.replace(/\n$/, "").split("\n")
        });
        index += 1;
        continue;
      }
      case "hr": {
        blocks.push({ type: "rule", startLine: startLineOf(token, offset) });
        index += 1;
        continue;
      }
      case "html_block": {
        blocks.push({
          type: "html",
          startLine: startLineOf(token, offset),
          lines: token.content.replace(/\n$/, "").split("\n")
        });
        index += 1;
        continue;
      }
      case "table_open": {
        const end = closeIndex(tokens, index, "table_close");
        blocks.push(tableFromTokens(tokens, index, end, startLineOf(token, offset)));
        index = end + 1;
        continue;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const ordered = token.type === "ordered_list_open";
        const end = closeIndex(tokens, index, ordered ? "ordered_list_close" : "bullet_list_close");
        blocks.push({
          type: "list",
          startLine: startLineOf(token, offset),
          ordered,
          items: inlineContents(tokens, index, end)
        });
        index = end + 1;
        continue;
      }
      case "blockquote_open": {
        const end = closeIndex(tokens, index, "blockquote_close");
        blocks.push({
          type: "quote",
          startLine: startLineOf(token, offset),
          lines: inlineContents(tokens, index, end).flatMap((content) => content.split("\n"))
        });
        index = end + 1;
        continue;
      }
      default:
        index += 1;
    }
  }

  return blocks;
}

function startLineOf(token: Token, offset: number): number {
  return (token.map ? token.map[0] : 0) + 1 + offset;
}

function closeIndex(tokens: Token[], start: number, type: string): number {
  const level = tokens[start].level;
  for (let index = start + 1; index < tokens.length; index += 1) {
    if (tokens[index].type === type && tokens[index].level === level) return index;
  }
  return tokens.length - 1;
}

function inlineContents(tokens: Token[], start: number, end: number): string[] {
  const contents: string[] = [];
  for (let index = start + 1; index < end; index += 1) {
    if (tokens[index].type === "inline") contents.push(tokens[index].content);
  }
  return contents;
}

function tableFromTokens(
  tokens: Token[],
  start: number,
  end: number,
  startLine: number
): Extract<MarkdownBlock, { type: "table" }> {
  const rows: string[][] = [];
  const aligns: Array<"left" | "center" | "right"> = [];
  let row: string[] | null = null;

  for (let index = start + 1; index < end; index += 1) {
    const token = tokens[index];
    if (token.type === "tr_open") {
      row = [];
    } else if (token.type === "tr_close" && row) {
      rows.push(row);
      row = null;
    } else if (token.type === "th_open" || token.type === "td_open") {
      const inline = tokens[index + 1];
      row?.push(inline?.type === "inline" ? inline.content : "");
      if (token.type === "th_open") aligns.push(cellAlign(token));
    }
  }

  return { type: "table", startLine, rows, aligns };
}

function cellAlign(token: Token): "left" | "center" | "right" {
  const style = String(token.attrGet("style") ?? "");
  if (style.includes("center")) return "center";
  if (style.includes("right")) return "right";
  return "left";
}

function findUnclosedFences(lines: string[], offset: number): string[] {
  let open: { marker: string; size: number; line: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const match = (lines[index] ?? "").match(/^ {0,3}(`{3,}|~{3,})/);
    if (!match) continue;
    if (!open) {
      open = { marker: match[1][0], size: match[1].length, line: index + 1 + offset };
    } else if (match[1][0] === open.marker && match[1].length >= open.size && /^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[index] ?? "")) {
      open = null;
    }
  }

  return open ? [`Unclosed code fence starting at line ${open.line}.`] : [];
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
  const images: string[] = [];
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, destination: string) => {
    images.push(renderMarkdownImage(alt, destination, baseDir));
    return `\0IMG${images.length - 1}\0`;
  });
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
  text = text.replace(/\0IMG(\d+)\0/g, (_match, index: string) => images[Number(index)] ?? "");
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

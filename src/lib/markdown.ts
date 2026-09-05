import "katex/dist/katex.min.css";
import renderMathInElement from "katex/contrib/auto-render";
import MarkdownIt, { type Env, type Token } from "markdown-it";
import { renderMarkdownImage, rewriteHtmlMedia } from "./media";
import { mermaidFigureHtml } from "./mermaid.ts";
import { wikiAnchorHtml } from "./wiki.ts";

const wikiPattern = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

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

const safeLinkPattern = /^(https?:|mailto:|#|\.{0,2}\/|[A-Za-z]:\\)/;
const calloutPattern = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;
const taskMarkerPattern = /^\[([ xX])\]\s+/;

const md = new MarkdownIt("commonmark", { html: true }).enable(["table", "strikethrough"]);

// markdown-it only exposes Token as a type, so borrow the constructor from a parsed token.
const TokenClass = md.parse("x", {})[0].constructor as new (type: string, tag: string, nesting: 0 | 1 | -1) => Token;

md.renderer.rules.fence = (tokens, idx) => renderCodeToken(tokens[idx]);
md.renderer.rules.code_block = (tokens, idx) => renderCodeToken(tokens[idx]);

md.renderer.rules.html_block = (tokens, idx, _options, env) =>
  `<div class="raw-html"${attrText(tokens[idx])}>${rewriteHtmlMedia(tokens[idx].content, baseDirOf(env))}</div>`;

md.renderer.rules.html_inline = (tokens, idx, _options, env) =>
  rewriteHtmlMedia(tokens[idx].content, baseDirOf(env));

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = String(token.attrGet("src") ?? "");
  const title = token.attrGet("title");
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const destination = title == null ? src : `${src} "${title}"`;
  return renderMarkdownImage(alt, destination, baseDirOf(env));
};

md.renderer.rules.table_open = (tokens, idx) => `<div class="table-wrap"><table${attrText(tokens[idx])}>`;
md.renderer.rules.table_close = () => "</table></div>";

// The stylesheet targets del, not the s tags markdown-it emits for strikethrough.
md.renderer.rules.s_open = () => "<del>";
md.renderer.rules.s_close = () => "</del>";

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
  decorateTokens(tokens, lineOffset, outlineFromBlocks(blocks));

  return { blocks, diagnostics: findUnclosedFences(body, lineOffset), tokens, lineOffset };
}

export function outlineFromParsed(parsed: ParsedMarkdown): OutlineItem[] {
  return outlineFromBlocks(parsed.blocks);
}

export function renderMarkdown(parsed: ParsedMarkdown, baseDir: string | null = null): string {
  const env: Env = { baseDir };
  const body = md.renderer.render(parsed.tokens, md.options, env);
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

function outlineFromBlocks(blocks: MarkdownBlock[]): OutlineItem[] {
  const used = new Map<string, number>();
  const items: OutlineItem[] = [];

  for (const block of blocks) {
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

function decorateTokens(tokens: Token[], offset: number, outline: OutlineItem[]): void {
  let headingIndex = 0;

  for (const token of tokens) {
    if (token.level === 0 && token.map && token.nesting >= 0 && token.type !== "inline") {
      token.attrSet("data-line", String(token.map[0] + 1 + offset));
    }
    if (token.type === "heading_open" && token.level === 0) {
      const item = outline[headingIndex];
      headingIndex += 1;
      if (item) token.attrSet("id", item.id);
    }
    if (token.type === "th_open" || token.type === "td_open") {
      alignCell(token);
    }
    if (token.type === "inline" && token.children) {
      hideUnsafeLinks(token.children);
    }
  }

  transformTaskLists(tokens);
  transformCallouts(tokens);
  transformWikiLinks(tokens);
}

function transformWikiLinks(tokens: Token[]): void {
  for (const token of tokens) {
    if (token.type !== "inline" || !token.children) continue;
    const next: Token[] = [];
    for (const child of token.children) {
      if (child.type !== "text" || !child.content.includes("[[")) {
        next.push(child);
        continue;
      }
      let last = 0;
      let matched = false;
      for (const match of child.content.matchAll(wikiPattern)) {
        matched = true;
        const start = match.index ?? 0;
        if (start > last) next.push(textToken(child.content.slice(last, start)));
        const target = (match[1] ?? "").trim();
        next.push(htmlToken(wikiAnchorHtml((match[2] ?? target).trim() || target, target)));
        last = start + match[0].length;
      }
      if (!matched) {
        next.push(child);
        continue;
      }
      if (last < child.content.length) next.push(textToken(child.content.slice(last)));
    }
    token.children = next;
  }
}

function textToken(content: string): Token {
  const token = new TokenClass("text", "", 0);
  token.content = content;
  return token;
}

function transformTaskLists(tokens: Token[]): void {
  const listStack: Token[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "bullet_list_open") {
      listStack.push(token);
      continue;
    }
    if (token.type === "bullet_list_close") {
      listStack.pop();
      continue;
    }
    if (token.type !== "list_item_open" || !listStack.length) continue;

    const inline = findItemInline(tokens, index);
    const first = inline?.children?.[0];
    const match = first?.type === "text" ? first.content.match(taskMarkerPattern) : null;
    if (!inline || !first || !match) continue;

    const checked = match[1].toLowerCase() === "x";
    first.content = first.content.slice(match[0].length);
    inline.content = inline.content.replace(taskMarkerPattern, "");
    token.attrJoin("class", "task-item");
    const list = listStack[listStack.length - 1];
    if (!String(list.attrGet("class") ?? "").includes("task-list")) {
      list.attrJoin("class", "task-list");
    }

    const children = [
      htmlToken(`<input type="checkbox" class="task-checkbox" disabled${checked ? " checked" : ""}>`),
      htmlToken(checked ? "<span><del>" : "<span>"),
      ...(inline.children ?? []),
      htmlToken(checked ? "</del></span>" : "</span>")
    ];
    inline.children = children;
  }
}

function findItemInline(tokens: Token[], itemIndex: number): Token | null {
  const level = tokens[itemIndex].level;
  for (let index = itemIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].type === "list_item_close" && tokens[index].level === level) return null;
    if (tokens[index].type === "inline") return tokens[index];
  }
  return null;
}

function transformCallouts(tokens: Token[]): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "blockquote_open") continue;
    const paragraph = tokens[index + 1];
    const inline = tokens[index + 2];
    if (paragraph?.type !== "paragraph_open" || inline?.type !== "inline") continue;
    const first = inline.children?.[0];
    if (first?.type !== "text") continue;
    const match = first.content.match(calloutPattern);
    if (!match) continue;

    const title = match[1].toUpperCase();
    token.tag = "aside";
    token.attrJoin("class", `callout ${title.toLowerCase()}`);
    tokens[closeIndex(tokens, index, "blockquote_close")].tag = "aside";
    first.content = match[2] ?? "";
    inline.children = [htmlToken(`<strong>${title}</strong>`), ...(inline.children ?? [])];
  }
}

function htmlToken(content: string): Token {
  const token = new TokenClass("html_inline", "", 0);
  token.content = content;
  return token;
}

function alignCell(token: Token): void {
  const style = String(token.attrGet("style") ?? "");
  token.attrs = (token.attrs ?? []).filter(([name]) => name !== "style");
  const align = style.includes("center") ? "center" : style.includes("right") ? "right" : "left";
  token.attrJoin("class", align);
}

function hideUnsafeLinks(children: Token[]): void {
  const stack: boolean[] = [];

  for (const child of children) {
    if (child.type === "link_open") {
      const href = String(child.attrGet("href") ?? "").trim();
      const unsafe = !safeLinkPattern.test(href);
      stack.push(unsafe);
      if (unsafe) child.hidden = true;
    } else if (child.type === "link_close") {
      if (stack.pop()) child.hidden = true;
    }
  }
}

function renderCodeToken(token: Token): string {
  const language = token.type === "fence" ? (token.info.trim().split(/\s+/)[0] ?? "") : "";
  const languageAttr = language ? ` data-language="${escapeHtml(language)}"` : "";
  const content = escapeHtml(token.content.replace(/\n$/, ""));
  const attrs = attrText(token);
  if (language.toLowerCase() === "mermaid") {
    return mermaidFigureHtml(token.content.replace(/\n$/, ""), attrs);
  }
  const label = escapeHtml(language || "text");
  return `<figure class="code-block"${attrs}><figcaption class="code-toolbar"><span>${label}</span><button type="button" class="copy-code">Copy</button></figcaption><pre><code${languageAttr}>${content}</code></pre></figure>`;
}

function attrText(token: Token): string {
  return (token.attrs ?? []).map(([name, value]) => ` ${name}="${escapeHtml(String(value))}"`).join("");
}

function baseDirOf(env: unknown): string | null {
  const dir = (env as { baseDir?: string | null } | undefined)?.baseDir;
  return typeof dir === "string" ? dir : null;
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

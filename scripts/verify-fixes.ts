import { collectMatches } from "../src/lib/find.ts";
import { isEmbeddablePreviewSrc, previewImageHtml } from "../src/lib/preview-image.ts";
import { parseInline } from "../src/lib/rich-text.ts";
import { markdownToDocx } from "../src/lib/docx.ts";
import { mermaidFigureHtml } from "../src/lib/mermaid.ts";
import { findTableRange, formatTable, splitRow } from "../src/lib/table-edit.ts";
import { backlinksFor, collectWikiLinks, stemOf, wikiAnchorHtml } from "../src/lib/wiki.ts";
import type { ParsedMarkdown } from "../src/lib/markdown.ts";

function assert(ok: unknown, message: string): void {
  if (!ok) throw new Error(message);
}

const orders = collectMatches("Lioncroft OrderWise and order of operations. ORDER.", "order");
assert(orders.length === 3, `expected 3 order matches, got ${orders.length}`);
assert(orders[0]?.from === 10, "first match should be OrderWise");

const none = collectMatches("hello", "   ");
assert(none.length === 0, "blank find query should match nothing");

const blobSrc = "blob:http://tauri.localhost/53ad5bd8-716c-43ed-9255-e2c0ff2eb4e3";
assert(!isEmbeddablePreviewSrc(blobSrc), "blob URLs must not go into innerHTML");

const assetSrc = "http://asset.localhost/C%3A%5CUsers%5CSalil%5CAppData%5CRoaming%5Cfile.png";
assert(!isEmbeddablePreviewSrc(assetSrc), "asset.localhost URLs must not go into innerHTML");
assert(!isEmbeddablePreviewSrc("https://asset.localhost/C:/file.png"), "https asset.localhost must not go into innerHTML");

const blobHtml = previewImageHtml("image", "img/4a9802e1.png", blobSrc);
assert(!blobHtml.includes("blob:"), `blob URL leaked into HTML:\n${blobHtml}`);
assert(!blobHtml.includes("http://tauri.localhost"), `tauri blob host leaked into HTML:\n${blobHtml}`);
assert(!/\ssrc=/.test(blobHtml), `local image HTML must not include src:\n${blobHtml}`);
assert(blobHtml.includes('data-media-ref="img/4a9802e1.png"'), "local images keep a data-media-ref");
assert(blobHtml.startsWith("<img "), "local images should render as img tags");
assert(blobHtml.includes('alt="image"'), "alt text should stay on the tag");

const assetHtml = previewImageHtml("image", "img/4a9802e1.png", assetSrc);
assert(!assetHtml.includes("asset.localhost"), `asset URL leaked into HTML:\n${assetHtml}`);
assert(!/\ssrc=/.test(assetHtml), `asset URL must not be used as src in HTML:\n${assetHtml}`);
assert(assetHtml.includes('data-media-ref="img/4a9802e1.png"'), "asset tags still keep the markdown ref");

const remote = previewImageHtml("Markdown", "https://cdn.jsdelivr.net/logo.svg", "https://cdn.jsdelivr.net/logo.svg");
assert(remote.includes('src="https://cdn.jsdelivr.net/logo.svg"'), "https images pass through");
assert(!remote.includes("data-media-ref"), "remote images do not need a local ref");

const missing = previewImageHtml("image", "https://example.com/missing.png", null);
assert(missing.includes("image-ref"), "unresolved remote images stay as a placeholder");

// Rich-text inline runs keep bold/italic/code/strike distinct.
const runs = parseInline("Hello **bold** and *italic* with `code` and ~~no~~ done");
assert(runs.some((run) => run.text === "bold" && run.bold && !run.italic), "bold run parsed");
assert(runs.some((run) => run.text === "italic" && run.italic && !run.bold), "italic run parsed");
assert(runs.some((run) => run.text === "code" && run.code), "code run parsed");
assert(runs.some((run) => run.text === "no" && run.strike), "strike run parsed");

// DOCX export keeps styles and real tables.
const parsed: ParsedMarkdown = {
  blocks: [
    { type: "heading", startLine: 1, depth: 1, text: "Title" },
    { type: "paragraph", startLine: 3, lines: ["Hello **bold** and *italic*."] },
    { type: "table", startLine: 5, rows: [["A", "B"], ["1", "2"]], aligns: ["left", "left"] },
    { type: "rule", startLine: 8 }
  ],
  diagnostics: [],
  tokens: [],
  lineOffset: 0
};
const docxBytes = new Uint8Array(await markdownToDocx(parsed).arrayBuffer());
const docxText = new TextDecoder().decode(docxBytes);
assert(docxText.includes("<w:tbl>"), "tables export as w:tbl");
assert(docxText.includes("<w:b/>"), "bold survives DOCX export");
assert(docxText.includes("<w:i/>"), "italic survives DOCX export");
assert(!docxText.includes("**"), "no markdown markers leak into DOCX");

// Table helpers find ranges, split escaped pipes, and align columns.
const tableLines = ["Intro", "| Name | Age |", "| --- | ---: |", "| Ada | 36 |"];
assert(findTableRange(tableLines, 1)?.cols === 2, "table range detects 2 columns");
assert(splitRow("| a \\| b | c |")?.length === 2, "escaped pipes stay in one cell");
const formatted = formatTable(["|Name|Age|", "|---|---:|", "|Ada|36|"], 0);
assert(formatted?.text === "| Name | Age |\n|:---|--:|\n| Ada  | 36  |", `table formats pipes:\n${formatted?.text}`);
assert(formatTable(["plain", "text"], 0) === null, "non-table text returns null");

// Mermaid fences render as diagram placeholders for lazy render.
const html = mermaidFigureHtml("graph TD\nA-->B", ' data-line="3"');
assert(html.includes("diagram-mermaid"), "mermaid fence keeps diagram-mermaid class");
assert(html.includes('class="mermaid"'), "mermaid source node lazy-renders on preview");

// Wiki-links collect targets, render anchors, and resolve backlinks.
const wiki = collectWikiLinks("See [[Notes]] and [[Other#Section|alias]] done");
assert(wiki.length === 2, `expected 2 wiki links, got ${wiki.length}`);
assert(wiki[0]?.target === "Notes", "wiki target parsed");
assert(wiki[0]?.from === 4 && wiki[0]?.to === 13, "wiki offsets parsed");
const anchor = wikiAnchorHtml("alias", "Other");
assert(anchor.includes('class="wiki-link"') && anchor.includes('data-wiki="Other"'), "wiki anchor markup");
assert(stemOf("Notes.md") === "Notes", "stem strips extension");
const vault = [
  { name: "Notes.md", path: "/docs/Notes.md" },
  { name: "Other.md", path: "/docs/Other.md" },
  { name: "Third.md", path: "/docs/Third.md" }
];
const reads = new Map([
  ["/docs/Other.md", "links to [[Notes]] here"],
  ["/docs/Third.md", "nothing relevant"]
]);
const backs = backlinksFor(vault, reads, "Notes");
assert(backs.length === 1 && backs[0]?.name === "Other.md", "backlinks resolve");
assert(backlinksFor(vault, reads, "Missing").length === 0, "no backlinks for unknown stem");

// DOCX task items carry checkbox glyphs.
const taskParsed: ParsedMarkdown = {
  blocks: [
    {
      type: "list",
      startLine: 1,
      ordered: false,
      items: ["[ ] open task", "[x] done task"]
    }
  ],
  diagnostics: [],
  tokens: [],
  lineOffset: 0
};
const taskDocx = new TextDecoder().decode(new Uint8Array(await markdownToDocx(taskParsed).arrayBuffer()));
assert(taskDocx.includes("☐ open task"), "unchecked task keeps box glyph");
assert(taskDocx.includes("☒ done task"), "checked task keeps filled box glyph");

console.log("verify-fixes: ok");

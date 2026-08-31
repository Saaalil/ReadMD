import { renderMarkdownImage } from "./media";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPlainText(source: string, baseDir: string | null = null): string {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return '<p class="empty-doc">Empty document</p>';
  }

  return normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => renderTextBlock(block, baseDir))
    .join("\n");
}

function renderTextBlock(block: string, baseDir: string | null): string {
  const lines = block.split("\n");

  if (lines.every((line) => /^\s*([-*]|\d+[.)])\s+/.test(line))) {
    const ordered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
    const tag = ordered ? "ol" : "ul";
    const items = lines
      .map((line) => line.replace(/^\s*([-*]|\d+[.)])\s+/, ""))
      .map((line) => `<li>${formatPlainInline(escapeHtml(line), baseDir)}</li>`)
      .join("");
    return `<${tag}>${items}</${tag}>`;
  }

  if (looksLikePlainTable(lines)) {
    return renderPlainTable(lines, baseDir);
  }

  return `<p>${formatPlainInline(escapeHtml(lines.join(" ")), baseDir)}</p>`;
}

function formatPlainInline(value: string, baseDir: string | null): string {
  const withImages = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, destination: string) =>
    renderMarkdownImage(alt, destination, baseDir)
  );
  return linkify(withImages);
}

function looksLikePlainTable(lines: string[]): boolean {
  return lines.length > 1 && lines.every((line) => line.includes("|")) && lines[0].split("|").length > 1;
}

function renderPlainTable(lines: string[], baseDir: string | null): string {
  const rows = lines.map((line) => line.split("|").map((cell) => cell.trim()));
  const [head = [], ...body] = rows;
  const header = head.map((cell) => `<th>${formatPlainInline(escapeHtml(cell), baseDir)}</th>`).join("");
  const cells = body
    .map((row) => `<tr>${row.map((cell) => `<td>${formatPlainInline(escapeHtml(cell), baseDir)}</td>`).join("")}</tr>`)
    .join("");

  return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${cells}</tbody></table></div>`;
}

function linkify(value: string): string {
  return value.replace(/\bhttps?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
}

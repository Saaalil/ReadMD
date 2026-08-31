function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPlainText(source: string): string {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return '<p class="empty-doc">Empty document</p>';
  }

  return normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(renderTextBlock)
    .join("\n");
}

function renderTextBlock(block: string): string {
  const lines = block.split("\n");

  if (lines.every((line) => /^\s*([-*]|\d+[.)])\s+/.test(line))) {
    const ordered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
    const tag = ordered ? "ol" : "ul";
    const items = lines
      .map((line) => line.replace(/^\s*([-*]|\d+[.)])\s+/, ""))
      .map((line) => `<li>${linkify(escapeHtml(line))}</li>`)
      .join("");
    return `<${tag}>${items}</${tag}>`;
  }

  if (looksLikePlainTable(lines)) {
    return renderPlainTable(lines);
  }

  return `<p>${linkify(escapeHtml(lines.join(" ")))}</p>`;
}

function looksLikePlainTable(lines: string[]): boolean {
  return lines.length > 1 && lines.every((line) => line.includes("|")) && lines[0].split("|").length > 1;
}

function renderPlainTable(lines: string[]): string {
  const rows = lines.map((line) => line.split("|").map((cell) => cell.trim()));
  const [head = [], ...body] = rows;
  const header = head.map((cell) => `<th>${linkify(escapeHtml(cell))}</th>`).join("");
  const cells = body
    .map((row) => `<tr>${row.map((cell) => `<td>${linkify(escapeHtml(cell))}</td>`).join("")}</tr>`)
    .join("");

  return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${cells}</tbody></table></div>`;
}

function linkify(value: string): string {
  return value.replace(/\bhttps?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
}

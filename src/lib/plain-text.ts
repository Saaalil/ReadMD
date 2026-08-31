import type { MarkdownBlock, ParsedMarkdown } from "./markdown";

export function markdownToCleanText(parsed: ParsedMarkdown): string {
  return parsed.blocks
    .filter((block) => block.type !== "frontmatter")
    .map(blockToText)
    .filter(Boolean)
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

function blockToText(block: MarkdownBlock): string {
  switch (block.type) {
    case "heading":
      return stripInline(block.text);
    case "paragraph":
      return stripInline(block.lines.join(" "));
    case "code":
      return block.lines.join("\n");
    case "list":
      return block.items
        .map((item, index) => {
          const task = item.match(/^\[([ xX])\]\s*(.*)$/);
          if (task) {
            const done = task[1].toLowerCase() === "x";
            const text = stripInline(task[2] ?? "");
            return done ? `${text} (done)` : text;
          }
          return `${block.ordered ? `${index + 1}.` : "-"} ${stripInline(item)}`;
        })
        .join("\n");
    case "quote":
      return block.lines.map(stripInline).join("\n");
    case "table":
      return tableToText(block);
    case "html":
      return stripInline(block.lines.join(" "));
    case "rule":
      return "";
    case "frontmatter":
      return "";
  }
}

function tableToText(block: Extract<MarkdownBlock, { type: "table" }>): string {
  if (!block.rows.length) return "";
  const widths = block.rows[0].map((_, columnIndex) =>
    Math.max(...block.rows.map((row) => stripInline(row[columnIndex] ?? "").length))
  );

  return block.rows
    .map((row) =>
      row
        .map((cell, index) => stripInline(cell).padEnd(widths[index] ?? 0, " "))
        .join("  ")
        .trimEnd()
    )
    .join("\n");
}

function stripInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
      const cleanUrl = url.trim();
      return label === cleanUrl ? label : `${label} (${cleanUrl})`;
    })
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\\\((.+?)\\\)/g, "$1")
    .replace(/\$(.+?)\$/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

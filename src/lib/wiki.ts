export interface WikiLink {
  target: string;
  from: number;
  to: number;
}

export interface VaultFile {
  name: string;
  path: string;
}

const WIKI = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

export function collectWikiLinks(source: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of source.matchAll(WIKI)) {
    const start = match.index ?? 0;
    links.push({ target: (match[1] ?? "").trim(), from: start, to: start + match[0].length });
  }
  return links;
}

export function wikiAnchorHtml(display: string, target: string): string {
  return `<a class="wiki-link" data-wiki="${escapeAttr(target)}" href="#">${escapeHtml(display)}</a>`;
}

export function backlinksFor(files: VaultFile[], reads: Map<string, string>, currentStem: string): VaultFile[] {
  const needle = currentStem.toLowerCase();
  if (!needle) return [];
  return files.filter((file) => {
    if (stemOf(file.name).toLowerCase() === needle) return false;
    const text = reads.get(file.path);
    if (text == null) return false;
    return collectWikiLinks(text).some((link) => link.target.toLowerCase() === needle);
  });
}

export function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

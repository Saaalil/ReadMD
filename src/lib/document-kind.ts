export type DocumentKind = "markdown" | "text" | "html";

export function documentKindFromName(name: string): DocumentKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".txt")) return "text";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "markdown";
}

export function displayNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || "Untitled.md";
}

export function dirFromPath(path: string): string | null {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (index <= 0) return null;
  return normalized.slice(0, index);
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;
}

export function kindLabel(kind: DocumentKind): string {
  if (kind === "text") return "Plain text";
  if (kind === "html") return "HTML";
  return "Markdown";
}

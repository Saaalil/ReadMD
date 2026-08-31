import { convertFileSrc } from "@tauri-apps/api/core";
import { joinPath } from "./document-kind";
import { isTauriRuntime, pastedStoreDir, pastedStoreDirSync, readBytes } from "./native";
import { bytesToDataUrl, isPasteRef, pasteRefName } from "./paste-image";
import { isEmbeddablePreviewSrc, previewImageHtml } from "./preview-image";

const blobByRef = new Map<string, string>();
const missByRef = new Set<string>();

export function unescapeBasic(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function splitMarkdownDestination(raw: string): { url: string; title: string } {
  const text = unescapeBasic(raw).trim();
  const titled = text.match(/^(.+?)\s+("([^"]*)"|'([^']*)')\s*$/);
  if (titled) {
    return { url: stripBrackets(titled[1] ?? ""), title: titled[3] ?? titled[4] ?? "" };
  }
  return { url: stripBrackets(text), title: "" };
}

export function cacheMediaBytes(ref: string, bytes: Uint8Array, ext: string): string {
  const key = normalizeRef(ref);
  const previous = blobByRef.get(key);
  if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
  const url = bytesToDataUrl(bytes, mimeFromExt(ext));
  blobByRef.set(key, url);
  for (const missed of [...missByRef]) {
    if (missed.endsWith(`::${key}`)) missByRef.delete(missed);
  }
  return url;
}

export async function hydrateLocalImages(source: string, baseDir: string | null): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await pastedStoreDir();
  } catch {
    return false;
  }

  let changed = false;
  for (const raw of collectLocalMediaRefs(source)) {
    const key = normalizeRef(raw);
    if (blobByRef.has(key)) continue;
    const miss = `${baseDir ?? ""}::${key}`;
    if (missByRef.has(miss)) continue;
    const name = fileNameOf(raw);
    const ext = name?.match(/\.([a-z0-9]+)$/i)?.[1] ?? "png";
    let found = false;
    for (const path of localCandidates(raw, baseDir)) {
      try {
        cacheMediaBytes(raw, await readBytes(path), ext);
        changed = true;
        found = true;
        break;
      } catch {
        // Try the next location (paste cache, then the document img/ folder).
      }
    }
    if (!found) missByRef.add(miss);
  }
  return changed;
}

export function resolveMediaSrc(rawUrl: string, baseDir: string | null, allowBlob = false): string | null {
  const url = stripBrackets(unescapeBasic(rawUrl).trim());
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return null;
  if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)) return url;
  if (/^blob:/i.test(url)) return allowBlob ? url : null;
  if (/^data:/i.test(url)) return null;

  const cached = blobByRef.get(normalizeRef(url));
  if (cached && allowBlob) return cached;

  if (!isTauriRuntime()) return null;

  for (const path of localCandidates(url, baseDir)) {
    try {
      return convertFileSrc(path);
    } catch {
      continue;
    }
  }
  return null;
}

export function applyPreviewMedia(root: ParentNode, baseDir: string | null): void {
  for (const node of root.querySelectorAll("img[data-media-ref]")) {
    if (!(node instanceof HTMLImageElement)) continue;
    const ref = node.getAttribute("data-media-ref");
    if (!ref) continue;
    const src = resolveMediaSrc(ref, baseDir, true);
    if (src) node.src = src;
  }
}

export function renderMarkdownImage(alt: string, destination: string, _baseDir: string | null): string {
  const { url, title } = splitMarkdownDestination(destination);
  const remote = /^https?:\/\//i.test(url) || /^data:image\//i.test(url) ? url : null;
  return previewImageHtml(alt, url, remote, title);
}

export function rewriteHtmlMedia(html: string, _baseDir: string | null): string {
  return html.replace(/<img\b([^>]*?)\bsrc=("[^"]*"|'[^']*')/gi, (full, attrs: string, quoted: string) => {
    const raw = quoted.slice(1, -1);
    if (isEmbeddablePreviewSrc(raw)) return full;
    const ref = ` data-media-ref="${escapeAttr(raw)}"`;
    return `<img${attrs}${ref}`;
  });
}

function collectLocalMediaRefs(source: string): string[] {
  const refs = new Set<string>();
  for (const match of source.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = splitMarkdownDestination(match[1] ?? "").url;
    if (url && isLocalMediaUrl(url)) refs.add(url);
  }
  for (const match of source.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const url = unescapeBasic(match[1] ?? "").trim();
    if (url && isLocalMediaUrl(url)) refs.add(url);
  }
  return [...refs];
}

function isLocalMediaUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (/^(https?:|data:|blob:|javascript:|vbscript:|mailto:|#)/i.test(lower)) return false;
  return Boolean(fileNameOf(url));
}

function localCandidates(url: string, baseDir: string | null): string[] {
  const paths: string[] = [];
  const name = fileNameOf(url);
  const store = pastedStoreDirSync();
  if (store && name) paths.push(joinPath(store, name));
  const beside = toAbsolutePath(url, baseDir);
  if (beside && beside !== paths[0]) paths.push(beside);
  return paths;
}

function fileNameOf(url: string): string | null {
  const paste = pasteRefName(url);
  if (paste) return paste;
  if (isPasteRef(url) || /^img\//i.test(url)) {
    return url.replace(/^img\//i, "").split(/[\\/]/).pop() ?? null;
  }
  const name = url.split(/[\\/]/).pop() ?? "";
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name) ? name : null;
}

function normalizeRef(url: string): string {
  return stripBrackets(unescapeBasic(url).trim()).replace(/\\/g, "/").toLowerCase();
}

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase().replace(/^\./, "")) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    default:
      return "image/png";
  }
}

function stripBrackets(value: string): string {
  return value.replace(/^<|>$/g, "").trim();
}

function toAbsolutePath(src: string, baseDir: string | null): string | null {
  let path = src.replace(/^file:\/\//i, "");
  if (path.startsWith("/") && /^[A-Za-z]:/.test(path.slice(1))) {
    path = path.slice(1);
  }
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")) {
    return path.replace(/\//g, "\\");
  }
  if (!baseDir) return null;
  if (path.startsWith("/") && !/^[A-Za-z]:/.test(baseDir)) return path;

  const sep = baseDir.includes("\\") ? "\\" : "/";
  const stack = baseDir.replace(/[\\/]+$/, "").split(/[\\/]/);
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (/^[A-Za-z]:$/.test(stack[0] ?? "")) {
    return `${stack[0]}\\${stack.slice(1).join("\\")}`;
  }
  return stack.join(sep);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

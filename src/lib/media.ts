import { convertFileSrc } from "@tauri-apps/api/core";
import { joinPath } from "./document-kind";
import { isTauriRuntime, pastedStoreDirSync } from "./native";
import { isPasteRef, pasteRefName } from "./paste-image";

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

export function resolveMediaSrc(rawUrl: string, baseDir: string | null): string | null {
  const url = stripBrackets(unescapeBasic(rawUrl).trim());
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return null;
  if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url) || /^blob:/i.test(url)) return url;
  if (/^data:/i.test(url)) return null;

  if (isPasteRef(url) || /^img\//i.test(url)) {
    const name = pasteRefName(url) ?? url.replace(/^img\//i, "");
    if (baseDir) {
      const local = toAbsolutePath(url, baseDir);
      if (local) {
        try {
          return convertFileSrc(local);
        } catch {
          /* fall through to the paste store */
        }
      }
    }
    const store = pastedStoreDirSync();
    if (store && name && isTauriRuntime()) {
      try {
        return convertFileSrc(joinPath(store, name));
      } catch {
        return null;
      }
    }
    return null;
  }

  const absolute = toAbsolutePath(url, baseDir);
  if (!absolute || !isTauriRuntime()) return null;
  try {
    return convertFileSrc(absolute);
  } catch {
    return null;
  }
}

export function renderMarkdownImage(alt: string, destination: string, baseDir: string | null): string {
  const { url, title } = splitMarkdownDestination(destination);
  const src = resolveMediaSrc(url, baseDir);
  if (!src) {
    return `<span class="image-ref">${alt || escapeAttr(url)}</span>`;
  }
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  return `<img class="md-image" src="${escapeAttr(src)}" alt="${alt}"${titleAttr} loading="lazy">`;
}

export function rewriteHtmlMedia(html: string, baseDir: string | null): string {
  return html.replace(/<img\b([^>]*?)\bsrc=("[^"]*"|'[^']*')/gi, (full, attrs: string, quoted: string) => {
    const raw = quoted.slice(1, -1);
    const resolved = resolveMediaSrc(raw, baseDir);
    if (!resolved || resolved === raw) return full;
    return `<img${attrs}src="${escapeAttr(resolved)}"`;
  });
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

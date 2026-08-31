import { dirFromPath, joinPath } from "./document-kind";
import { copyDiskFile, isTauriRuntime, pastedStoreDir, writeBytes } from "./native";

export const IMAGE_PATH = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
export const PASTE_REF = /^img\/([a-z0-9]{8}\.(?:png|jpe?g|gif|webp|bmp|svg|avif))$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_PATH.test(path);
}

export function isPasteRef(url: string): boolean {
  return PASTE_REF.test(url.trim());
}

export function pasteRefName(url: string): string | null {
  return url.trim().match(PASTE_REF)?.[1] ?? null;
}

export function imageFileFromClipboard(event: ClipboardEvent): File | null {
  const data = event.clipboardData;
  if (!data) return null;
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of data.files) {
    if (file.type.startsWith("image/") || IMAGE_PATH.test(file.name)) return file;
  }
  return null;
}

export function extensionForImage(file: { type: string; name?: string }): string {
  const named = file.name?.match(IMAGE_PATH)?.[1]?.toLowerCase();
  if (named) return named === "jpeg" ? "jpg" : named;
  return mimeToExt(file.type);
}

export function extensionFromPath(path: string): string {
  const match = path.match(IMAGE_PATH);
  const ext = match?.[1]?.toLowerCase() ?? "png";
  return ext === "jpeg" ? "jpg" : ext;
}

export function shortPasteName(ext: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const id = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${id}.${ext === "jpeg" ? "jpg" : ext}`;
}

export function shortPasteRef(name: string): string {
  return `img/${name}`;
}

export function docImageDir(docPath: string): string | null {
  const folder = dirFromPath(docPath);
  return folder ? joinPath(folder, "img") : null;
}

export function markdownImage(alt: string, src: string): string {
  const safeAlt = alt.replace(/[[\]]/g, "");
  return `![${safeAlt}](${src.replace(/\\/g, "/")})`;
}

export function htmlImage(alt: string, src: string): string {
  const safe = src.replace(/\\/g, "/").replace(/"/g, "&quot;");
  const safeAlt = alt.replace(/"/g, "&quot;");
  return `<img src="${safe}" alt="${safeAlt}">`;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const type = mime.startsWith("image/") ? mime : "image/png";
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

export async function storePastedImage(bytes: Uint8Array, ext: string, docPath: string | null): Promise<string> {
  const name = shortPasteName(ext);
  const ref = shortPasteRef(name);
  if (!isTauriRuntime()) return bytesToDataUrl(bytes, `image/${ext}`);

  const store = await pastedStoreDir();
  await writeBytes(joinPath(store, name), bytes);
  const beside = docPath ? docImageDir(docPath) : null;
  if (beside) await writeBytes(joinPath(beside, name), bytes);
  return ref;
}

export async function storePastedFile(from: string, ext: string, docPath: string | null): Promise<string> {
  const name = shortPasteName(ext);
  const ref = shortPasteRef(name);
  const store = await pastedStoreDir();
  await copyDiskFile(from, joinPath(store, name));
  const beside = docPath ? docImageDir(docPath) : null;
  if (beside) await copyDiskFile(from, joinPath(beside, name));
  return ref;
}

export async function materializeEmbeddedImages(source: string, docPath: string | null): Promise<string> {
  if (!isTauriRuntime()) return source;
  const store = await pastedStoreDir();
  const beside = docPath ? docImageDir(docPath) : null;
  let next = source;

  next = await replaceMatches(next, /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+)\)/gi, async (full, alt, dataUrl) => {
    const stored = await persistDataUrl(dataUrl, store, beside);
    return stored ? markdownImage(alt ?? "image", stored) : full;
  });

  next = await replaceMatches(next, /<img\b([^>]*?)\bsrc=("data:image\/[^"]+"|'data:image\/[^']+')/gi, async (full, attrs, quoted) => {
    const dataUrl = quoted.slice(1, -1);
    const stored = await persistDataUrl(dataUrl, store, beside);
    return stored ? `<img${attrs}src="${stored}"` : full;
  });

  if (beside) {
    const names = new Set<string>();
    for (const match of next.matchAll(/!\[[^\]]*\]\((img\/[a-z0-9]{8}\.[a-z0-9]+)\)/gi)) {
      const name = pasteRefName(match[1] ?? "");
      if (name) names.add(name);
    }
    for (const match of next.matchAll(/<img\b[^>]*\bsrc=["'](img\/[a-z0-9]{8}\.[a-z0-9]+)["']/gi)) {
      const name = pasteRefName(match[1] ?? "");
      if (name) names.add(name);
    }
    for (const name of names) {
      try {
        await copyDiskFile(joinPath(store, name), joinPath(beside, name));
      } catch {
        // Already next to the document, or the cache file was cleaned up.
      }
    }
  }

  return next;
}

function mimeToExt(mime: string): string {
  switch (mime.toLowerCase().replace("image/", "")) {
    case "jpeg":
    case "jpg":
      return "jpg";
    case "gif":
      return "gif";
    case "webp":
      return "webp";
    case "svg+xml":
    case "svg":
      return "svg";
    case "bmp":
      return "bmp";
    case "avif":
      return "avif";
    default:
      return "png";
  }
}

function dataUrlToBytes(url: string): { bytes: Uint8Array; ext: string } | null {
  const match = url.trim().match(/^data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  try {
    const binary = atob(match[2] ?? "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { bytes, ext: mimeToExt(match[1] ?? "png") };
  } catch {
    return null;
  }
}

async function persistDataUrl(dataUrl: string, store: string, beside: string | null): Promise<string | null> {
  const decoded = dataUrlToBytes(dataUrl);
  if (!decoded) return null;
  const name = shortPasteName(decoded.ext);
  await writeBytes(joinPath(store, name), decoded.bytes);
  if (beside) await writeBytes(joinPath(beside, name), decoded.bytes);
  return shortPasteRef(name);
}

async function replaceMatches(
  source: string,
  pattern: RegExp,
  replace: (...args: string[]) => Promise<string>
): Promise<string> {
  const matches = [...source.matchAll(pattern)];
  if (matches.length === 0) return source;
  let next = source;
  for (const match of matches) {
    const full = match[0];
    if (!full || !next.includes(full)) continue;
    const replacement = await replace(full, ...(match.slice(1) as string[]));
    next = next.replace(full, replacement);
  }
  return next;
}

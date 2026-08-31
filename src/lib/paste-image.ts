import { dirFromPath, displayNameFromPath, joinPath } from "./document-kind";

export const IMAGE_PATH = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_PATH.test(path);
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
  switch (file.type) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/bmp":
      return "bmp";
    case "image/avif":
      return "avif";
    default:
      return "png";
  }
}

export function extensionFromPath(path: string): string {
  const match = path.match(IMAGE_PATH);
  const ext = match?.[1]?.toLowerCase() ?? "png";
  return ext === "jpeg" ? "jpg" : ext;
}

export function pastedImageName(ext: string): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `pasted-${stamp}.${ext}`;
}

export function assetsFolderFor(docPath: string): string | null {
  const folder = dirFromPath(docPath);
  if (!folder) return null;
  const stem = displayNameFromPath(docPath).replace(/\.[^.]+$/, "") || "untitled";
  return joinPath(folder, `${stem}-assets`);
}

export function relativeMarkdownPath(fromDir: string, filePath: string): string {
  const from = fromDir.replace(/[\\/]+$/, "").split(/[\\/]/);
  const to = filePath.split(/[\\/]/);
  let index = 0;
  while (index < from.length && index < to.length && from[index]?.toLowerCase() === to[index]?.toLowerCase()) {
    index += 1;
  }
  const rel = [...Array.from({ length: from.length - index }, () => ".."), ...to.slice(index)].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
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

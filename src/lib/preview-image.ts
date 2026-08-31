export function isEmbeddablePreviewSrc(src: string): boolean {
  return Boolean(src) && !/^blob:/i.test(src);
}

export function previewImageHtml(alt: string, url: string, src: string | null, title = ""): string {
  const safeAlt = escapeAttr(alt);
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  const local = isLocalMediaRef(url);
  const embed = src && isEmbeddablePreviewSrc(src) ? src : null;
  const refAttr = local ? ` data-media-ref="${escapeAttr(url)}"` : "";
  if (!embed && !local) {
    return `<span class="image-ref">${safeAlt || escapeAttr(url)}</span>`;
  }
  const srcAttr = embed ? ` src="${escapeAttr(embed)}"` : "";
  return `<img class="md-image"${srcAttr}${refAttr} alt="${safeAlt}"${titleAttr} loading="lazy">`;
}

export function isLocalMediaRef(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^(https?:|data:|blob:|javascript:|vbscript:|mailto:|#)/i.test(trimmed)) return false;
  return /^(img\/|\.{0,2}\/|[A-Za-z]:[\\/]|\\\\)/i.test(trimmed) || /\.(png|jpe?g|gif|webp|bmp|svg|avif)(?:$|[?#])/i.test(trimmed);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

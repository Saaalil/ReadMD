export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function withExtension(name: string, extension: string): string {
  const clean = name.replace(/\.[^.]+$/, "");
  return `${clean}.${extension}`;
}

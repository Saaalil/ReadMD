export interface LinePos {
  line: number;
  ratio: number;
}

export interface LineAnchor {
  line: number;
  top: number;
}

export function anchorsFromPreview(root: HTMLElement): LineAnchor[] {
  const rootBox = root.getBoundingClientRect();
  return [...root.querySelectorAll<HTMLElement>("[data-line]")]
    .map((el) => ({
      line: Number(el.dataset.line),
      top: el.getBoundingClientRect().top - rootBox.top + root.scrollTop
    }))
    .filter((item) => Number.isFinite(item.line) && item.line > 0)
    .sort((a, b) => a.line - b.line || a.top - b.top);
}

export function scrollRootToLine(root: HTMLElement, pos: LinePos, padding: number): void {
  const max = Math.max(0, root.scrollHeight - root.clientHeight);
  if (max <= 0) return;
  const anchors = anchorsFromPreview(root);
  if (anchors.length === 0) {
    root.scrollTop = pos.ratio * max;
    return;
  }
  root.scrollTop = clamp(lineToOffset(anchors, pos) - padding, 0, max);
}

export function lineAtRoot(root: HTMLElement, padding: number): LinePos {
  const max = Math.max(0, root.scrollHeight - root.clientHeight);
  const anchors = anchorsFromPreview(root);
  if (anchors.length === 0) {
    return { line: 1, ratio: max > 0 ? root.scrollTop / max : 0 };
  }
  return offsetToLine(anchors, root.scrollTop + padding);
}

function lineToOffset(anchors: LineAnchor[], pos: LinePos): number {
  const point = pos.line + pos.ratio;
  if (point <= anchors[0]!.line) return anchors[0]!.top;
  const last = anchors[anchors.length - 1]!;
  if (point >= last.line) return last.top;

  let index = 0;
  while (index + 1 < anchors.length && anchors[index + 1]!.line <= point) {
    index += 1;
  }
  const current = anchors[index]!;
  const next = anchors[index + 1];
  if (!next || next.line === current.line) return current.top;
  const t = (point - current.line) / (next.line - current.line);
  return current.top + (next.top - current.top) * t;
}

function offsetToLine(anchors: LineAnchor[], offset: number): LinePos {
  if (offset <= anchors[0]!.top) return { line: anchors[0]!.line, ratio: 0 };
  const last = anchors[anchors.length - 1]!;
  if (offset >= last.top) return { line: last.line, ratio: 0 };

  let index = 0;
  while (index + 1 < anchors.length && anchors[index + 1]!.top <= offset) {
    index += 1;
  }
  const current = anchors[index]!;
  const next = anchors[index + 1];
  if (!next || next.top === current.top) return { line: current.line, ratio: 0 };
  const t = (offset - current.top) / (next.top - current.top);
  const span = Math.max(1, next.line - current.line);
  return { line: current.line, ratio: t * span };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

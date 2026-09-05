import type { EditorState, StateCommand, TransactionSpec } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

export interface RowCell {
  text: string;
  from: number;
  to: number;
}

export interface TableRange {
  start: number;
  end: number;
  cols: number;
}

export function splitRow(line: string): RowCell[] | null {
  if (!/^\s*\|/.test(line) || !/\|\s*$/.test(line)) return null;
  const pipes: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }
    if (line[index] === "|") pipes.push(index);
  }
  if (pipes.length < 2) return null;
  const cells: RowCell[] = [];
  for (let index = 0; index + 1 < pipes.length; index += 1) {
    cells.push({ text: line.slice(pipes[index]! + 1, pipes[index + 1]), from: pipes[index]! + 1, to: pipes[index + 1]! });
  }
  return cells;
}

export function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line);
  if (!cells || cells.length === 0) return false;
  return cells.every((cell) => /^\s*:?-{1,}:?\s*$/.test(cell.text));
}

export function findTableRange(lines: string[], row: number): TableRange | null {
  if (!splitRow(lines[row] ?? "")) return null;
  let start = row;
  while (start - 1 >= 0 && splitRow(lines[start - 1] ?? "")) start -= 1;
  let end = row;
  while (end + 1 < lines.length && splitRow(lines[end + 1] ?? "")) end += 1;
  if (end - start < 1) return null;
  const delimiter = lines.slice(start, end + 1).find(isDelimiterRow);
  const cols = splitRow(delimiter ?? lines[start] ?? "")?.length ?? 0;
  if (cols < 1) return null;
  return { start, end, cols };
}

export function formatTable(lines: string[], row: number): { start: number; end: number; text: string } | null {
  const range = findTableRange(lines, row);
  if (!range) return null;
  const grid = lines.slice(range.start, range.end + 1).map((line) => splitRow(line)?.map((cell) => cell.text.trim()) ?? []);
  const widths: number[] = [];
  for (const cells of grid) {
    cells.forEach((cell, index) => {
      if (!isDelimiterCell(cell)) widths[index] = Math.max(widths[index] ?? 3, cell.length);
    });
  }
  const delimiterIndex = grid.findIndex((cells) => cells.every(isDelimiterCell));
  const aligns = grid[delimiterIndex]?.map((cell) => delimiterAlign(cell)) ?? [];
  const out = grid.map((cells, rowIndex) => {
    const padded = cells.map((cell, index) => {
      const width = widths[index] ?? 3;
      if (rowIndex === delimiterIndex) return delimiterCell(aligns[index] ?? "left", width);
      return ` ${cell.padEnd(width, " ")} `;
    });
    while (padded.length < (widths.length || 0)) padded.push(` ${" ".repeat(widths[padded.length] ?? 3)} `);
    return `|${padded.join("|")}|`;
  });
  return { start: range.start, end: range.end, text: out.join("\n") };
}

function isDelimiterCell(cell: string): boolean {
  return /^\s*:?-{1,}:?\s*$/.test(cell);
}

function delimiterAlign(cell: string): "left" | "center" | "right" {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return "left";
}

function delimiterCell(align: "left" | "center" | "right", width: number): string {
  const dashes = "-".repeat(Math.max(1, width - (align === "center" ? 2 : 1)));
  if (align === "center") return `:${dashes}:`;
  if (align === "right") return `${dashes}:`;
  return `:${dashes}`;
}

function cellCursor(line: string, cell: RowCell): number {
  const inner = line.slice(cell.from, cell.to);
  const trailingOnly = /^\s*$/.test(inner);
  if (trailingOnly) return cell.from + Math.min(1, inner.length);
  const lead = inner.match(/^\s*/)![0].length;
  const trimmedEnd = inner.replace(/\s+$/, "").length;
  return cell.from + Math.min(lead + 1, trimmedEnd, Math.max(0, inner.length - 1));
}

function cursorSpec(state: EditorState, lineNumber: number, ch: number): TransactionSpec {
  const line = state.doc.line(lineNumber);
  const pos = line.from + Math.max(0, Math.min(ch, line.length));
  return { selection: { anchor: pos }, scrollIntoView: true };
}

function moveToCell(state: EditorState, lineNumber: number, cellIndex: number): TransactionSpec | null {
  const line = state.doc.line(lineNumber);
  const cells = splitRow(line.text);
  if (!cells || isDelimiterRow(line.text)) return null;
  const cell = cells[Math.max(0, Math.min(cellIndex, cells.length - 1))];
  if (!cell) return null;
  return cursorSpec(state, lineNumber, cellCursor(line.text, cell));
}

function nextDataRow(lines: string[], range: TableRange, row: number, direction: 1 | -1): number | null {
  let next = row + direction;
  while (next >= range.start && next <= range.end) {
    if (!isDelimiterRow(lines[next] ?? "")) return next;
    next += direction;
  }
  return null;
}

function buildRow(cols: number): string {
  return `|${" |".repeat(cols)}`;
}

const gotoNextCell: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const row = state.doc.lineAt(pos);
  const lines = state.doc.toString().split("\n");
  const rowNumber = row.number - 1;
  const range = findTableRange(lines, rowNumber);
  const cells = splitRow(row.text);
  if (!range || !cells || isDelimiterRow(row.text)) return false;
  const rel = pos - row.from;
  const index = cells.findIndex((cell) => rel < cell.to);
  const current = index === -1 ? cells.length - 1 : index;
  if (current < cells.length - 1) {
    const spec = moveToCell(state, row.number, current + 1);
    if (spec) dispatch(state.update(spec));
    return true;
  }
  const next = nextDataRow(lines, range, rowNumber, 1);
  if (next != null) {
    const spec = moveToCell(state, next + 1, 0);
    if (spec) dispatch(state.update(spec));
    return true;
  }
  const insert = `\n${buildRow(range.cols)}`;
  const at = row.to;
  dispatch(
    state.update({
      changes: { from: at, to: at, insert },
      selection: { anchor: at + insert.length - range.cols },
      scrollIntoView: true
    })
  );
  return true;
};

const gotoPrevCell: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const row = state.doc.lineAt(pos);
  const lines = state.doc.toString().split("\n");
  const rowNumber = row.number - 1;
  const range = findTableRange(lines, rowNumber);
  const cells = splitRow(row.text);
  if (!range || !cells || isDelimiterRow(row.text)) return false;
  const rel = pos - row.from;
  let current = -1;
  cells.forEach((cell, index) => {
    if (cell.from - 1 <= rel) current = index;
  });
  if (current > 0) {
    const spec = moveToCell(state, row.number, current - 1);
    if (spec) dispatch(state.update(spec));
    return true;
  }
  const prev = nextDataRow(lines, range, rowNumber, -1);
  if (prev == null) return false;
  const prevCells = splitRow(lines[prev] ?? "")?.length ?? 1;
  const spec = moveToCell(state, prev + 1, prevCells - 1);
  if (spec) dispatch(state.update(spec));
  return true;
};

const enterNextRow: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const row = state.doc.lineAt(pos);
  const lines = state.doc.toString().split("\n");
  const rowNumber = row.number - 1;
  const range = findTableRange(lines, rowNumber);
  const cells = splitRow(row.text);
  if (!range || !cells || isDelimiterRow(row.text)) return false;
  if (cells.every((cell) => cell.text.trim().length === 0)) {
    dispatch(
      state.update({
        changes: { from: row.to, to: row.to, insert: "\n" },
        selection: { anchor: row.to + 1 },
        scrollIntoView: true
      })
    );
    return true;
  }
  const next = nextDataRow(lines, range, rowNumber, 1);
  if (next != null) {
    const spec = moveToCell(state, next + 1, 0);
    if (spec) dispatch(state.update(spec));
    return true;
  }
  const insert = `\n${buildRow(range.cols)}`;
  const at = state.doc.line(range.end + 1).to;
  dispatch(
    state.update({
      changes: { from: at, to: at, insert },
      selection: { anchor: at + insert.length - range.cols },
      scrollIntoView: true
    })
  );
  return true;
};

export const formatTableCommand: StateCommand = ({ state, dispatch }) => {
  const pos = state.selection.main.head;
  const row = state.doc.lineAt(pos);
  const lines = state.doc.toString().split("\n");
  const formatted = formatTable(lines, row.number - 1);
  if (!formatted) return false;
  dispatch(
    state.update({
      changes: {
        from: state.doc.line(formatted.start + 1).from,
        to: state.doc.line(formatted.end + 1).to,
        insert: formatted.text
      }
    })
  );
  return true;
};

export const tableKeymap: readonly KeyBinding[] = [
  { key: "Tab", run: gotoNextCell, shift: gotoPrevCell },
  { key: "Enter", run: enterNextRow },
  { key: "Mod-Shift-t", run: formatTableCommand }
];

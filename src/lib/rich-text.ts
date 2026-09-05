export interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  strike: boolean;
}

const TOKEN = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;

export function parseInline(source: string): InlineRun[] {
  const plain = source
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "");
  const runs: InlineRun[] = [];
  let last = 0;
  for (const match of plain.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) runs.push(textRun(plain.slice(last, index)));
    runs.push(tokenRun(match[0]));
    last = index + match[0].length;
  }
  if (last < plain.length) runs.push(textRun(plain.slice(last)));
  return runs.filter((run) => run.text.length > 0);
}

function textRun(text: string): InlineRun {
  return { text, bold: false, italic: false, code: false, strike: false };
}

function tokenRun(token: string): InlineRun {
  if (token.startsWith("`")) return { text: token.slice(1, -1), bold: false, italic: false, code: true, strike: false };
  if (token.startsWith("**") || token.startsWith("__")) {
    return { text: token.slice(2, -2), bold: true, italic: false, code: false, strike: false };
  }
  if (token.startsWith("~~")) return { text: token.slice(2, -2), bold: false, italic: false, code: false, strike: true };
  return { text: token.slice(1, -1), bold: false, italic: true, code: false, strike: false };
}

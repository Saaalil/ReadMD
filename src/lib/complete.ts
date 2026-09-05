import { autocompletion, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorView, keymap } from "@codemirror/view";

interface Snippet {
  label: string;
  detail: string;
  insert: string;
  cursorBack?: number;
}

const SNIPPETS: Snippet[] = [
  { label: "Heading 1", detail: "#", insert: "# " },
  { label: "Heading 2", detail: "##", insert: "## " },
  { label: "Heading 3", detail: "###", insert: "### " },
  { label: "Bullet list", detail: "- item", insert: "- " },
  { label: "Numbered list", detail: "1. item", insert: "1. " },
  { label: "Task item", detail: "- [ ]", insert: "- [ ] " },
  { label: "Code fence", detail: "```", insert: "```\n\n```", cursorBack: 4 },
  { label: "Table 2x2", detail: "| | |", insert: "|  |  |\n| --- | --- |\n|  |  |" },
  { label: "Link", detail: "[text](url)", insert: "[](https://)", cursorBack: 11 },
  { label: "Image", detail: "![alt](src)", insert: "![](img/)", cursorBack: 1 },
  { label: "Quote", detail: "> quote", insert: "> " },
  { label: "Callout", detail: "> [!NOTE]", insert: "> [!NOTE]\n> " },
  { label: "Rule", detail: "---", insert: "\n---\n" },
  { label: "Footnote", detail: "[^1]", insert: "[^1]\n\n[^1]: " }
];

const STOPWORDS = new Set(
  "the and for with that this from have are was were will would there their what when which while your you our out about into over after also just can had has not but all any each she him her its than then them these those".split(" ")
);

function snippetOptions(query: string): Completion[] {
  const needle = query.toLowerCase();
  return SNIPPETS.filter((snippet) => snippet.label.toLowerCase().includes(needle)).map((snippet) => ({
    label: snippet.label,
    detail: snippet.detail,
    type: "snippet",
    boost: 2,
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      view.dispatch({
        changes: { from, to, insert: snippet.insert },
        selection: {
          anchor:
            snippet.cursorBack != null ? from + snippet.insert.length - snippet.cursorBack : from + snippet.insert.length
        }
      });
    }
  }));
}

function docWordOptions(state: { doc: { toString(): string } }, typed: string): Completion[] {
  const text = state.doc
    .toString()
    .slice(0, 20000)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  const counts = new Map<string, number>();
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9-]{3,}/g)) {
    const word = match[0].toLowerCase();
    if (word !== typed && !STOPWORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => ({ label: word, type: "text", boost: -1 }));
}

function markdownCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const slash = before.match(/(^|\s)\/(\w*)$/);
  if (slash) {
    const from = line.from + before.length - slash[0].length + slash[1].length;
    return { from, to: context.pos, options: snippetOptions(slash[2] ?? ""), filter: false };
  }
  const word = context.matchBefore(/[\w-]{2,}$/);
  if (!word || word.from === word.to) return null;
  const typed = word.text.toLowerCase();
  const options = docWordOptions(context.state, typed).filter((option) => option.label.startsWith(typed));
  if (options.length === 0) return null;
  return { from: word.from, to: word.to, options, filter: false };
}

const completionTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--bg-raised)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    overflow: "hidden"
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "240px"
  },
  ".cm-completionLabel": {
    color: "var(--text)"
  },
  ".cm-completionDetail": {
    color: "var(--muted)",
    fontStyle: "normal"
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--bg-hover)",
    color: "var(--text)"
  }
});

export function completionExtension() {
  return [autocompletion({ override: [markdownCompletion] }), keymap.of(completionKeymap), completionTheme];
}

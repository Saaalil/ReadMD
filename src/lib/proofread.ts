import { invoke } from "@tauri-apps/api/core";
import { linter, type Diagnostic } from "@codemirror/lint";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isTauriRuntime } from "./native";

export interface ProofreadLint {
  from: number;
  to: number;
  message: string;
  suggestions: string[];
}

const MAX_CHARS = 60_000;

async function fetchLints(view: EditorView): Promise<Diagnostic[]> {
  const text = view.state.doc.toString();
  if (!isTauriRuntime() || text.length > MAX_CHARS) return [];
  if (text.trim().length < 20) return [];
  let lints: ProofreadLint[];
  try {
    lints = await invoke<ProofreadLint[]>("proofread", { text: text.slice(0, MAX_CHARS) });
  } catch {
    return [];
  }
  return lints.slice(0, 100).flatMap((lint) => {
    const { from, to } = lint;
    if (!(to > from) || to > text.length) return [];
    const actions = lint.suggestions.slice(0, 3).map((suggestion) => ({
      name: `Use “${suggestion}”`,
      apply: (view: EditorView, a: number, b: number) => {
        view.dispatch({ changes: { from: a, to: b, insert: suggestion } });
      }
    }));
    return [
      {
        from,
        to,
        severity: "warning",
        message: lint.message,
        ...(actions.length > 0 ? { actions } : {})
      } satisfies Diagnostic
    ];
  });
}

export const proofreadComp = new Compartment();

export function proofreadExtension(enabled: boolean): Extension {
  const source = linter(fetchLints, { delay: 900 });
  const underline = EditorView.theme({
    ".cm-lintRange-warning": {
      backgroundImage: "none",
      borderBottom: "1px dotted var(--muted)"
    }
  });
  return enabled ? [source, underline] : [];
}

<script lang="ts">
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { html as htmlLanguage } from "@codemirror/lang-html";
  import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
  import { bracketMatching, defaultHighlightStyle, foldGutter, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { searchKeymap } from "@codemirror/search";
  import { Compartment, EditorState } from "@codemirror/state";
  import {
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
    rectangularSelection
  } from "@codemirror/view";
  import { tags as t } from "@lezer/highlight";
  import { onDestroy, onMount } from "svelte";

  interface Props {
    value: string;
    appearance: "dark" | "light";
    language: "markdown" | "html" | "text";
    onChange: (value: string) => void;
  }

  let { value, appearance, language, onChange }: Props = $props();
  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let internalUpdate = false;
  const themeComp = new Compartment();
  const langComp = new Compartment();

  const darkHighlight = HighlightStyle.define([
    { tag: t.heading, color: "#f3f1ec", fontWeight: "700" },
    { tag: t.strong, color: "#f3f1ec", fontWeight: "700" },
    { tag: t.emphasis, color: "#d8d4cc", fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through", color: "#9a958c" },
    { tag: t.link, color: "#8eb4e8" },
    { tag: t.url, color: "#7a9cc6" },
    { tag: t.monospace, color: "#e2c48a" },
    { tag: t.comment, color: "#8d887e" },
    { tag: t.keyword, color: "#c9a6e0" },
    { tag: t.string, color: "#b4c99a" },
    { tag: t.processingInstruction, color: "#7a9cc6" },
    { tag: t.meta, color: "#8d887e" },
    { tag: t.atom, color: "#8eb4e8" },
    { tag: t.number, color: "#d4a574" },
    { tag: t.tagName, color: "#8eb4e8" },
    { tag: t.attributeName, color: "#d4a574" },
    { tag: t.angleBracket, color: "#9a958c" }
  ]);

  function chromeTheme(dark: boolean) {
    return EditorView.theme(
      {
        "&": {
          height: "100%",
          color: "var(--text)",
          backgroundColor: "transparent",
          fontSize: "14px"
        },
        ".cm-scroller": {
          fontFamily: '"Cascadia Code", Consolas, "Segoe UI Mono", monospace',
          lineHeight: "1.7"
        },
        ".cm-content": {
          padding: "36px clamp(24px, 4vw, 64px) 72px",
          caretColor: "var(--text)"
        },
        ".cm-line": {
          padding: "0 2px"
        },
        ".cm-gutters": {
          color: "var(--muted)",
          backgroundColor: "transparent",
          borderRight: "0",
          paddingLeft: "10px"
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "var(--editor-active-line)"
        },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "var(--selection)"
        },
        "&.cm-focused": {
          outline: "none"
        },
        ".cm-foldGutter span": {
          padding: "0 4px"
        },
        ".cm-cursor": {
          borderLeftColor: "var(--text)"
        }
      },
      { dark }
    );
  }

  function themeExtensions(dark: boolean) {
    return [chromeTheme(dark), syntaxHighlighting(dark ? darkHighlight : defaultHighlightStyle, { fallback: true })];
  }

  function languageExtension(next: Props["language"]) {
    return next === "html" ? htmlLanguage() : markdownLanguage();
  }

  export function getContent(): string {
    return view?.state.doc.toString() ?? value;
  }

  export function setContent(text: string): void {
    if (!view) return;
    if (text === view.state.doc.toString()) return;
    internalUpdate = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text }
    });
    internalUpdate = false;
  }

  export function revealRange(from: number, to: number): void {
    if (!view) return;
    const size = view.state.doc.length;
    const start = Math.max(0, Math.min(from, size));
    const end = Math.max(0, Math.min(to, size));
    view.dispatch({
      selection: { anchor: start, head: end },
      scrollIntoView: true
    });
    view.focus();
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          foldGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          bracketMatching(),
          langComp.of(languageExtension(language)),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          themeComp.of(themeExtensions(appearance === "dark")),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || internalUpdate) return;
            onChange(update.state.doc.toString());
          })
        ]
      })
    });
  });

  $effect(() => {
    view?.dispatch({
      effects: themeComp.reconfigure(themeExtensions(appearance === "dark"))
    });
  });

  $effect(() => {
    view?.dispatch({
      effects: langComp.reconfigure(languageExtension(language))
    });
  });

  onDestroy(() => {
    view?.destroy();
  });
</script>

<div bind:this={host} class="code-editor" aria-label="Document editor"></div>

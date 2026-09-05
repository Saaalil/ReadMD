<script lang="ts">
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { html as htmlLanguage } from "@codemirror/lang-html";
  import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
  import { bracketMatching, defaultHighlightStyle, foldGutter, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
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
  import { vim } from "@replit/codemirror-vim";
  import { completionExtension } from "./complete";
  import { proofreadComp, proofreadExtension } from "./proofread";
  import { tableKeymap } from "./table-edit";
  import { onDestroy, onMount } from "svelte";

  interface Props {
    value: string;
    appearance: "dark" | "light";
    language: "markdown" | "html" | "text";
    proofreadOn: boolean;
    vimOn: boolean;
    typewriterOn: boolean;
    focusOn: boolean;
    onChange: (value: string) => void;
    onScroll?: () => void;
  }

  let { value, appearance, language, proofreadOn, vimOn, typewriterOn, focusOn, onChange, onScroll }: Props = $props();
  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let internalUpdate = false;
  const themeComp = new Compartment();
  const langComp = new Compartment();
  const vimComp = new Compartment();
  const modeComp = new Compartment();

  function typewriterExtension(enabled: boolean) {
    if (!enabled) return [];
    return EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const head = update.state.selection.main.head;
      requestAnimationFrame(() => {
        view?.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
      });
    });
  }

  function focusTheme(enabled: boolean) {
    return EditorView.theme(
      enabled
        ? {
            ".cm-line:not(.cm-activeLine)": { opacity: "0.4" },
            ".cm-activeLine": { opacity: "1" }
          }
        : {}
    );
  }

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

  export function revealRange(from: number, to: number, focus = false): void {
    if (!view) return;
    const size = view.state.doc.length;
    const start = Math.max(0, Math.min(from, size));
    const end = Math.max(start, Math.min(to, size));
    view.dispatch({
      selection: { anchor: start, head: end },
      scrollIntoView: true
    });
    if (focus) view.focus();
  }

  export function replaceRange(from: number, to: number, text: string): void {
    if (!view) return;
    const size = view.state.doc.length;
    const start = Math.max(0, Math.min(from, size));
    const end = Math.max(start, Math.min(to, size));
    view.dispatch({
      changes: { from: start, to: end, insert: text },
      selection: { anchor: start + text.length }
    });
  }

  export function replaceRanges(ranges: Array<{ from: number; to: number }>, text: string): void {
    if (!view || ranges.length === 0) return;
    const changes = [...ranges]
      .sort((a, b) => b.from - a.from)
      .map((range) => ({ from: range.from, to: range.to, insert: text }));
    view.dispatch({ changes });
  }

  export function insertAtCursor(text: string): void {
    if (!view) return;
    const range = view.state.selection.main;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length },
      scrollIntoView: true
    });
    view.focus();
  }

  export function getScrollLine(): { line: number; ratio: number } {
    if (!view) return { line: 1, ratio: 0 };
    const scroller = view.scrollDOM;
    const y = scroller.scrollTop;
    const block = view.lineBlockAtHeight(y);
    const line = view.state.doc.lineAt(block.from).number;
    const height = Math.max(1, block.bottom - block.top);
    return { line, ratio: (y - block.top) / height };
  }

  export function scrollToLine(line: number, ratio: number): void {
    if (!view) return;
    const target = Math.max(1, Math.min(line, view.state.doc.lines));
    const pos = view.state.doc.line(target).from;
    const block = view.lineBlockAt(pos);
    view.scrollDOM.scrollTop = block.top + Math.max(0, block.bottom - block.top) * ratio;
  }

  function handleScroll(): void {
    onScroll?.();
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
          vimComp.of(vimOn ? vim() : []),
          proofreadComp.of(language === "markdown" && proofreadOn ? proofreadExtension(true) : []),
          modeComp.of([typewriterExtension(typewriterOn), focusTheme(focusOn)]),
          keymap.of(tableKeymap),
          completionExtension(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          themeComp.of(themeExtensions(appearance === "dark")),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || internalUpdate) return;
            onChange(update.state.doc.toString());
          })
        ]
      })
    });
    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
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

  $effect(() => {
    view?.dispatch({
      effects: vimComp.reconfigure(vimOn ? vim() : [])
    });
  });

  $effect(() => {
    view?.dispatch({
      effects: proofreadComp.reconfigure(language === "markdown" && proofreadOn ? proofreadExtension(true) : [])
    });
  });

  $effect(() => {
    view?.dispatch({
      effects: modeComp.reconfigure([typewriterExtension(typewriterOn), focusTheme(focusOn)])
    });
  });

  onDestroy(() => {
    view?.scrollDOM.removeEventListener("scroll", handleScroll);
    view?.destroy();
  });
</script>

<div bind:this={host} class="code-editor" aria-label="Document editor"></div>

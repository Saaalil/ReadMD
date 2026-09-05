# ReadMD 0.4.0 — DONE (senior implementation, all green)

Work dir: `/home/salil/Downloads/readmd-fix`. All 7 steps implemented + tested.
Do NOT push to main — local testing first, then PR.

## Verification (all green 2026-09-05)
- `npm test` → `verify-fixes: ok` (13 original + 10 new asserts: wiki, backlinks, DOCX glyphs)
- `cargo test --lib proofread` → 3 passed (real Harper: spelling caught, emoji offsets safe, fences quiet)
- `svelte-check` → 0 errors (1 pre-existing Welcome.svelte a11y warning, untouched)
- `npm run build` → ok; mermaid stays code-split (`mermaid.core-*.js` 696KB lazy)
- `cargo check --lib` → clean

## Key senior decisions (why, not what)
1. Harper in Rust (`harper-core 2`), NOT `harper.js` WASM: the JS WASM is 15MB+ and
   would triple the installer. Rust adds ~2MB native, zero JS. `harper.js` npm dep
   was installed then REMOVED.
2. `Document::new_markdown_default_curated`: Markdown-aware, code fences ignored
   natively with source-accurate spans — killed the frontend strip+offset-map
   (~30 lines deleted) as dead weight.
3. UTF-16 offsets from Rust (`utf16_offset_map`): Harper `Span<char>` is
   char-indexed; JS strings are UTF-16. Byte mapping breaks on emoji/CJK.
   Proven with surrogate-pair unit test.
4. Vault scan as scoped Rust commands (`scan_vault` + `read_vault_file`), NOT
   `plugin-fs readDir`: capabilities only grant dialog-scoped fs; new Rust surface
   is canonicalize-guarded to the open document's dir (no traversal).
5. Proofread actions: one action per suggestion (max 3), no fake "More fixes"
   button that hid which text would apply.
6. Typewriter fires on `docChanged` only (typing centers), not `selectionSet`
   (arrow keys would yank the view).
7. Wiki transform runs AFTER callouts in `decorateTokens` (callout pass rewrites
   blockquote children; order matters).

## What remains for YOU (local testing checklist)
1. `npm run desktop:dev` → `/` menu, Tab/Shift-Tab in tables, Ctrl+Shift+T format
2. ```mermaid block renders as SVG (dark + light); broken syntax shows source
3. Misspelled word → dotted underline → hover shows fix → click applies
4. `[[OtherNote]]` in a saved folder → click opens it; Backlinks lists referrers
5. Frontmatter `---` block → sidebar toggle shows raw YAML
6. DOCX opens in Word: real table grid, bold/italic, ☐/☒ tasks
7. Palette toggles: proofread / vim / typewriter / focus — all persist on relaunch
8. Tag a version (`v0.4.0`) → CI builds installers → test in-app update bar

## Files changed (14 modified, 6 new)
New: `rich-text.ts` `complete.ts` `table-edit.ts` `mermaid.ts` `proofread.ts`
`wiki.ts`. Modified: `docx.ts` `markdown.ts` `CodeEditor.svelte` `App.svelte`
`native.ts` `prefs.ts` `styles.css` `Welcome.svelte` `verify-fixes.ts`
`tsconfig.json` `package.json` `src-tauri/Cargo.toml` `src-tauri/src/lib.rs`.

Work dir: `/home/salil/Downloads/readmd-fix` (clone of Saaalil/ReadMD @ main, v0.3.10).
Constraints: offline-first, no LLM, keep installer small. Mermaid lazy-loads via
dynamic `import()` — Vite already code-splits it (`mermaid.core-*.js`, ~696KB, loaded
only when a ```mermaid fence exists).

## DONE by senior (do NOT redo — already tested green)

`npm test` → ok · `svelte-check` → 0 errors · `npm run build` → ok.

1. `src/lib/rich-text.ts` (new) — `parseInline()` splits `**bold** *italic* `code`
   `~~strike~~`, strips `![alt](url)`/`[label](url)`/HTML. Justification: single
   shared inline parser so DOCX and future exporters agree; regex TOKEN is the only
   sane way without pulling remark (heavy).
2. `src/lib/docx.ts` — real `w:tbl` + `w:tblGrid` + borders, bold/italic/strike/code
   runs, Heading4-6 styles, `•`/`1.` list prefixes, rule as bottom-border paragraph.
   Justification: old code flattened tables to spaced text and stripped all styling —
   Word files looked broken. Every line maps 1:1 to an OpenXML element.
3. `src/lib/mermaid.ts` (new) — `mermaidFigureHtml()` (pure, testable) +
   `renderMermaid()` (dynamic import, theme-aware, skips re-render via
   `data-mermaid-source`/`data-mermaid-theme`, hides source `<pre>` on success,
   shows it + `.mermaid-error` on failure). Justification: spec promises Mermaid;
   static import would add ~700KB to initial bundle, dynamic keeps it 0-cost.
4. `src/lib/markdown.ts` — mermaid fence now emits `<figure class="diagram
   diagram-mermaid"><pre class="mermaid">` via `mermaidFigureHtml()`. App.svelte
   preview effect calls `renderMermaid(prose, dark)` only when the figure exists.
5. `src/lib/complete.ts` (new) — `completionExtension()`:
   `/`-triggered snippet menu (14 snippets, `filter:false` because `/` isn't part of
   the label) + doc-word completion (top-12 by frequency, code fences stripped,
   stopwords filtered, min 2 chars). Justification: zero-dep beyond
   `@codemirror/autocomplete` (+30KB); covers 95% of writing-assist value.
6. `src/lib/table-edit.ts` (new) — `splitRow` (escaped-pipe aware), `isDelimiterRow`,
   `findTableRange`, `formatTable` (align-preserving pad), Tab/Shift-Tab cell hop,
   Enter next-row / auto-create / empty-row exits table, Mod-Shift-T format.
   Justification: Typora parity in ~250 lines; no existing tiny CM6 table lib.
7. `src/lib/CodeEditor.svelte` — added `keymap.of(tableKeymap)` BEFORE default
   keymap (precedence: ours wins on Tab/Enter inside tables) + `completionExtension()`.
8. `src/styles.css` — `.diagram-mermaid` card, `.mermaid-svg svg` responsive,
   `.mermaid-error` hides broken svg, autocomplete icon glyphs.
9. `tsconfig.json` — `skipLibCheck: true` (mermaid ships a broken `type-fest` d.ts;
   app code stays strict).
10. `scripts/verify-fixes.ts` — +13 assertions: inline runs, DOCX styles/tables,
    table helpers, mermaid markup. Node strip-types note: imports use explicit `.ts`
    extensions; `markdown.ts` itself is NOT imported (katex CSS breaks Node) —
    test `mermaidFigureHtml()` directly instead.

## REMAINING — step-by-step for cheap model

Each step: edit exactly the files listed, run `npm test`, keep it green, commit
separately. Do not refactor senior's files unless the step says so.

### Step 1 — Slash-menu hint + keybinding docs (small, safe)
Files: `src/lib/Welcome.svelte` (add one bullet: "Type `/` for blocks, Tab moves
in tables"), `src/App.svelte` shortcuts dialog (add rows: `/` commands, `Tab`
table cell, `Ctrl+Shift+T` format table). Pattern: copy existing `<div><dt>`
rows verbatim. Test: `npm test`. Done when: shortcuts dialog lists 3 new rows.

### Step 2 — Harper grammar (medium, isolated)
`npm i harper.js`. New file `src/lib/proofread.ts`: export `createHarperLinter()`
using `harper.js` + `@codemirror/lint` `linter()`; map harper spans to
`{from,to,severity:"warning",message,suggestions}`. Wire into CodeEditor behind a
`proofread: boolean` prop defaulting true; add Compartment so App can toggle.
Debounce: reuse the existing `EditorView.updateListener` pattern — do NOT add a
second update listener, compose inside proofread module. Test: extend
verify-fixes with 2 asserts (misspelled word produces ≥1 diagnostic; clean text
produces 0). Watch bundle: harper WASM ~2MB; if `npm run build` initial chunk
grows >300KB, switch to dynamic `import("harper.js")` like mermaid.ts does.

### Step 3 — Table toolbar button (small)
Files: `src/App.svelte` palette commands: add `{id:"insert-table", label:"Insert
table 3x3", run: insert TableSnippetAtCursor}` where the run calls
`editor.insertAtCursor("|  |  |\n| --- | --- |\n|  |  |\n")`. Pattern: copy the
existing `copy-text` command shape. Test: `npm test` (no new asserts needed,
command is one line).

### Step 4 — Wiki-links + backlinks pane (large, split into 4a/4b)
4a (Rust scan): `src-tauri/src/lib.rs` add `#[tauri::command] fn scan_vault(dir:
String) -> Result<Vec<{path,name}>, String>` using `std::fs::read_dir`
(non-recursive, `.md` only). Register in `generate_handler!`. Frontend
`src/lib/native.ts`: add `scanVault(dir)` wrapper via `invoke`. Pattern: copy
`pasted_dir` command shape exactly.
4b (UI): `src/lib/markdown.ts` `transformWikiLinks(tokens)`: `[[Name]]` →
`<a class="wiki-link" data-wiki="Name">`; call from `decorateTokens()`.
Outline sidebar in App.svelte: add "Backlinks" section listing open-file matches
via `scanVault(docDir)` filtered by filename mentions. Test: 3 asserts
(`[[x]]` renders anchor; scan returns seeded temp dir files; backlinks filter).
Do NOT recurse directories (perf); do NOT watch files yet.

### Step 5 — Frontmatter sheet (small)
`src/lib/markdown.ts` already parses frontmatter blocks. App.svelte: add a
document-info toggle showing `blocks[0]` lines when type is frontmatter, hidden
in reader mode by default. Pattern: copy outline sidebar conditional. Test:
assert `parseMarkdown("---\ntitle: x\n---\n# H")` yields frontmatter block —
BUT parseMarkdown can't run in Node (katex CSS); put this assert in a NEW
`scripts/verify-frontmatter.mjs` that stubs `*.css` via loader, or skip and
verify manually in `desktop:dev`.

### Step 6 — Export hardening: mermaid snapshot + checkbox glyphs (medium)
`src/lib/docx.ts`: mermaid code blocks currently export raw source — acceptable;
add `☐ `/`☒ ` prefix for unchecked/checked task items (replace `(done)` suffix
only for checked, keep suffix). One-line change in the task branch. PDF: mermaid
SVG already inlines via print CSS — no work. Test: 2 asserts in verify-fixes
(task prefixes present; mermaid code block exports source text).

### Step 7 — Vim + typewriter + focus toggles (small, prefs-backed)
`npm i @replit/codemirror-vim`. CodeEditor: `vimComp` Compartment +
`vimProp: boolean`; App: prefs `vim:boolean`, `typewriter:boolean`,
`focus:boolean` in `src/lib/prefs.ts` (extend `Prefs`, defaults false, update
load/save — copy existing `outline` field pattern exactly). Typewriter: existing
scrollIntoView center on cursor (10 lines in CodeEditor). Focus: CSS class dimming
`.cm-line:not(.cm-activeLine)` opacity .35. Palette: 3 toggle commands. Test:
`npm test`; manual check in dev.

## Local verification before push (run in order)
1. `npm test` → `verify-fixes: ok`
2. `npx svelte-check --tsconfig tsconfig.json` → 0 errors
3. `npm run build` → ✓ built; confirm `dist/assets/mermaid.core-*.js` exists
   (proves lazy split) and initial `index-*.js` did not absorb mermaid
4. `npm run desktop:dev` → manual: `/` menu, Tab in table, ```mermaid renders,
   DOCX opens in Word/LibreOffice with real table + bold
5. `git status` clean except intended files; push branch, open PR — do NOT push
   to main.

## What NOT to do
No LLM/transformers/onnx (100MB+ kills the pitch). No Monaco/TipTap/Milkdown
(editor rewrite). No pandoc sidecar. No cloud linters. No recursive vault watch
until 4a ships. No touching `media.ts`/`paste-image.ts` image pipeline (fragile,
recently fixed in 0.3.5–0.3.9).

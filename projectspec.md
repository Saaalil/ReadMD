# readmd - Project Specification

## Product

readmd is a local-first Windows Markdown workstation. It opens, renders, edits, and exports Markdown created by people and LLMs without visual clutter or fragile conversions.

Primary outcomes:

- Open any common Markdown file and render it predictably.
- Edit source in a fast, distraction-free workspace.
- Export faithful PDF and editable DOCX.
- Export clean TXT with no Markdown markers or formatting debris.
- Feel native on Windows 11 and remain responsive on high-refresh displays.

## Product Decisions

| Decision | Choice |
|---|---|
| Desktop runtime | Tauri v2, Rust backend, WebView2 on Windows |
| UI | Svelte 5 + TypeScript |
| Editor | CodeMirror 6 |
| Parser / AST | Unified: micromark, remark, remark-gfm, rehype |
| Highlighting | Shiki, bundled locally |
| Math | KaTeX, bundled locally |
| Diagrams | Mermaid, bundled locally |
| PDF | WebView2 print-to-PDF from the same print DOM used by preview |
| DOCX | Rust AST-to-OpenXML writer; evaluate `docx-rs` against required fixtures before committing |
| TXT | Rust AST plain-text walker |

Tauri is chosen for its Rust backend, WebView2-based Windows runtime, narrow permissions model, and small application footprint. The native shell owns file access, export, dialogs, and window behavior; the web UI owns the editor and document view.

## Scope

### v1

- Open, create, edit, save, and Save As for `.md`, `.markdown`, `.mdown`, `.mkdn`, and `.mdx`.
- Reader, split, and editor modes.
- Document tabs, recent files, outline, find/replace, zoom, word wrap, themes, and command palette.
- CommonMark + GFM rendering; front matter, callouts, task lists, tables, footnotes, syntax-highlighted code, math, Mermaid, local images, and safe inline HTML.
- PDF, DOCX, and clean TXT export.
- Windows file associations, drag/drop, single-instance open handling, window-state restoration, autosave recovery, and system light/dark/high-contrast modes.

### Non-goals for v1

- Cloud sync, accounts, collaboration, AI generation, a plugin marketplace, and mobile support.
- Executing MDX/JSX, JavaScript, macros, remote scripts, or PlantUML processes.
- A localhost HTTP API that exposes the active buffer.
- Pixel-perfect DOCX conversion for arbitrary embedded HTML/CSS.

## UI Direction - Quiet, Notion-Inspired

The interface is calm, typography-led, and almost invisible while reading.

- One understated top bar: filename, save state, mode switcher, search, export, and overflow actions.
- Optional left rail: document outline and recent files. It is collapsed by default in reader mode.
- Wide, centered reading column; generous whitespace; excellent text contrast; no persistent toolbars inside content.
- Editor uses the same typography and measure as preview. Split view has one subtle divider, not card-heavy panels.
- Menus, command palette, export sheet, and toasts are compact. No gradients, dashboard cards, excess borders, or decorative animation.
- Use Windows system theme, Mica where it improves the shell, and solid surfaces where readability wins.
- Full keyboard access: `Ctrl+P` open, `Ctrl+S` save, `Ctrl+K` commands, `Ctrl+F` find, `Ctrl+Shift+E` export.

### Motion

- Animate only opacity and transforms. Never animate layout during typing or scrolling.
- 140-220 ms ease-out for panels, menus, tabs, and theme transitions.
- Split-pane resizing is immediate; no spring physics while dragging.
- Respect Windows reduced-motion preferences.
- Target no dropped frames during normal scrolling, pane resizing, and navigation on 120 Hz displays. This is a measured performance target, not a visual claim.

## Architecture

```text
Svelte workspace
  |- CodeMirror editor
  |- Rendered preview
  |- Command / export UI
  `- Tauri IPC client (strict command allow-list)

Rust application core
  |- Document I/O and encoding preservation
  |- AI-Markdown normalizer
  |- Parse coordinator and source maps
  |- Export service
  |- Image / link policy
  `- Settings, recovery, logging

Shared document model
  `- normalized Markdown -> mdast -> render/export adapters
```

The parser produces one canonical document model. HTML preview, PDF print DOM, DOCX, and TXT exporters consume that model. No exporter may re-parse Markdown independently.

## Rendering Pipeline

```text
raw file
  -> decode and preserve encoding/newlines
  -> non-destructive normalization
  -> CommonMark/GFM AST
  -> sanitized render tree
  -> preview / PDF / DOCX / TXT adapters
```

### Non-destructive AI normalization

LLM output is frequently incomplete or inconsistent. Normalization must improve rendering without silently changing the saved source.

- Detect unmatched fenced-code delimiters and render the remaining content as code in preview; offer an explicit "Apply repair" action to edit the file.
- Accept `\\(...\\)` and `\\[...\\]` math delimiters alongside `$...$` and `$$...$$`.
- Recognize GitHub callouts such as `> [!NOTE]` and `> [!WARNING]`.
- Recover safely from malformed tables, broken list indentation, and invalid HTML by displaying readable fallback content.
- Show a compact diagnostic only when recovery changes interpretation. Diagnostics link to the relevant source line.
- Preserve the raw original in memory and on disk until the user chooses Save or Apply repair.

### Required rendering behavior

- Render CommonMark and GFM deterministically.
- Resolve relative links and local images from the Markdown file directory.
- Render code with language-aware Shiki themes and copy controls.
- Render KaTeX and Mermaid locally. On failure, show the source block and a readable error.
- Support YAML, TOML, and JSON front matter; hide it in reading mode by default and expose it through a document-info sheet.
- `.mdx` is treated as non-executable Markdown. JSX remains visible source instead of being run.

### Security

- Block scripts, event attributes, iframes, unsafe URL schemes, and remote executable content.
- Local file access is scoped to the opened document directory and files selected explicitly by the user.
- Remote images are blocked by default and require per-document approval.
- Bundle all renderer assets. Opening or exporting a local document must not need a network connection.
- Use Tauri capabilities and explicit IPC commands; do not expose blanket filesystem access to the UI.

## Editing

- CodeMirror 6 with Markdown grammar, virtualized viewport, undo/redo, multi-cursor, search/replace, line numbers, and configurable wrapping.
- Preview updates after a 120-200 ms typing debounce, on a cancellable background path.
- Scroll synchronization is section/source-map based. It must degrade gracefully for large images, diagrams, and long tables instead of fighting the user's scroll position.
- Preserve source encoding, BOM, final newline, and line-ending convention on save where possible.
- Create recovery snapshots outside the document folder; clear them only after a confirmed save.

## Exports

| Format | Contract |
|---|---|
| PDF | Use the print DOM and dedicated print CSS. Embed approved local images, retain selectable text, apply page numbers/headers/footers, avoid orphan headings, and provide GitHub, Notion, and technical-paper print themes. |
| DOCX | Generate actual Word XML: Heading 1-6 styles, paragraphs, emphasis, lists, tables, links, images, code blocks, page breaks, and document properties. Unsupported content becomes a labelled readable fallback, never disappears silently. |
| TXT | Write readable prose, not raw source. Remove markers such as `**`, `_`, `~~`, `#`, `---`, and fences; retain headings, hierarchy, list indentation, code content, table values, and `Label (URL)` links. |

Every export uses a save dialog, never overwrites silently, reports the first actionable failure, and never modifies the open Markdown file.

## AI Desktop Integration - Later, Opt-in

Design extension points for Claude Desktop MCP and a `readmd://` deep link, but ship neither as a default v1 service. If added:

- Use stdio MCP rather than an unauthenticated loopback server.
- Expose only user-approved document reads and proposed edit patches.
- Require explicit confirmation before writing or revealing file paths/content.
- Keep the integration disabled until the user enables it.

## Acceptance Criteria

- Open and preview a 50,000-line Markdown file without editor-scroll jank or UI lockups.
- Correctly render fixture documents from GitHub, ChatGPT, Claude, Obsidian, and intentionally malformed LLM outputs.
- Source remains byte-compatible in encoding and line endings after opening and saving an unchanged file.
- TXT fixture exports contain no Markdown markers outside literal code content.
- PDF exports retain selectable text and local images; DOCX exports open cleanly in current Microsoft Word.
- Offline mode makes zero network requests while opening, rendering, editing, saving, or exporting.
- Keyboard navigation, screen-reader labels, high contrast, and reduced motion pass accessibility review.

## Delivery Order

1. Tauri shell, strict permissions, file opening, CodeMirror, canonical parser, basic preview.
2. Notion-inspired workspace, save/recovery, search, outline, themes, local image policy, source mapping.
3. PDF and TXT export with fixture/golden tests.
4. DOCX export, math, Mermaid, file associations, installer, accessibility, and performance profiling.
5. Optional MCP/deep-link integration behind explicit settings and security review.

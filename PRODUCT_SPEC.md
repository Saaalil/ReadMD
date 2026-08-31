# ReadMD — Product Specification

Version 1.0 · Status: Draft · Platform: Windows 10 1809+ / Windows 11 (primary)

## 1. What This Is

ReadMD is a native Windows desktop app that opens, renders, edits, and exports Markdown files. One job, done perfectly: any `.md` file — written by a human, Claude, ChatGPT, Gemini, Pandoc, Obsidian, GitHub, or Notion — renders beautifully and correctly, with zero configuration.

## 2. Problems Solved

- Double-clicking `.md` on Windows opens Notepad: raw `**asterisks**` and `#hashes`.
- Existing viewers break on GFM tables, math, Mermaid, footnotes, or AI-generated quirks.
- Exporting to PDF/DOCX requires pandoc + CLI knowledge.
- TXT exports leak Markdown syntax (`**`, ` ``` `, `~~~`, `[x]`) instead of clean prose.

## 3. Goals

- **G1 — Render anything.** CommonMark 0.31.2 + GFM + extensions. No file should render broken, regardless of origin.
- **G2 — Edit.** Source editing with live synced preview. Never corrupts the file.
- **G3 — Export.** PDF (WYSIWYG), DOCX (semantic/editable), TXT (fully stripped, human-readable).
- **G4 — Feel native and smooth.** Fluent design, Mica, 60–120fps animations, instant open.
- **G5 — Zero setup.** File association, drag-and-drop, recent files. Works offline. No account, no telemetry.

### Non-Goals (v1)

Cloud sync, collaboration, accounts, AI generation, plugins, mobile, MDX/JSX execution, WYSIWYG rich-text mode (source + live preview instead).

## 4. Tech Stack

| Area | Choice | Why |
|---|---|---|
| Shell | C# / .NET 10, WinUI 3, Windows App SDK | The modern native Windows stack. Fluent controls, Mica, built-in composition animations, accessibility. |
| Parsing | Markdig + controlled extension set | Mature .NET parser, real AST (single source of truth for preview + all exports), GFM support. |
| Preview | WebView2, fully local sandboxed HTML | Browser-grade layout for tables/code/math/SVG. Same surface drives print-quality PDF export. No remote content. |
| Syntax highlighting | Shiki, bundled locally | Accurate, theme-aware, offline. |
| Math | KaTeX, bundled locally | Fast, deterministic LaTeX. |
| Diagrams | Mermaid, bundled locally | AI tools emit Mermaid constantly; must just work. |
| Editor | Monaco, hosted locally in WebView2 | Industry-grade editing: find/replace, undo, Markdown awareness. |
| PDF export | WebView2 `PrintToPdfAsync` | WYSIWYG — exactly what you see, via print CSS. |
| DOCX export | Open XML SDK, generated from Markdig AST | Real editable Word doc with proper heading styles. No fragile HTML→Word conversion, no external binaries. |
| TXT export | AST walker (see §8.3) | Deterministic, syntax-free plain text. |
| Settings | Windows App SDK LocalSettings | Native local persistence. |
| Distribution | MSIX + unpackaged installer option; winget | File associations via MSIX. |

**Architecture rule:** parse once to a normalized AST. Preview, PDF, DOCX, and TXT all consume that AST. No component implements its own parser. UI receives immutable snapshots; only the Document Service writes files.

```text
WinUI 3 shell (tabs, commands, recent files, animations)
  ├─ Editor host   (Monaco / WebView2)
  ├─ Preview host  (WebView2, sanitized HTML)
  └─ Document Service
       ├─ encoding detection + file I/O (atomic writes)
       ├─ Markdig → normalized AST
       ├─ HTML renderer + sanitizer (CSP, no remote content)
       ├─ PDF exporter (PrintToPdfAsync + print CSS)
       ├─ DOCX exporter (Open XML)
       └─ TXT exporter (AST walker)
```

## 5. Rendering Compatibility (the core requirement)

Must render correctly, no exceptions:

- **CommonMark 0.31.2** full spec — spec test suite ≥ 99% pass.
- **GFM:** tables (with alignment), strikethrough, autolinks, task lists.
- **Code:** fenced + indented blocks, language labels, inline code, line wrapping, copy button.
- **Math:** `$inline$`, `$$block$$`, `\(...\)` / `\[...\]` (KaTeX).
- **Mermaid** diagrams rendered from code fences.
- **Front matter** (YAML/TOML/JSON): hidden or collapsible — never dumped as text.
- **Extras:** footnotes, definition lists, emoji shortcodes, GitHub-style alerts (`> [!NOTE]`, `> [!TIP]`).
- **Inline HTML:** passed through, sanitized (no scripts, event handlers, unsafe URIs).
- **Images:** relative paths resolved against the file's directory; base64 data URLs supported; remote images blocked by default with per-document opt-in.
- **Links:** relative `.md` links open inside ReadMD; external links open in default browser.
- **Encodings:** UTF-8 (with/without BOM), UTF-16 auto-detected; CRLF/LF/CR preserved on save.

**AI-dialect robustness** (known real-world quirks that must survive): mixed/nested fences, unescaped pipes in tables, math inside lists, unlabeled long code blocks, CRLF output from Windows-side AI tools, broken reference links, trailing whitespace abuse. Malformed content must never crash the preview — render source faithfully, show a compact warning only when content is genuinely unrenderable.

**Large files:** progressive rendering; 20 MB documents stay usable (virtualized DOM regions, debounced re-render while typing).

## 6. UI, Animation & Performance

- Fluent controls, Mica backdrop, auto light/dark + high-contrast themes, scalable text.
- Typography: Segoe UI Variable for prose (65–75ch centered column), Cascadia Code for code.
- **Motion:** 160–240ms ease-out transitions — document open (page fade/slide-in), TOC sidebar slide, tab switches, toasts, mode changes (Reader/Split/Editor). All animation on the composition thread; never blocks typing or scrolling. Respect Windows reduced-motion setting.
- **Scrolling:** zero dropped frames at 120Hz on mid-range hardware; smooth anchor navigation from TOC.
- **Budgets:** cold start < 1s · 1 MB file → first render < 500ms · memory < 150MB idle · no network requests ever unless remote images are explicitly enabled.
- Keyboard-first: Ctrl+E toggle edit, Ctrl+S save, Ctrl+Shift+E/P/D export TXT/PDF/DOCX, Ctrl+P quick-open, TOC navigation, visible focus, screen-reader labels, WCAG AA contrast.

## 7. Editing

- Modes: Reader · Split (editor + live preview, scroll-synced) · Editor-only.
- Monaco: syntax highlighting, fence/bracket matching, find/replace (regex), undo/redo, Markdown-aware shortcuts (bold/italic/link/list/table helpers).
- Preview updates debounced (~150ms), never interrupts typing.
- Save: atomic (temp + rename), preserves encoding + line endings, never silently reformats. Unsaved indicator, Save As, autosave recovery snapshots.
- External file changes detected → non-blocking reload prompt.

## 8. Export

All exports derive from the same AST. Save dialog always shown; never overwrite silently; original document stays open and unchanged.

### 8.1 PDF
- `PrintToPdfAsync` from the exact rendered preview + dedicated print CSS.
- Selectable text, page numbers, headers/footers, page size (A4/Letter), margins.
- Code blocks avoid page splits; images scale to page width; long lines wrap; math/Mermaid rendered before capture.

### 8.2 DOCX
- Open XML SDK from the AST: headings → Word heading styles (real TOC support), lists, tables, links, embedded images, styled code blocks, page breaks, math as OMML with LaTeX-source fallback.
- Ships a clean default reference theme; user-replaceable.

### 8.3 TXT — clean strip rules (no syntax residue, ever)
| Markdown | Output |
|---|---|
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` | plain text, markers removed |
| Fenced/indented code | code content only, no ` ``` `, no language label |
| `[text](url)` | `text` — plus `(url)` only if URL differs from text |
| `![alt](url)` | `alt` or `[image]` |
| `# Heading` | plain text |
| Tables | space-aligned plain-text columns |
| `- [x] task` | `task (done)` / `task` — no `[x]` residue |
| `> quote` | plain text, marker removed |
| Math | LaTeX source |
| Mermaid | diagram source as plain text block |
| Emoji shortcodes | Unicode emoji |
| Front matter | removed entirely |

Blocks separated by exactly one blank line; trailing whitespace trimmed. **Acceptance test:** golden corpus export contains zero occurrences of `**`, ` ``` `, `~~~`, `:::`, or stray fence markers.

## 9. Safety

- Rendered HTML sanitized + strict CSP: app assets and authorized local files only.
- No scripts, event handlers, remote executable content, or unsafe URI schemes.
- Mermaid/KaTeX/Shiki run from bundled local assets; failure falls back to visible source + error note, never a crash.
- Files are local by default; nothing leaves the machine.

## 10. Quality Gates

- CommonMark spec suite ≥ 99%.
- Golden-file corpus: GFM, AI-generated samples (Claude/ChatGPT fixtures), tables, nested lists, malformed syntax, Unicode, math, Mermaid, large docs — visual snapshot diffs.
- Export tests: PDF smoke (created + selectable text), DOCX Open XML validation, TXT zero-residue assertion.
- Perf harness: cold start, render latency, scroll frame drops, memory.
- No network calls during open/render/edit/export unless remote images enabled.

## 11. Milestones

1. **M1 — View:** shell, file open (picker/drag-drop/association), Markdig → WebView2 preview, themes, outline, safe local images.
2. **M2 — Edit:** Monaco, split view with scroll sync, atomic save, recovery, search.
3. **M3 — Export:** PDF → clean TXT → DOCX, with golden tests.
4. **M4 — Polish:** math/Mermaid/front-matter options, animation + perf hardening, accessibility pass, MSIX/winget shipping.

## 12. Ship Criteria

All quality gates green on the golden corpus · zero known crashes on malformed input · performance budgets met · installer + file association working offline.

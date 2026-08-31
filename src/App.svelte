<script lang="ts">
  import CodeEditor from "./lib/CodeEditor.svelte";
  import Welcome from "./lib/Welcome.svelte";
  import { dirFromPath, displayNameFromPath, documentKindFromName, kindLabel } from "./lib/document-kind";
  import { markdownToDocx } from "./lib/docx";
  import { withExtension } from "./lib/download";
  import { previewHtmlDocument } from "./lib/html-preview";
  import { outlineFromParsed, parseMarkdown, renderMarkdown } from "./lib/markdown";
  import { lineAtRoot, scrollRootToLine } from "./lib/scroll-sync";
  import {
    getLaunchArgs,
    isTauriRuntime,
    onCloseRequested,
    onFileOpened,
    onNativeDrop,
    openFileAtPath,
    openMarkdownFile,
    askDiscardChanges,
    pastedStoreDir,
    saveFile,
    setWindowTitle,
    type OpenedFile
  } from "./lib/native";
  import { renderPlainText } from "./lib/plain-render";
  import { markdownToCleanText } from "./lib/plain-text";
  import {
    applyTheme,
    clampZoom,
    loadPrefs,
    rememberFile,
    resolvedTheme,
    savePrefs,
    type ThemePref,
    type ViewMode
  } from "./lib/prefs";
  import { checkForAppUpdate, type UpdateOffer } from "./lib/updater";
  import {
    extensionForImage,
    extensionFromPath,
    htmlImage,
    imageFileFromClipboard,
    isImagePath,
    markdownImage,
    materializeEmbeddedImages,
    storePastedFile,
    storePastedImage
  } from "./lib/paste-image";
  import { onDestroy, onMount, tick } from "svelte";

  type Mode = ViewMode;
  type MenuId = "export" | "recents" | "shortcuts" | null;

  const sample = `# Welcome to readmd

Open a Markdown file, edit it, and export it cleanly.

> [!NOTE]
> Press Ctrl+K for the command palette. Ctrl+B toggles the outline.

- [x] Render Markdown faithfully
- [x] Export PDF, DOCX, and clean TXT
- [x] Jump headings, find text, and reopen recent files

Images render from https URLs, files next to a saved document, or paste and drop:

![Markdown](https://cdn.jsdelivr.net/gh/devicons/devicon/icons/markdown/markdown-original.svg)

Inline math works too: $e^{i\\pi} + 1 = 0$

| Format | Status |
| --- | --- |
| PDF | Print-ready preview |
| DOCX | Semantic Word document |
| TXT | Markdown markers removed |

\`\`\`ts
export function hello() {
  return "readmd";
}
\`\`\`
`;

  const initial = loadPrefs();

  let markdown = $state(sample);
  let fileName = $state("Untitled.md");
  let filePath = $state<string | null>(null);
  let dirty = $state(false);
  let mode = $state<Mode>(initial.mode);
  let themePref = $state<ThemePref>(initial.theme);
  let outlineOpen = $state(initial.outline);
  let zoom = $state(initial.zoom);
  let recents = $state(initial.recents);
  let lastFile = $state(initial.lastFile);
  let lastOpenDir = $state(initial.lastOpenDir);
  let lastSaveDir = $state(initial.lastSaveDir);
  let lastExportDir = $state(initial.lastExportDir);
  let onboarded = $state(initial.onboarded);
  let welcomeOpen = $state(!initial.onboarded);
  let notice = $state<{
    kind: "error" | "ok";
    text: string;
    action?: { label: string; run: () => void };
  } | null>(null);
  let toastLeaving = $state(false);
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  let menu = $state<MenuId>(null);
  let paletteOpen = $state(false);
  let paletteQuery = $state("");
  let paletteIndex = $state(0);
  let findOpen = $state(false);
  let findQuery = $state("");
  let replaceQuery = $state("");
  let findIndex = $state(0);
  let dragging = $state(false);
  let dragDepth = 0;
  let activeHeading = $state<string | null>(null);
  let previewEl = $state<HTMLElement | undefined>(undefined);
  let findInput = $state<HTMLInputElement | undefined>(undefined);
  let replaceInput = $state<HTMLInputElement | undefined>(undefined);
  let paletteInput = $state<HTMLInputElement | undefined>(undefined);
  let editor = $state<{
    revealRange: (from: number, to: number) => void;
    setContent: (text: string) => void;
    getContent: () => string;
    replaceRange: (from: number, to: number, text: string) => void;
    replaceRanges: (ranges: Array<{ from: number; to: number }>, text: string) => void;
    getScrollLine: () => { line: number; ratio: number };
    scrollToLine: (line: number, ratio: number) => void;
    insertAtCursor: (text: string) => void;
  } | undefined>(undefined);
  let htmlFrame = $state<HTMLIFrameElement | undefined>(undefined);
  let unlistenClose: (() => void) | null = null;
  let unlistenDrop: (() => void) | null = null;
  let previewEpoch = $state(0);
  let saving = $state(false);
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let syncLock: "editor" | "preview" | null = null;
  let syncUnlock: ReturnType<typeof setTimeout> | null = null;
  let updateOffer = $state<UpdateOffer | null>(null);
  let updateBusy = $state(false);
  let updatePercent = $state<number | null>(null);

  let appearance = $state<"dark" | "light">(resolvedTheme(initial.theme));
  let previewSource = $state(sample);

  $effect(() => {
    const source = markdown;
    const frame = requestAnimationFrame(() => {
      previewSource = source;
    });
    return () => cancelAnimationFrame(frame);
  });

  let parsed = $derived(parseMarkdown(previewSource));
  let kind = $derived(documentKindFromName(fileName));
  let html = $derived(
    kind === "text"
      ? renderPlainText(previewSource)
      : kind === "html"
        ? previewHtmlDocument(previewSource)
        : renderMarkdown(parsed, filePath ? dirFromPath(filePath) : null)
  );
  let outline = $derived(kind === "markdown" ? outlineFromParsed(parsed) : []);
  let title = $derived(fileName.replace(/\.[^.]+$/, "") || "Untitled");
  let words = $derived(previewSource.trim() ? previewSource.trim().split(/\s+/).length : 0);
  let chars = $derived(previewSource.length);
  let lines = $derived(previewSource.split("\n").length);
  let readingMinutes = $derived(Math.max(1, Math.round(words / 225)));
  let modeIndex = $derived(mode === "reader" ? 0 : mode === "split" ? 1 : 2);
  let windowTitle = $derived(`${dirty ? "*" : ""}${fileName} — readmd`);
  let findMatches = $derived(collectMatches(markdown, findQuery));

  $effect(() => {
    appearance = applyTheme(themePref);
    savePrefs({
      theme: themePref,
      outline: outlineOpen,
      zoom,
      mode,
      recents,
      lastFile,
      lastOpenDir,
      lastSaveDir,
      lastExportDir,
      onboarded
    });
  });

  $effect(() => {
    void setWindowTitle(windowTitle);
  });

  $effect(() => {
    if (kind !== "html" || !htmlFrame) return;
    previewEpoch;
    const doc = htmlFrame.contentDocument;
    if (!doc) return;
    const top = doc.documentElement.scrollTop;
    doc.open();
    doc.write(html);
    doc.close();
    doc.documentElement.scrollTop = top;
  });

  $effect(() => {
    html;
    if (!previewEl || kind === "html") return;
    const headings = previewEl.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]");
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0] instanceof HTMLElement || visible[0]?.target instanceof HTMLElement) {
          activeHeading = (visible[0].target as HTMLElement).id;
        }
      },
      { root: previewEl, rootMargin: "-8% 0px -72% 0px", threshold: 0 }
    );
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  });

  $effect(() => {
    if (paletteOpen) {
      paletteIndex = 0;
      void tick().then(() => paletteInput?.focus());
    }
  });

  function rememberDestination(path: string, name: string, kind: "open" | "save" | "export"): void {
    recents = rememberFile(recents, path, name);
    lastFile = { path, name, at: Date.now() };
    const folder = dirFromPath(path);
    if (!folder) return;
    if (kind === "open") lastOpenDir = folder;
    if (kind === "save") {
      lastSaveDir = folder;
      lastOpenDir = lastOpenDir ?? folder;
    }
    if (kind === "export") lastExportDir = folder;
  }

  function loadDocument(file: OpenedFile): void {
    fileName = file.name;
    filePath = file.path;
    markdown = file.text;
    previewSource = file.text;
    dirty = false;
    if (file.path) rememberDestination(file.path, file.name, "open");
    clearAutoSave();
    void tick().then(async () => {
      editor?.setContent(file.text);
      await collapseEmbeddedImages();
    });
  }

  function currentSource(): string {
    return editor?.getContent() ?? markdown;
  }

  function refreshPreview(): void {
    const source = currentSource();
    markdown = source;
    previewSource = source;
    previewEpoch += 1;
  }

  let unlistenFileOpened: (() => void) | null = null;

  onDestroy(() => {
    unlistenFileOpened?.();
    unlistenClose?.();
    unlistenDrop?.();
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (syncUnlock) clearTimeout(syncUnlock);
  });

  onMount(() => {
    const blockReload = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const reload = key === "f5" || ((event.ctrlKey || event.metaKey) && key === "r");
      if (!reload) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      refreshPreview();
    };
    window.addEventListener("keydown", blockReload, true);
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const file = imageFileFromClipboard(event);
      if (file) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void insertImageFile(file);
        return;
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text.includes("data:image")) {
        window.setTimeout(() => void collapseEmbeddedImages(), 40);
      }
    };
    window.addEventListener("paste", onPaste, true);
    void pastedStoreDir().then(() => collapseEmbeddedImages());
    window.setTimeout(() => {
      if (welcomeOpen) return;
      void offerUpdate();
    }, 2500);
    return () => {
      window.removeEventListener("keydown", blockReload, true);
      window.removeEventListener("paste", onPaste, true);
    };
  });

  if (isTauriRuntime()) {
    void pastedStoreDir();
    unlistenFileOpened = onFileOpened(loadDocument);
    unlistenDrop = onNativeDrop((paths) => {
      dragging = false;
      dragDepth = 0;
      const images = paths.filter(isImagePath);
      if (images.length) {
        void insertImagesFromPaths(images);
        return;
      }
      const path = paths[0];
      if (!path) return;
      void confirmDiscard().then((ok) => {
        if (!ok) return;
        void openFileAtPath(path).then((file) => {
          if (file) loadDocument(file);
        });
      });
    });
    void getLaunchArgs().then(async (args) => {
      const path = args.find((arg) => !arg.startsWith("-"));
      if (path) {
        const file = await openFileAtPath(path);
        if (file) loadDocument(file);
        return;
      }
      if (!initial.lastFile?.path) return;
      const file = await openFileAtPath(initial.lastFile.path);
      if (file) loadDocument(file);
    });
    void onCloseRequested(() => confirmDiscard()).then((unlisten) => {
      unlistenClose = unlisten;
    });
  }

  async function confirmDiscard(): Promise<boolean> {
    closeOverlays();
    if (!dirty) return true;
    if (filePath) {
      await persist({ quiet: true, saveAs: false });
      if (!dirty) return true;
    }
    return askDiscardChanges();
  }

  async function openFromPicker(): Promise<void> {
    if (!(await confirmDiscard())) return;
    closeOverlays();
    try {
      const file = await openMarkdownFile(lastOpenDir ?? lastSaveDir);
      if (!file) return;
      loadDocument(file);
    } catch (caught) {
      showNotice("error", caught instanceof Error ? caught.message : "Unable to open file.");
    }
  }

  async function openRecent(path: string): Promise<void> {
    if (!(await confirmDiscard())) return;
    closeOverlays();
    const file = await openFileAtPath(path);
    if (!file) {
      recents = recents.filter((item) => item.path !== path);
      showNotice("error", "That file could not be opened.");
      return;
    }
    loadDocument(file);
  }

  async function newDocument(): Promise<void> {
    if (!(await confirmDiscard())) return;
    closeOverlays();
    fileName = "Untitled.md";
    filePath = null;
    markdown = "# Untitled\n\n";
    previewSource = markdown;
    dirty = false;
    clearAutoSave();
    void tick().then(() => editor?.setContent(markdown));
  }

  async function saveDocument(): Promise<void> {
    closeOverlays();
    await persist({ quiet: false, saveAs: false });
  }

  async function saveDocumentAs(): Promise<void> {
    closeOverlays();
    await persist({ quiet: false, saveAs: true });
  }

  async function persist(options: { quiet: boolean; saveAs: boolean }): Promise<void> {
    if (saving) return;
    clearAutoSave();
    if (options.quiet && (!filePath || options.saveAs)) return;
    saving = true;
    try {
      const source = currentSource();
      markdown = source;
      const next = await saveFile(options.saveAs ? null : filePath, fileName, source, lastSaveDir ?? lastOpenDir);
      if (!next) return;
      filePath = next;
      fileName = displayNameFromPath(next);
      rememberDestination(next, fileName, "save");
      const rewritten = await materializeEmbeddedImages(source, next);
      if (rewritten !== source) {
        await saveFile(next, fileName, rewritten, lastSaveDir ?? lastOpenDir);
        markdown = rewritten;
        previewSource = rewritten;
        editor?.setContent(rewritten);
      }
      dirty = false;
      if (!options.quiet) showNotice("ok", "Saved.");
    } catch (caught) {
      showNotice("error", caught instanceof Error ? caught.message : "Unable to save file.");
    } finally {
      saving = false;
    }
  }

  function clearAutoSave(): void {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
  }

  function scheduleAutoSave(): void {
    clearAutoSave();
    if (!filePath) return;
    autoSaveTimer = setTimeout(() => {
      void persist({ quiet: true, saveAs: false });
    }, 1800);
  }

  async function exportTxt(): Promise<void> {
    closeOverlays();
    try {
      const target = await saveFile(null, withExtension(fileName, "txt"), markdownToCleanText(parseMarkdown(currentSource())), lastExportDir ?? lastSaveDir);
      if (target) rememberDestination(target, displayNameFromPath(target), "export");
      showNotice("ok", "Exported TXT.");
    } catch (caught) {
      showNotice("error", caught instanceof Error ? caught.message : "Unable to export TXT.");
    }
  }

  async function exportDocx(): Promise<void> {
    closeOverlays();
    try {
      const target = await saveFile(null, withExtension(fileName, "docx"), markdownToDocx(parseMarkdown(currentSource())), lastExportDir ?? lastSaveDir);
      if (target) rememberDestination(target, displayNameFromPath(target), "export");
      showNotice("ok", "Exported DOCX.");
    } catch (caught) {
      showNotice("error", caught instanceof Error ? caught.message : "Unable to export DOCX.");
    }
  }

  function exportPdf(): void {
    closeOverlays();
    window.print();
  }

  async function copyHtml(): Promise<void> {
    closeOverlays();
    await navigator.clipboard.writeText(kind === "html" ? currentSource() : html);
    showNotice("ok", "Copied HTML.");
  }

  async function copyText(): Promise<void> {
    closeOverlays();
    await navigator.clipboard.writeText(markdownToCleanText(parseMarkdown(markdown)));
    showNotice("ok", "Copied plain text.");
  }

  function cycleTheme(): void {
    themePref = themePref === "dark" ? "light" : themePref === "light" ? "system" : "dark";
    showNotice("ok", `Theme: ${themePref}.`);
  }

  function switchMode(next: Mode): void {
    if (next === mode) return;
    if (typeof document.startViewTransition === "function" && window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      document.startViewTransition(() => {
        mode = next;
      });
    } else {
      mode = next;
    }
  }

  function showNotice(
    kind: "error" | "ok",
    text: string,
    action?: { label: string; run: () => void }
  ): void {
    toastLeaving = false;
    notice = { kind, text, action };
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(dismissNotice, 2800);
  }

  function dismissNotice(): void {
    toastLeaving = true;
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      notice = null;
      toastLeaving = false;
    }, 180);
  }

  function finishWelcome(): void {
    welcomeOpen = false;
    onboarded = true;
    void offerUpdate();
  }

  function replayWelcome(): void {
    closeOverlays();
    welcomeOpen = true;
  }

  async function offerUpdate(manual = false): Promise<void> {
    const offer = await checkForAppUpdate();
    if (!offer) {
      if (manual) showNotice("ok", "You're on the latest version.");
      return;
    }
    updateOffer = offer;
  }

  async function installAvailableUpdate(): Promise<void> {
    if (!updateOffer || updateBusy) return;
    updateBusy = true;
    updatePercent = updateOffer.canInstall ? 0 : null;
    try {
      await updateOffer.install((percent) => {
        updatePercent = percent;
      });
    } catch (caught) {
      updateBusy = false;
      showNotice("error", caught instanceof Error ? caught.message : "Update failed.");
    }
  }

  function handleEditorChange(value: string): void {
    markdown = value;
    previewSource = value;
    dirty = true;
    scheduleAutoSave();
  }

  function closeOverlays(): void {
    menu = null;
    paletteOpen = false;
    paletteQuery = "";
  }

  function toggleMenu(id: Exclude<MenuId, null>): void {
    menu = menu === id ? null : id;
    paletteOpen = false;
  }

  function openPalette(): void {
    menu = null;
    findOpen = false;
    paletteOpen = true;
    paletteQuery = "";
    paletteIndex = 0;
  }

  function openFind(focusReplace = false): void {
    paletteOpen = false;
    menu = null;
    findOpen = true;
    void tick().then(() => (focusReplace ? replaceInput : findInput)?.focus());
  }

  function replaceCurrent(): void {
    const match = findMatches[findIndex];
    if (!match) return;
    editor?.replaceRange(match.from, match.to, replaceQuery);
    void tick().then(() => {
      if (findMatches.length) jumpToMatch(Math.min(findIndex, findMatches.length - 1));
    });
  }

  function replaceAllMatches(): void {
    if (!findMatches.length) return;
    editor?.replaceRanges(findMatches, replaceQuery);
  }

  function lockSync(origin: "editor" | "preview"): void {
    syncLock = origin;
    if (syncUnlock) clearTimeout(syncUnlock);
    syncUnlock = setTimeout(() => {
      syncLock = null;
    }, 140);
  }

  function syncPreviewFromEditor(): void {
    if (mode !== "split" || kind === "html" || !previewEl || !editor) return;
    if (syncLock === "preview") return;
    lockSync("editor");
    scrollRootToLine(previewEl, editor.getScrollLine(), 40);
  }

  function syncEditorFromPreview(): void {
    if (mode !== "split" || kind === "html" || !previewEl || !editor) return;
    if (syncLock === "editor") return;
    lockSync("preview");
    const pos = lineAtRoot(previewEl, 40);
    editor.scrollToLine(pos.line, pos.ratio);
  }

  function jumpToMatch(index: number): void {
    if (!findMatches.length) return;
    findIndex = (index + findMatches.length) % findMatches.length;
    const match = findMatches[findIndex];
    if (!match) return;
    if (mode !== "reader") editor?.revealRange(match.from, match.to);
    if (mode !== "editor") {
      const snippet = markdown.slice(match.from, match.to);
      flashPreview(snippet);
    }
  }

  function flashPreview(snippet: string): void {
    if (!previewEl || !snippet) return;
    const needle = snippet.toLowerCase();
    const nodes = previewEl.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,pre,td,th,blockquote,figcaption");
    for (const node of nodes) {
      if (!(node.textContent ?? "").toLowerCase().includes(needle)) continue;
      node.classList.remove("find-flash");
      void (node as HTMLElement).offsetWidth;
      node.classList.add("find-flash");
      node.scrollIntoView({ block: "center", behavior: motionOk() ? "smooth" : "auto" });
      window.setTimeout(() => node.classList.remove("find-flash"), 900);
      break;
    }
  }

  function jumpHeading(id: string): void {
    if (mode === "editor") switchMode("split");
    queueMicrotask(() => {
      const heading = previewEl?.querySelector(`#${CSS.escape(id)}`);
      heading?.scrollIntoView({ block: "start", behavior: motionOk() ? "smooth" : "auto" });
      activeHeading = id;
    });
    const item = outline.find((entry) => entry.id === id);
    if (!item || mode === "reader") return;
    const marker = `${"#".repeat(item.depth)} `;
    const index = markdown.indexOf(`${marker}${item.text}`);
    if (index >= 0) editor?.revealRange(index, index + marker.length + item.text.length);
  }

  function collectMatches(source: string, query: string): Array<{ from: number; to: number }> {
    const needle = query.trim();
    if (needle.length < 1) return [];
    const matches: Array<{ from: number; to: number }> = [];
    const lower = source.toLowerCase();
    const find = needle.toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(find, from);
      if (index === -1) break;
      matches.push({ from: index, to: index + needle.length });
      from = index + Math.max(1, needle.length);
      if (matches.length > 400) break;
    }
    return matches;
  }

  function motionOk(): boolean {
    return window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
  }

  function handleWindowClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest("[data-menu]")) menu = null;
    const copy = target.closest(".copy-code");
    if (copy instanceof HTMLButtonElement) {
      const code = copy.closest(".code-block")?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard.writeText(code).then(() => {
        copy.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy";
        }, 1200);
      });
    }
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();

    if (welcomeOpen) return;

    if (paletteOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlays();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        paletteIndex = Math.min(filteredCommands.length - 1, paletteIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        paletteIndex = Math.max(0, paletteIndex - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        filteredCommands[paletteIndex]?.run();
        return;
      }
      return;
    }

    if (findOpen && event.key === "Escape") {
      event.preventDefault();
      findOpen = false;
      findQuery = "";
      return;
    }

    if (event.key === "Escape") {
      closeOverlays();
      if (menu === "shortcuts") menu = null;
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "r") {
      event.preventDefault();
      refreshPreview();
      return;
    }
    if (key === "f5") {
      event.preventDefault();
      refreshPreview();
      return;
    }
    if (event.ctrlKey && key === "k") {
      event.preventDefault();
      openPalette();
      return;
    }
    if (event.ctrlKey && key === "f") {
      event.preventDefault();
      openFind(false);
      return;
    }
    if (event.ctrlKey && key === "h") {
      event.preventDefault();
      openFind(true);
      return;
    }
    if (event.ctrlKey && key === "b") {
      event.preventDefault();
      outlineOpen = !outlineOpen;
      return;
    }
    if (event.ctrlKey && key === "n") {
      event.preventDefault();
      newDocument();
      return;
    }
    if (event.ctrlKey && event.shiftKey && key === "s") {
      event.preventDefault();
      void saveDocumentAs();
      return;
    }
    if (event.ctrlKey && key === "s") {
      event.preventDefault();
      void saveDocument();
      return;
    }
    if (event.ctrlKey && key === "p") {
      event.preventDefault();
      exportPdf();
      return;
    }
    if (event.ctrlKey && key === "o") {
      event.preventDefault();
      void openFromPicker();
      return;
    }
    if (event.ctrlKey && (event.key === "=" || event.key === "+")) {
      event.preventDefault();
      zoom = clampZoom(zoom + 10);
      return;
    }
    if (event.ctrlKey && event.key === "-") {
      event.preventDefault();
      zoom = clampZoom(zoom - 10);
      return;
    }
    if (event.ctrlKey && event.key === "0") {
      event.preventDefault();
      zoom = 100;
      return;
    }
    if (event.ctrlKey && event.key === "/") {
      event.preventDefault();
      toggleMenu("shortcuts");
      return;
    }
    if (findOpen && event.key === "Enter") {
      event.preventDefault();
      if (event.target === replaceInput) {
        replaceCurrent();
        return;
      }
      jumpToMatch(findIndex + (event.shiftKey ? -1 : 1));
      return;
    }
    if (event.ctrlKey && ["1", "2", "3"].includes(key)) {
      event.preventDefault();
      switchMode(key === "1" ? "reader" : key === "2" ? "split" : "editor");
    }
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
    dragDepth = 0;
    const images = droppedImageFiles(event);
    if (images.length) {
      if (isTauriRuntime()) return;
      void insertImageFiles(images);
      return;
    }
    if (isTauriRuntime()) return;
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    void confirmDiscard().then((ok) => {
      if (!ok) return;
      void file.text().then((text) => {
        loadDocument({ path: null, name: file.name, text });
      });
    });
  }

  function droppedImageFiles(event: DragEvent): File[] {
    const data = event.dataTransfer;
    if (!data) return [];
    const files: File[] = [];
    for (const file of data.files) {
      if (file.type.startsWith("image/") || isImagePath(file.name)) files.push(file);
    }
    if (files.length) return files;
    for (const item of data.items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    return files;
  }

  function imageSnippet(alt: string, src: string): string {
    return kind === "html" ? htmlImage(alt, src) : markdownImage(alt, src);
  }

  function insertImageMarkup(alt: string, src: string): void {
    const snippet = `\n${imageSnippet(alt, src)}\n`;
    if (editor) {
      editor.insertAtCursor(snippet);
      return;
    }
    markdown += snippet;
    previewSource = markdown;
    dirty = true;
    scheduleAutoSave();
  }

  async function collapseEmbeddedImages(): Promise<void> {
    const source = currentSource();
    if (!source.includes("data:image")) return;
    try {
      const next = await materializeEmbeddedImages(source, filePath);
      if (next === source) return;
      markdown = next;
      previewSource = next;
      editor?.setContent(next);
      dirty = true;
      scheduleAutoSave();
    } catch (caught) {
      showNotice("error", caught instanceof Error ? caught.message : "Unable to store pasted image.");
    }
  }

  async function insertImageBytes(bytes: Uint8Array, ext: string, _mime: string, alt: string): Promise<void> {
    try {
      const src = await storePastedImage(bytes, ext, filePath);
      insertImageMarkup(alt, src);
    } catch (caught) {
      showNotice("error", caught instanceof Error ? caught.message : "Unable to paste image.");
    }
  }

  async function insertImageFile(file: File): Promise<void> {
    const ext = extensionForImage(file);
    const stem = file.name?.replace(/\.[^.]+$/, "") ?? "";
    const alt = stem && stem.toLowerCase() !== "image" ? stem : "image";
    const bytes = new Uint8Array(await file.arrayBuffer());
    await insertImageBytes(bytes, ext, file.type, alt);
  }

  async function insertImageFiles(files: File[]): Promise<void> {
    for (const file of files) await insertImageFile(file);
  }

  async function insertImagesFromPaths(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        const ext = extensionFromPath(path);
        const alt = displayNameFromPath(path).replace(/\.[^.]+$/, "") || "image";
        const src = await storePastedFile(path, ext, filePath);
        insertImageMarkup(alt, src);
      } catch (caught) {
        showNotice("error", caught instanceof Error ? caught.message : "Unable to add image.");
      }
    }
  }

  function handleDragEnter(event: DragEvent): void {
    event.preventDefault();
    dragDepth += 1;
    dragging = true;
  }

  function handleDragLeave(event: DragEvent): void {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragging = false;
  }

  const commands = $derived([
    { id: "new", label: "New file", hint: "Ctrl+N", run: newDocument },
    { id: "open", label: "Open…", hint: "Ctrl+O", run: () => void openFromPicker() },
    { id: "save", label: "Save", hint: "Ctrl+S", run: () => void saveDocument() },
    { id: "save-as", label: "Save as…", hint: "Ctrl+Shift+S", run: () => void saveDocumentAs() },
    { id: "reader", label: "Reader view", hint: "Ctrl+1", run: () => { closeOverlays(); switchMode("reader"); } },
    { id: "split", label: "Split view", hint: "Ctrl+2", run: () => { closeOverlays(); switchMode("split"); } },
    { id: "editor", label: "Editor view", hint: "Ctrl+3", run: () => { closeOverlays(); switchMode("editor"); } },
    { id: "outline", label: outlineOpen ? "Hide outline" : "Show outline", hint: "Ctrl+B", run: () => { closeOverlays(); outlineOpen = !outlineOpen; } },
    { id: "theme", label: `Theme: ${themePref}`, hint: "", run: () => { closeOverlays(); cycleTheme(); } },
    { id: "zoom-in", label: "Zoom in", hint: "Ctrl+=", run: () => { closeOverlays(); zoom = clampZoom(zoom + 10); } },
    { id: "zoom-out", label: "Zoom out", hint: "Ctrl+-", run: () => { closeOverlays(); zoom = clampZoom(zoom - 10); } },
    { id: "refresh", label: "Refresh preview", hint: "Ctrl+R", run: () => { closeOverlays(); refreshPreview(); } },
    { id: "find", label: "Find in document", hint: "Ctrl+F", run: () => openFind(false) },
    { id: "replace", label: "Find and replace", hint: "Ctrl+H", run: () => openFind(true) },
    { id: "check-updates", label: "Check for updates", hint: "", run: () => { closeOverlays(); void offerUpdate(true); } },
    { id: "pdf", label: "Export PDF", hint: "Ctrl+P", run: exportPdf },
    { id: "docx", label: "Export DOCX", hint: "", run: () => void exportDocx() },
    { id: "txt", label: "Export TXT", hint: "", run: () => void exportTxt() },
    { id: "copy-html", label: "Copy HTML", hint: "", run: () => void copyHtml() },
    { id: "copy-text", label: "Copy plain text", hint: "", run: () => void copyText() },
    { id: "welcome", label: "Welcome tour", hint: "", run: replayWelcome },
    { id: "shortcuts", label: "Keyboard shortcuts", hint: "Ctrl+/", run: () => { paletteOpen = false; menu = "shortcuts"; } }
  ]);

  let filteredCommands = $derived(
    commands.filter((command) => command.label.toLowerCase().includes(paletteQuery.trim().toLowerCase()))
  );

  $effect(() => {
    paletteQuery;
    paletteIndex = 0;
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} onclick={handleWindowClick} />
<svelte:head>
  <title>{windowTitle}</title>
</svelte:head>

<main
  class="app"
  class:dragging
  style="--preview-zoom: {zoom / 100}"
  ondrop={handleDrop}
  ondragover={(event) => event.preventDefault()}
  ondragenter={handleDragEnter}
  ondragleave={handleDragLeave}
>
  {#if welcomeOpen}
    <Welcome onDone={finishWelcome} />
  {/if}
  <div class="shell">
  {#if updateOffer}
    <div class="update-bar" role="status">
      <span>
        {#if updateBusy && updateOffer.canInstall}
          {updatePercent == null ? "Downloading update…" : `Downloading update… ${updatePercent}%`}
        {:else}
          ReadMD {updateOffer.version} is available.
        {/if}
      </span>
      <button class="primary" disabled={updateBusy} onclick={() => void installAvailableUpdate()}>
        {updateBusy ? "Updating" : updateOffer.installLabel}
      </button>
      {#if !updateBusy}
        <button class="icon-btn" onclick={() => (updateOffer = null)} aria-label="Dismiss update">Later</button>
      {/if}
    </div>
  {/if}
  <header class="topbar">
    <div class="identity">
      <img class="brand-mark" src="/icon.png" width="22" height="22" alt="" />
      <div class="file-block">
        <span class="brand">readmd</span>
        <button class="filename" data-menu title={filePath ?? fileName} onclick={() => toggleMenu("recents")}>
          {fileName}
        </button>
      </div>
      {#if dirty}<span class="dot" aria-label="Unsaved changes"></span>{/if}
      <button class="icon-btn" class:active={outlineOpen} onclick={() => (outlineOpen = !outlineOpen)} title="Outline (Ctrl+B)" aria-label="Toggle outline" aria-pressed={outlineOpen}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12M2 8h8M2 12.5h10" /></svg>
      </button>
      {#if menu === "recents"}
        <div class="menu recents-menu" data-menu role="menu">
          <p class="menu-label">Recent files</p>
          {#if recents.length === 0}
            <p class="menu-empty">No recent files yet.</p>
          {:else}
            {#each recents as item (item.path)}
              <button role="menuitem" onclick={() => void openRecent(item.path)}>{item.name}</button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <nav class="mode" style="--mode-index: {modeIndex}" aria-label="View mode">
      <span class="mode-pill" aria-hidden="true"></span>
      <button class:active={mode === "reader"} aria-current={mode === "reader" ? "page" : undefined} onclick={() => switchMode("reader")} title="Reader (Ctrl+1)">Reader</button>
      <button class:active={mode === "split"} aria-current={mode === "split" ? "page" : undefined} onclick={() => switchMode("split")} title="Split (Ctrl+2)">Split</button>
      <button class:active={mode === "editor"} aria-current={mode === "editor" ? "page" : undefined} onclick={() => switchMode("editor")} title="Editor (Ctrl+3)">Editor</button>
    </nav>

    <div class="actions">
      <button onclick={newDocument} title="New (Ctrl+N)">New</button>
      <button onclick={() => void openFromPicker()} title="Open (Ctrl+O)">Open</button>
      <button class="primary" onclick={() => void saveDocument()} title="Save (Ctrl+S)">Save</button>
      <div class="menu-wrap" data-menu>
        <button class:active={menu === "export"} onclick={() => toggleMenu("export")}>Export</button>
        {#if menu === "export"}
          <div class="menu" role="menu">
            <button role="menuitem" onclick={exportPdf}>PDF <span>Ctrl+P</span></button>
            <button role="menuitem" onclick={() => void exportDocx()}>DOCX</button>
            <button role="menuitem" onclick={() => void exportTxt()}>TXT</button>
            <button role="menuitem" onclick={() => void copyHtml()}>Copy HTML</button>
            <button role="menuitem" onclick={() => void copyText()}>Copy text</button>
          </div>
        {/if}
      </div>
      <button class="icon-btn" onclick={() => openFind(false)} title="Find (Ctrl+F)" aria-label="Find in document">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
      </button>
      <button class="icon-btn" onclick={cycleTheme} title="Theme: {themePref}" aria-label="Cycle theme">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8A6.2 6.2 0 0 1 8 2.2Z" /></svg>
      </button>
      <button class="icon-btn" onclick={openPalette} title="Command palette (Ctrl+K)" aria-label="Command palette">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M3 8h6M3 11.5h8" /></svg>
      </button>
    </div>
  </header>

  {#if findOpen}
    <div class="findbar">
      <input
        bind:this={findInput}
        bind:value={findQuery}
        class="find-query"
        placeholder="Find in document"
        aria-label="Find in document"
        oninput={() => {
          void tick().then(() => {
            if (findMatches.length) jumpToMatch(0);
            else findIndex = 0;
          });
        }}
      />
      <span class="find-count">{findMatches.length ? findIndex + 1 : 0}/{findMatches.length}</span>
      <button onclick={() => jumpToMatch(findIndex - 1)} aria-label="Previous match">Prev</button>
      <button onclick={() => jumpToMatch(findIndex + 1)} aria-label="Next match">Next</button>
      <button class="icon-btn" onclick={() => { findOpen = false; findQuery = ""; }} aria-label="Close find">Esc</button>
      <input
        bind:this={replaceInput}
        bind:value={replaceQuery}
        class="replace-query"
        placeholder="Replace with"
        aria-label="Replace with"
      />
      <button onclick={replaceCurrent} disabled={!findMatches.length}>Replace</button>
      <button onclick={replaceAllMatches} disabled={!findMatches.length}>Replace all</button>
    </div>
  {/if}

  <section class="workspace" class:reader={mode === "reader"} class:editor={mode === "editor"} class:with-outline={outlineOpen}>
    {#if outlineOpen}
      <aside class="outline" aria-label="Document outline">
        <p class="outline-title">Outline</p>
        {#if outline.length === 0}
          <p class="menu-empty">No headings yet.</p>
        {:else}
          {#each outline as item (item.id)}
            <button
              class="outline-item"
              class:active={activeHeading === item.id}
              style="--depth: {item.depth}"
              onclick={() => jumpHeading(item.id)}
            >
              {item.text}
            </button>
          {/each}
        {/if}
      </aside>
    {/if}

    <section class="editor-pane" aria-label="Document editor">
        <CodeEditor bind:this={editor} value={markdown} appearance={appearance} language={kind} onChange={handleEditorChange} onScroll={syncPreviewFromEditor} />
      </section>

      <article class="preview-pane" bind:this={previewEl} aria-label="Rendered preview" onscroll={syncEditorFromPreview}>
        <div class="document-meta">
          <h1>{title}</h1>
          <span>{words} words</span>
          <span>{readingMinutes} min read</span>
          <span>{kindLabel(kind)}</span>
        </div>
        {#if kind === "html"}
          <iframe bind:this={htmlFrame} class="html-frame" title="HTML preview" sandbox="allow-same-origin allow-popups"></iframe>
        {:else}
          <div class="prose">
            {@html html}
          </div>
        {/if}
      </article>
  </section>

  <footer class="statusbar">
    <span>{saving ? "Saving…" : dirty ? "Unsaved" : filePath ? "Saved" : "Draft"}</span>
    <span>{words} words</span>
    <span>{chars} chars</span>
    <span>{lines} lines</span>
    <span class="grow">{filePath ?? "Not saved to disk"}</span>
    <span>{mode}</span>
    <span>{zoom}%</span>
    <span>{appearance}</span>
    {#if updateOffer && !updateBusy}
      <button class="status-update" onclick={() => void installAvailableUpdate()}>Update {updateOffer.version}</button>
    {/if}
  </footer>
  </div>

  {#if notice}
    <div class="toast" class:ok={notice.kind === "ok"} class:leaving={toastLeaving} role="status">
      <span>{notice.text}</span>
      {#if notice.action}
        <button class="toast-dismiss" onclick={() => notice?.action?.run()}>{notice.action.label}</button>
      {/if}
      <button class="toast-dismiss" onclick={dismissNotice} aria-label="Dismiss">Dismiss</button>
    </div>
  {/if}

  {#if paletteOpen}
    <div class="palette-backdrop" role="presentation">
      <button class="palette-scrim" type="button" aria-label="Close command palette" onclick={closeOverlays}></button>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1">
        <div class="palette-head">
          <input bind:this={paletteInput} bind:value={paletteQuery} placeholder="Type a command…" aria-label="Filter commands" />
          <button type="button" class="icon-btn palette-close" onclick={closeOverlays} aria-label="Close command palette" title="Close (Esc)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        <div class="palette-list">
          {#each filteredCommands as command, index (command.id)}
            <button class:active={index === paletteIndex} onclick={command.run}>
              <span>{command.label}</span>
              {#if command.hint}<kbd>{command.hint}</kbd>{/if}
            </button>
          {:else}
            <p class="menu-empty">No matching commands.</p>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if menu === "shortcuts"}
    <div class="palette-backdrop" role="presentation">
      <button class="palette-scrim" type="button" aria-label="Close shortcuts" onclick={() => (menu = null)}></button>
      <div class="shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1">
        <div class="shortcuts-head">
          <h2>Shortcuts</h2>
          <button type="button" class="icon-btn palette-close" onclick={() => (menu = null)} aria-label="Close shortcuts" title="Close (Esc)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        <dl>
          <div><dt>Command palette</dt><dd>Ctrl+K</dd></div>
          <div><dt>Refresh preview</dt><dd>Ctrl+R</dd></div>
          <div><dt>Find</dt><dd>Ctrl+F</dd></div>
          <div><dt>Replace</dt><dd>Ctrl+H</dd></div>
          <div><dt>Outline</dt><dd>Ctrl+B</dd></div>
          <div><dt>New / Open / Save</dt><dd>Ctrl+N / O / S</dd></div>
          <div><dt>Save as</dt><dd>Ctrl+Shift+S</dd></div>
          <div><dt>Reader / Split / Editor</dt><dd>Ctrl+1 / 2 / 3</dd></div>
          <div><dt>Paste image</dt><dd>Ctrl+V</dd></div>
          <div><dt>Zoom</dt><dd>Ctrl + − 0</dd></div>
          <div><dt>Export PDF</dt><dd>Ctrl+P</dd></div>
        </dl>
      </div>
    </div>
  {/if}

  {#if dragging}
    <div class="drop-overlay" aria-hidden="true">
      <div>
        <img src="/icon.png" width="48" height="48" alt="" />
        <p>Drop a Markdown file or an image</p>
      </div>
    </div>
  {/if}
</main>

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { dirFromPath, displayNameFromPath, joinPath } from "./document-kind";
import { downloadBlob } from "./download";

export interface OpenedFile {
  path: string | null;
  name: string;
  text: string;
}

type SavePayload = string | Blob;
export type FileOpenListener = (file: OpenedFile) => void;
export type NativeDropListener = (paths: string[]) => void;

const DOCUMENT_FILTERS = [
  { name: "Documents", extensions: ["md", "markdown", "mdown", "mkdn", "mdx", "txt", "html", "htm"] },
  { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkdn", "mdx"] },
  { name: "HTML", extensions: ["html", "htm"] },
  { name: "Text", extensions: ["txt"] }
];

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function getLaunchArgs(): Promise<string[]> {
  return invoke<string[]>("launch_args");
}

export function onFileOpened(listener: FileOpenListener): () => void {
  if (!isTauriRuntime()) return () => {};
  let unlisten: UnlistenFn | null = null;
  void listen<{ path: string }>("readmd://open-file", (event) => {
    void openPath(event.payload.path).then((file) => {
      if (file) listener(file);
    });
  }).then((unlistenFn) => {
    unlisten = unlistenFn;
  });
  return () => unlisten?.();
}

export function onNativeDrop(listener: NativeDropListener): () => void {
  if (!isTauriRuntime()) return () => {};
  let unlisten: UnlistenFn | null = null;
  void import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) =>
    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop" && event.payload.paths.length) {
          listener(event.payload.paths);
        }
      })
      .then((unlistenFn) => {
        unlisten = unlistenFn;
      })
  );
  return () => unlisten?.();
}

export async function openFileAtPath(path: string): Promise<OpenedFile | null> {
  return openPath(path);
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (!isTauriRuntime()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

export async function askDiscardChanges(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return window.confirm("This document has unsaved changes. Discard them?");
  }
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask("This document has unsaved changes. Discard them?", {
    title: "readmd",
    kind: "warning"
  });
}

export async function onCloseRequested(handler: () => boolean | Promise<boolean>): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  let closing = false;
  const unlisten = await current.onCloseRequested(async (event) => {
    if (closing) return;
    // Prevent first: awaiting a dialog after CloseRequested without this
    // deadlocks WebView2, so the window X appears to do nothing.
    event.preventDefault();
    const allowed = await handler();
    if (!allowed) return;
    closing = true;
    await current.destroy();
  });
  return unlisten;
}

async function openPath(path: string): Promise<OpenedFile | null> {
  try {
    const text = await invoke<string>("read_text", { path });
    return {
      path,
      name: displayNameFromPath(path),
      text
    };
  } catch {
    return null;
  }
}

export async function openMarkdownFile(defaultDir?: string | null): Promise<OpenedFile | null> {
  if (!isTauriRuntime()) {
    return openBrowserFile();
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    defaultPath: defaultDir || undefined,
    filters: DOCUMENT_FILTERS
  });

  if (typeof selected !== "string") return null;
  return openPath(selected);
}

export async function saveFile(
  path: string | null,
  suggestedName: string,
  payload: SavePayload,
  defaultDir?: string | null
): Promise<string | null> {
  if (!isTauriRuntime()) {
    downloadBlob(await toBlob(payload), suggestedName);
    return null;
  }

  const { save } = await import("@tauri-apps/plugin-dialog");

  const fallback = defaultDir ? joinPath(defaultDir, suggestedName) : suggestedName;
  const target =
    path ??
    (await save({
      defaultPath: fallback
    }));

  if (typeof target !== "string") return null;

  if (typeof payload === "string") {
    await invoke("write_text", { path: target, contents: payload });
  } else {
    await writeBytes(target, new Uint8Array(await payload.arrayBuffer()));
  }

  return target;
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_bytes", { path, contents: Array.from(bytes) });
}

export async function copyDiskFile(from: string, to: string): Promise<void> {
  await invoke("copy_file", { from, to });
}

export async function readBytes(path: string): Promise<Uint8Array> {
  const contents = await invoke<number[]>("read_bytes", { path });
  return Uint8Array.from(contents);
}

let pasteStore: string | null = null;

export async function pastedStoreDir(): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error("Paste store is only available in the desktop app.");
  }
  if (!pasteStore) {
    pasteStore = await invoke<string>("pasted_dir");
  }
  return pasteStore;
}

export function pastedStoreDirSync(): string | null {
  return pasteStore;
}

export function directoryOf(path: string | null): string | null {
  return path ? dirFromPath(path) : null;
}

function openBrowserFile(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.mdown,.mkdn,.mdx,.txt,.html,.htm,text/markdown,text/plain,text/html";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ path: null, name: file.name, text: await file.text() });
    };
    input.click();
  });
}

async function toBlob(payload: SavePayload): Promise<Blob> {
  return typeof payload === "string" ? new Blob([payload], { type: "text/plain;charset=utf-8" }) : payload;
}

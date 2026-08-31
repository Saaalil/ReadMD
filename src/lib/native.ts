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
export type NativeDropListener = (path: string) => void;

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
        if (event.payload.type === "drop" && event.payload.paths[0]) {
          listener(event.payload.paths[0]);
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

export async function onCloseRequested(handler: () => boolean | Promise<boolean>): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await handler())) event.preventDefault();
  });
  return unlisten;
}

async function openPath(path: string): Promise<OpenedFile | null> {
  try {
    const [{ readTextFile }] = await Promise.all([import("@tauri-apps/plugin-fs")]);
    return {
      path,
      name: displayNameFromPath(path),
      text: await readTextFile(path)
    };
  } catch {
    return null;
  }
}

export async function openMarkdownFile(defaultDir?: string | null): Promise<OpenedFile | null> {
  if (!isTauriRuntime()) {
    return openBrowserFile();
  }

  const [{ open }, { readTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs")
  ]);
  const selected = await open({
    multiple: false,
    defaultPath: defaultDir || undefined,
    filters: DOCUMENT_FILTERS
  });

  if (typeof selected !== "string") return null;

  return {
    path: selected,
    name: displayNameFromPath(selected),
    text: await readTextFile(selected)
  };
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

  const [{ save }, { writeFile, writeTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs")
  ]);

  const fallback = defaultDir ? joinPath(defaultDir, suggestedName) : suggestedName;
  const target =
    path ??
    (await save({
      defaultPath: fallback
    }));

  if (typeof target !== "string") return null;

  if (typeof payload === "string") {
    await writeTextFile(target, payload);
  } else {
    await writeFile(target, new Uint8Array(await payload.arrayBuffer()));
  }

  return target;
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

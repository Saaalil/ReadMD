import { getVersion } from "@tauri-apps/api/app";
import { isTauriRuntime } from "./native";

export interface UpdateOffer {
  version: string;
  installLabel: string;
  canInstall: boolean;
  install: (onProgress?: (percent: number | null) => void) => Promise<void>;
}

export async function checkForAppUpdate(): Promise<UpdateOffer | null> {
  if (!isTauriRuntime()) return null;
  const current = await getVersion();

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      return {
        version: update.version,
        installLabel: "Update now",
        canInstall: true,
        install: async (onProgress) => {
          let total = 0;
          let received = 0;
          await update.downloadAndInstall((event) => {
            if (event.event === "Started") {
              total = event.data.contentLength ?? 0;
              onProgress?.(0);
            } else if (event.event === "Progress") {
              received += event.data.chunkLength;
              onProgress?.(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null);
            } else if (event.event === "Finished") {
              onProgress?.(100);
            }
          });
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        }
      };
    }
  } catch {
    // latest.json is missing on older releases; fall through to GitHub.
  }

  return githubReleaseFallback(current);
}

async function githubReleaseFallback(current: string): Promise<UpdateOffer | null> {
  try {
    const response = await fetch("https://api.github.com/repos/Saaalil/ReadMD/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: string; html_url?: string };
    const version = String(data.tag_name ?? "").replace(/^v/i, "");
    const url = data.html_url;
    if (!version || !url || !isNewer(version, current)) return null;
    return {
      version,
      installLabel: "Open download",
      canInstall: false,
      install: async () => {
        window.open(url, "_blank", "noopener");
      }
    };
  } catch {
    return null;
  }
}

function isNewer(remote: string, current: string): boolean {
  const left = remote.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = current.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    if ((left[index] ?? 0) > (right[index] ?? 0)) return true;
    if ((left[index] ?? 0) < (right[index] ?? 0)) return false;
  }
  return false;
}

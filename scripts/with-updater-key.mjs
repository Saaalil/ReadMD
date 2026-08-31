import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = join(root, "src-tauri", "updater.key");

if (!process.env.TAURI_SIGNING_PRIVATE_KEY && existsSync(keyPath)) {
  process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf8");
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
}

const win = process.platform === "win32";
const npm = win ? "npx.cmd" : "npx";
const bundles = win ? "nsis,msi" : "appimage,deb";

const child = spawn(npm, ["tauri", "build", "--bundles", bundles], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: win
});

child.on("exit", (code) => process.exit(code ?? 1));

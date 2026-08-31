import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const script = process.argv[2] === "dev" ? "dev" : "build";
const result = spawnSync(npm, ["run", script], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);

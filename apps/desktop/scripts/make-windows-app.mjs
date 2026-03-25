import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forgePath = resolve(
  appDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-forge.cmd" : "electron-forge",
);

if (!existsSync(forgePath)) {
  console.error("Missing electron-forge. Run 'bun install' in repository root first.");
  process.exit(1);
}

for (const command of [
  ["node", "./scripts/build-app-icons.mjs"],
  ["node", "./scripts/materialize-forge-deps.mjs"],
  [forgePath, "make", "--platform", "win32"],
]) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

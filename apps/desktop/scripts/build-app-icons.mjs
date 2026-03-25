import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(
  appDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "png2icons.cmd" : "png2icons",
);
const sourcePng = resolve(appDir, "assets", "icons", "build", "codetrail-1024.png");
const outputBase = resolve(appDir, "assets", "icons", "build", "codetrail");

if (!existsSync(cliPath)) {
  console.error("png2icons is required. Run 'bun install' first.");
  process.exit(1);
}

if (!existsSync(sourcePng)) {
  console.error(`Missing source icon: ${sourcePng}`);
  process.exit(1);
}

for (const format of ["-icns", "-ico"]) {
  const result = spawnSync(cliPath, [sourcePng, outputBase, format, "-bc"], {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

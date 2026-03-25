import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const workspaceRoot = process.cwd();
const SOURCE_ROOTS = [
  "apps/desktop/src",
  "packages/core/src/discovery",
  "apps/desktop/forge.config.ts",
];

const ALLOWLIST = new Set([
  "apps/desktop/forge.config.ts",
  "apps/desktop/src/preload/index.ts",
  "apps/desktop/src/shared/desktopPlatform.ts",
  "apps/desktop/src/shared/externalTools.ts",
  "apps/desktop/src/main/appMenu.ts",
  "apps/desktop/src/main/editorDefinitions.ts",
  "apps/desktop/src/main/editorMacos.ts",
  "apps/desktop/src/main/editorPlatform.ts",
  "apps/desktop/src/main/platformConfig.ts",
  "apps/desktop/src/renderer/hooks/useKeyboardShortcuts.ts",
  "apps/desktop/src/renderer/lib/codetrailClient.tsx",
  "apps/desktop/src/renderer/lib/externalToolPolicy.ts",
  "apps/desktop/src/renderer/lib/shortcutRegistry.ts",
  "apps/desktop/src/renderer/lib/tooltipText.ts",
  "packages/core/src/discovery/platformDiscoveryDefaults.ts",
]);

const CHECKS = [
  { name: "process.platform", pattern: /\bprocess\.platform\b/g },
  { name: "desktop platform literals", pattern: /\b(?:darwin|win32)\b/g },
  { name: "platform path defaults", pattern: /\bAppData\b|\/Applications\//g },
  { name: "platform modifier literals", pattern: /\b(?:metaKey|ctrlKey)\b|Cmd\+|Ctrl\+/g },
  { name: "AppleScript launcher paths", pattern: /\bosascript\b/g },
];

async function listFiles(entryPath) {
  const absolutePath = resolve(workspaceRoot, entryPath);
  const fileStat = await stat(absolutePath);
  if (fileStat.isFile()) {
    return [absolutePath];
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const nextPath = resolve(absolutePath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "out" || entry.name === "dist") {
          return [];
        }
        return listFiles(nextPath);
      }
      return [nextPath];
    }),
  );
  return files.flat();
}

function shouldCheckFile(filePath) {
  const relativePath = relative(workspaceRoot, filePath).replaceAll("\\", "/");
  if (ALLOWLIST.has(relativePath)) {
    return false;
  }
  if (relativePath.includes(".test.") || relativePath.includes("/test/")) {
    return false;
  }
  return [".ts", ".tsx", ".js", ".mjs"].includes(extname(relativePath));
}

function findLineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

async function main() {
  const roots = await Promise.all(SOURCE_ROOTS.map((entry) => listFiles(entry)));
  const files = roots.flat().filter(shouldCheckFile);
  const violations = [];

  for (const filePath of files) {
    const relativePath = relative(workspaceRoot, filePath).replaceAll("\\", "/");
    const content = await readFile(filePath, "utf8");
    for (const check of CHECKS) {
      check.pattern.lastIndex = 0;
      let match = check.pattern.exec(content);
      while (match) {
        violations.push({
          file: relativePath,
          line: findLineNumber(content, match.index),
          token: match[0],
          check: check.name,
        });
        match = check.pattern.exec(content);
      }
    }
  }

  if (violations.length === 0) {
    console.log("platform boundary check passed");
    return;
  }

  console.error("platform boundary check failed");
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line} ${violation.check} -> ${JSON.stringify(violation.token)}`,
    );
  }
  process.exitCode = 1;
}

await main();

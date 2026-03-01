import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

declare const Bun: {
  build: (options: Record<string, unknown>) => Promise<{
    success: boolean;
    logs: Array<{ message: string }>;
  }>;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(scriptDir, "..");
const srcDir = join(appDir, "src");
const outDir = join(appDir, "dist");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await buildMainAndPreload();
await buildRenderer();
copyRendererHtml();

console.log(`Desktop build completed at ${outDir}`);

async function buildMainAndPreload(): Promise<void> {
  const mainBuild = await Bun.build({
    entrypoints: [join(srcDir, "main", "main.ts"), join(srcDir, "main", "indexingWorker.ts")],
    outdir: join(outDir, "main"),
    target: "node",
    format: "esm",
    sourcemap: "linked",
    minify: false,
    external: ["electron", "better-sqlite3"],
    naming: {
      entry: "[name].js",
      chunk: "chunks/[name]-[hash].js",
      asset: "assets/[name]-[hash].[ext]",
    },
  });
  ensureBuildSuccess("main", mainBuild);

  const preloadBuild = await Bun.build({
    entrypoints: [join(srcDir, "preload", "index.ts")],
    outdir: join(outDir, "preload"),
    target: "node",
    format: "cjs",
    sourcemap: "linked",
    minify: false,
    external: ["electron"],
    naming: {
      entry: "[name].cjs",
      chunk: "chunks/[name]-[hash].js",
      asset: "assets/[name]-[hash].[ext]",
    },
  });
  ensureBuildSuccess("preload", preloadBuild);
}

async function buildRenderer(): Promise<void> {
  const rendererBuild = await Bun.build({
    entrypoints: [join(srcDir, "renderer", "main.tsx")],
    outdir: join(outDir, "renderer"),
    target: "browser",
    format: "esm",
    sourcemap: "linked",
    minify: false,
    splitting: false,
  });
  ensureBuildSuccess("renderer", rendererBuild);
}

function copyRendererHtml(): void {
  const rendererOutDir = join(outDir, "renderer");
  mkdirSync(rendererOutDir, { recursive: true });

  const sourceHtmlPath = join(srcDir, "renderer", "index.html");
  let html = readFileSync(sourceHtmlPath, "utf8");
  if (existsSync(join(rendererOutDir, "main.css"))) {
    html = html.replace("</head>", '    <link rel="stylesheet" href="./main.css" />\n  </head>');
  }
  writeFileSync(join(rendererOutDir, "index.html"), html);
}

function ensureBuildSuccess(
  name: string,
  result: {
    success: boolean;
    logs: Array<{ message: string }>;
  },
): void {
  if (result.success) {
    return;
  }

  const diagnostics = result.logs.map((log) => log.message).join("\n");
  throw new Error(`Failed to build ${name}:\n${diagnostics}`);
}

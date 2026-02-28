import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BrowserWindow, app } from "electron";

import { bootstrapMainProcess } from "./bootstrap";

function createWindow(): BrowserWindow {
  const preloadPath = resolvePreloadPath();
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1120,
    minHeight: 680,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const debugRenderer = process.env.CCH_DEBUG_RENDERER === "1";
  if (debugRenderer) {
    mainWindow.webContents.on("did-finish-load", () => {
      console.log("[cch] renderer loaded", mainWindow.webContents.getURL());
    });

    mainWindow.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        console.error("[cch] did-fail-load", { errorCode, errorDescription, validatedURL });
      },
    );

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error("[cch] render-process-gone", details);
    });

    mainWindow.webContents.on("preload-error", (_event, preloadScriptPath, error) => {
      console.error("[cch] preload-error", preloadScriptPath, error);
    });
  }

  const rendererUrl = process.env.CCH_RENDERER_URL;
  if (rendererUrl && rendererUrl.length > 0) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    const localRendererPath = resolveLocalRendererHtmlPath();
    if (localRendererPath) {
      void mainWindow.loadURL(pathToFileURL(localRendererPath).toString());
    } else {
      void mainWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          "<!doctype html><html><body style='font-family:sans-serif;padding:24px'><h1>CCH TS</h1><p>Renderer bundle not found.</p></body></html>",
        )}`,
      );
    }
  }

  if (process.env.CCH_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  return mainWindow;
}

app.whenReady().then(async () => {
  try {
    await bootstrapMainProcess();
    createWindow();
  } catch (error) {
    console.error("[cch] bootstrap failure", error);
    app.exit(1);
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function resolveLocalRendererHtmlPath(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "renderer", "index.html"),
    join(moduleDir, "..", "..", "renderer", "index.html"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolvePreloadPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "preload", "index.cjs"),
    join(moduleDir, "..", "..", "preload", "index.cjs"),
    join(moduleDir, "..", "preload", "index.js"),
    join(moduleDir, "..", "..", "preload", "index.js"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Preload script not found. Tried: ${candidates.join(", ")}`);
}

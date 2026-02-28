import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BrowserWindow, type BrowserWindowConstructorOptions, app, nativeImage } from "electron";

import { type AppStateStore, createAppStateStore } from "./appStateStore";
import { bootstrapMainProcess, shutdownMainProcess } from "./bootstrap";

let mainWindowRef: BrowserWindow | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function createWindow(appStateStore: AppStateStore): BrowserWindow {
  const preloadPath = resolvePreloadPath();
  const iconPath = resolveAppIconPath();
  const persistedWindowState = appStateStore.getWindowState();
  const isMac = process.platform === "darwin";

  const windowOptions = {
    width: persistedWindowState?.width ?? 1400,
    height: persistedWindowState?.height ?? 900,
    minWidth: 1120,
    minHeight: 680,
    title: "Code Trail",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 16 },
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...(iconPath ? { icon: iconPath } : {}),
    ...(persistedWindowState?.x !== undefined ? { x: persistedWindowState.x } : {}),
    ...(persistedWindowState?.y !== undefined ? { y: persistedWindowState.y } : {}),
  } satisfies BrowserWindowConstructorOptions;

  const mainWindow = new BrowserWindow(windowOptions);

  const debugRenderer = process.env.CODETRAIL_DEBUG_RENDERER === "1";
  if (debugRenderer) {
    mainWindow.webContents.on("did-finish-load", () => {
      console.log("[codetrail] renderer loaded", mainWindow.webContents.getURL());
    });

    mainWindow.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        console.error("[codetrail] did-fail-load", { errorCode, errorDescription, validatedURL });
      },
    );

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error("[codetrail] render-process-gone", details);
    });

    mainWindow.webContents.on("preload-error", (_event, preloadScriptPath, error) => {
      console.error("[codetrail] preload-error", preloadScriptPath, error);
    });
  }

  const rendererUrl = process.env.CODETRAIL_RENDERER_URL;
  if (rendererUrl && rendererUrl.length > 0) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    const localRendererPath = resolveLocalRendererHtmlPath();
    if (localRendererPath) {
      void mainWindow.loadURL(pathToFileURL(localRendererPath).toString());
    } else {
      void mainWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          "<!doctype html><html><body style='font-family:sans-serif;padding:24px'><h1>Code Trail</h1><p>Renderer bundle not found.</p></body></html>",
        )}`,
      );
    }
  }

  if (process.env.CODETRAIL_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  const persistWindowState = () => {
    const bounds = mainWindow.getBounds();
    appStateStore.setWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: mainWindow.isMaximized(),
    });
  };

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersistWindowState = () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistWindowState();
    }, 120);
  };

  mainWindow.on("resize", schedulePersistWindowState);
  mainWindow.on("move", schedulePersistWindowState);
  mainWindow.on("maximize", persistWindowState);
  mainWindow.on("unmaximize", persistWindowState);
  mainWindow.on("close", persistWindowState);
  mainWindow.on("closed", () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });

  if (persistedWindowState?.isMaximized) {
    mainWindow.maximize();
  }

  return mainWindow;
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    const appStateStore = createAppStateStore(join(app.getPath("userData"), "ui-state.json"));
    const iconPath = resolveAppIconPath();
    if (iconPath && process.platform === "darwin") {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    }
    try {
      await bootstrapMainProcess({ appStateStore });
      mainWindowRef = createWindow(appStateStore);
    } catch (error) {
      console.error("[codetrail] bootstrap failure", error);
      app.exit(1);
      return;
    }

    app.on("before-quit", () => {
      shutdownMainProcess();
      appStateStore.flush();
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindowRef = createWindow(appStateStore);
      }
    });
  });

  app.on("second-instance", () => {
    const window = mainWindowRef ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

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

function resolveAppIconPath(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "..", "assets", "icons", "build", "codetrail-1024.png"),
    join(process.cwd(), "assets", "icons", "build", "codetrail-1024.png"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BrowserWindow, type BrowserWindowConstructorOptions, app, nativeImage } from "electron";

import { type AppStateStore, createAppStateStore } from "./appStateStore";
import { bootstrapMainProcess, shutdownMainProcess } from "./bootstrap";

let mainWindowRef: BrowserWindow | null = null;
let debugLogPathCache: string | null = null;
const verboseLoggingEnabled =
  process.argv.includes("--verbose") || app.commandLine.hasSwitch("verbose");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function getDebugLogPath(): string {
  if (debugLogPathCache) {
    return debugLogPathCache;
  }
  const userDataDir = app.getPath("userData");
  mkdirSync(userDataDir, { recursive: true });
  debugLogPathCache = join(userDataDir, "codetrail-debug.log");
  return debugLogPathCache;
}

function writeDebugLog(message: string, details?: unknown): void {
  if (!verboseLoggingEnabled) {
    return;
  }

  const timestamp = new Date().toISOString();
  let serializedDetails = "";
  if (details !== undefined) {
    try {
      serializedDetails = ` ${JSON.stringify(details)}`;
    } catch {
      serializedDetails = ` ${String(details)}`;
    }
  }
  const line = `${timestamp} ${message}${serializedDetails}\n`;
  if (process.env.CODETRAIL_DEBUG_LOG_STDOUT === "1") {
    console.log(line.trimEnd());
  }
  try {
    appendFileSync(getDebugLogPath(), line, "utf8");
  } catch (error) {
    console.error("[codetrail] failed writing debug log", error);
  }
}

function createWindow(appStateStore: AppStateStore): BrowserWindow {
  const preloadPath = resolvePreloadPath();
  const iconPath = resolveAppIconPath();
  const persistedPaneState = appStateStore.getPaneState();
  const persistedWindowState = appStateStore.getWindowState();
  const isMac = process.platform === "darwin";
  const windowBackgroundColor =
    persistedPaneState?.theme === "dark" ? "#1e2028" : "#f5f5f7";

  const windowOptions = {
    show: false,
    backgroundColor: windowBackgroundColor,
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
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  if (verboseLoggingEnabled) {
    const logRenderer = (message: string, details?: unknown) => {
      writeDebugLog(message, details);
    };

    mainWindow.webContents.on("did-start-loading", () => {
      logRenderer("renderer did-start-loading", { url: mainWindow.webContents.getURL() });
    });
    mainWindow.webContents.on("did-finish-load", () => {
      logRenderer("renderer did-finish-load", { url: mainWindow.webContents.getURL() });
    });
    mainWindow.webContents.on("did-stop-loading", () => {
      logRenderer("renderer did-stop-loading", { url: mainWindow.webContents.getURL() });
    });
    mainWindow.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL) => {
        logRenderer("renderer did-fail-load", { errorCode, errorDescription, validatedURL });
      },
    );
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      logRenderer("renderer render-process-gone", details);
    });
    mainWindow.webContents.on("preload-error", (_event, preloadScriptPath, error) => {
      logRenderer("renderer preload-error", {
        preloadScriptPath,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    });
    mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      logRenderer("renderer console-message", { level, message, line, sourceId });
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
    if (verboseLoggingEnabled) {
      console.log(`[codetrail] verbose logging enabled: ${getDebugLogPath()}`);
    }
    writeDebugLog("app whenReady");
    const appStateStore = createAppStateStore(join(app.getPath("userData"), "ui-state.json"));
    const iconPath = resolveAppIconPath();
    if (iconPath && process.platform === "darwin") {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    }
    try {
      writeDebugLog("bootstrapMainProcess start");
      await bootstrapMainProcess({ appStateStore });
      writeDebugLog("bootstrapMainProcess success");
      mainWindowRef = createWindow(appStateStore);
      writeDebugLog("createWindow success");
    } catch (error) {
      console.error("[codetrail] bootstrap failure", error);
      writeDebugLog(
        "bootstrap failure",
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      app.exit(1);
      return;
    }

    app.on("before-quit", () => {
      writeDebugLog("before-quit");
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
    writeDebugLog("second-instance");
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
    writeDebugLog("window-all-closed", { platform: process.platform });
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

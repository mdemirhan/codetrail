import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  app,
  nativeImage,
  shell,
} from "electron";

import { type AppStateStore, createAppStateStore } from "./appStateStore";
import { bootstrapMainProcess, shutdownMainProcess } from "./bootstrap";
import { appendDebugLog } from "./debugLog";

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

function writeDebugLog(message: string, details?: unknown, options?: { force?: boolean }): void {
  if (!verboseLoggingEnabled && options?.force !== true) {
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
    appendDebugLog(getDebugLogPath(), line);
  } catch (error) {
    console.error("[codetrail] failed writing debug log", error);
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause !== undefined ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return error;
}

function logAppError(message: string, error: unknown, details?: Record<string, unknown>): void {
  console.error(`[codetrail] ${message}`, error);
  writeDebugLog(
    message,
    {
      ...(details ?? {}),
      error: serializeError(error),
    },
    { force: true },
  );
}

function logIndexingNotice(message: string, details: Record<string, unknown>): void {
  console.info(`[codetrail] ${message}`, details);
  writeDebugLog(message, details, { force: true });
}

function createWindow(appStateStore: AppStateStore): BrowserWindow {
  const preloadPath = resolvePreloadPath();
  const iconPath = resolveAppIconPath();
  const persistedPaneState = appStateStore.getPaneState();
  const persistedWindowState = appStateStore.getWindowState();
  const isMac = process.platform === "darwin";
  const windowBackgroundColor = persistedPaneState?.theme === "dark" ? "#1e2028" : "#f5f5f7";

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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
      const currentUrl = mainWindow.webContents.getURL();
      if (normalizeNavigationUrl(targetUrl) === normalizeNavigationUrl(currentUrl)) {
        return;
      }
      event.preventDefault();
      if (isAllowedExternalUrl(targetUrl)) {
        void shell.openExternal(targetUrl);
      }
    });
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  if (verboseLoggingEnabled) {
    const logRenderer = (message: string, details?: unknown) => {
      const force =
        typeof details === "object" &&
        details !== null &&
        "level" in details &&
        typeof (details as { level?: unknown }).level === "number" &&
        ((details as { level: number }).level >= 2 ||
          (typeof (details as { message?: unknown }).message === "string" &&
            String((details as { message?: unknown }).message).includes("[codetrail]")));
      writeDebugLog(message, details, force ? { force: true } : undefined);
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

  const rendererUrl = resolveDevRendererUrlFromEnv();
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
      await bootstrapMainProcess({
        appStateStore,
        onIndexingFileIssue: (issue) => {
          logAppError("indexing file failure", issue.error, {
            provider: issue.provider,
            sessionId: issue.sessionId,
            filePath: issue.filePath,
            stage: issue.stage,
          });
        },
        onIndexingNotice: (notice) => {
          logIndexingNotice("indexing notice", {
            provider: notice.provider,
            sessionId: notice.sessionId,
            filePath: notice.filePath,
            stage: notice.stage,
            severity: notice.severity,
            code: notice.code,
            message: notice.message,
            ...(notice.details ? { details: notice.details } : {}),
          });
        },
        onBackgroundError: (message, error, details) => {
          logAppError(message, error, details);
        },
      });
      writeDebugLog("bootstrapMainProcess success");
      mainWindowRef = createWindow(appStateStore);
      writeDebugLog("createWindow success");
    } catch (error) {
      logAppError("bootstrap failure", error);
      app.exit(1);
      return;
    }

    let shuttingDown = false;
    app.on("before-quit", (event) => {
      writeDebugLog("before-quit");
      appStateStore.flush();
      if (!shuttingDown) {
        shuttingDown = true;
        event.preventDefault();
        shutdownMainProcess().finally(() => {
          app.quit();
        });
      }
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

process.on("uncaughtException", (error) => {
  logAppError("uncaught exception", error);
});

process.on("unhandledRejection", (reason) => {
  logAppError("unhandled rejection", reason);
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

function resolveDevRendererUrlFromEnv(): string | null {
  const rawUrl = process.env.CODETRAIL_RENDERER_URL?.trim();
  if (!rawUrl) {
    return null;
  }
  if (app.isPackaged) {
    console.warn("[codetrail] ignoring CODETRAIL_RENDERER_URL in packaged build");
    return null;
  }
  if (!isAllowedDevRendererUrl(rawUrl)) {
    console.warn("[codetrail] ignoring unsafe CODETRAIL_RENDERER_URL", rawUrl);
    return null;
  }
  return rawUrl;
}

function isAllowedDevRendererUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    const isLocalhost =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    return isHttp && isLocalhost;
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

function normalizeNavigationUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

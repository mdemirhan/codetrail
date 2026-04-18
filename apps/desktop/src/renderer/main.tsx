import type { IpcResponse } from "@codetrail/core/browser";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/500.css";
import "@fontsource/lexend/600.css";
import "@fontsource/lexend/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";

import { type ThemeMode, resolveShikiThemeForUiTheme } from "../shared/uiPreferences";
import "./styles.css";
import { getCodetrailClient, isMissingCodetrailClient } from "./lib/codetrailClient";
import { applyDocumentAppearance } from "./lib/theme";

function requireRootElement(): HTMLElement {
  const element = document.getElementById("root");
  if (!element) {
    throw new Error("Missing root element");
  }
  return element;
}

const rootElement = requireRootElement();

if (navigator.userAgent.includes("Mac")) {
  document.body.classList.add("platform-macos");
}

function formatBootError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function showBootFailure(title: string, details: unknown): void {
  const body = document.body;
  body.innerHTML = "";
  const container = document.createElement("main");
  container.style.padding = "24px";
  container.style.fontFamily =
    '"JetBrains Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
  container.style.lineHeight = "1.4";
  const heading = document.createElement("h1");
  heading.textContent = title;
  heading.style.marginTop = "0";
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.padding = "12px";
  pre.style.border = "1px solid #999";
  pre.style.borderRadius = "6px";
  pre.style.background = "#f7f7f7";
  pre.textContent = formatBootError(details);
  container.append(heading, pre);
  body.appendChild(container);
}

function applyInitialTheme(
  theme: ThemeMode,
  darkShikiTheme?: string | null,
  lightShikiTheme?: string | null,
): void {
  applyDocumentAppearance(
    theme,
    resolveShikiThemeForUiTheme(theme, darkShikiTheme, lightShikiTheme),
  );
  try {
    window.localStorage.setItem("codetrail-theme", theme);
  } catch {
    // Ignore storage errors at bootstrap.
  }
}

window.addEventListener("error", (event) => {
  console.error("[codetrail] renderer window error", event.error ?? event.message);
  showBootFailure("Renderer Window Error", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[codetrail] renderer unhandled rejection", event.reason);
  showBootFailure("Renderer Unhandled Rejection", event.reason);
});

async function bootRenderer(): Promise<void> {
  try {
    const codetrail = getCodetrailClient();
    if (isMissingCodetrailClient(codetrail)) {
      showBootFailure(
        "Preload Bridge Unavailable",
        "The renderer could not access window.codetrail. Check preload loading and context isolation setup.",
      );
      return;
    }
    const initialPaneStatePromise: Promise<
      (IpcResponse<"ui:getPaneState"> & IpcResponse<"indexer:getConfig">) | null
    > = Promise.all([
      codetrail.invoke("ui:getPaneState", {}),
      codetrail.invoke("indexer:getConfig", {}),
    ])
      .then(([paneState, indexerConfig]) => ({
        ...paneState,
        ...indexerConfig,
      }))
      .catch((error: unknown) => {
        console.error("[codetrail] failed loading initial ui state", error);
        return null;
      });
    const [{ AppErrorBoundary }, initialPaneState, { App }] = await Promise.all([
      import("./AppErrorBoundary"),
      initialPaneStatePromise,
      import("./App"),
    ]);
    applyInitialTheme(
      initialPaneState?.theme ?? "dark",
      initialPaneState?.darkShikiTheme ?? null,
      initialPaneState?.lightShikiTheme ?? null,
    );
    const appTree = (
      <AppErrorBoundary>
        <App initialPaneState={initialPaneState} />
      </AppErrorBoundary>
    );
    createRoot(rootElement).render(
      __CODETRAIL_RENDERER_DEV__ ? <StrictMode>{appTree}</StrictMode> : appTree,
    );
  } catch (error) {
    console.error("[codetrail] renderer bootstrap failed", error);
    showBootFailure("Renderer Bootstrap Failed", error);
  }
}

void bootRenderer();

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";

import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element");
}
const mountElement = rootElement;

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
    const [{ App }, { AppErrorBoundary }] = await Promise.all([
      import("./App"),
      import("./AppErrorBoundary"),
    ]);
    createRoot(mountElement).render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>,
    );
  } catch (error) {
    console.error("[codetrail] renderer bootstrap failed", error);
    showBootFailure("Renderer Bootstrap Failed", error);
  }
}

void bootRenderer();

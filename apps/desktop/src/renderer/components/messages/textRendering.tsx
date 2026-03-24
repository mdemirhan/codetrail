import {
  Children,
  Fragment,
  type ReactNode,
  cloneElement,
  isValidElement,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createHighlighter } from "shiki";

import { buildSearchHighlightRegex } from "@codetrail/core/browser";
import {
  type ExternalToolConfig,
  getDefaultShikiThemeForUiTheme,
  getThemeFamily,
  resolveShikiThemeForUiTheme,
} from "../../../shared/uiPreferences";
import { copyTextToClipboard } from "../../lib/clipboard";
import { getCodetrailClient } from "../../lib/codetrailClient";
import { PANE_STATE_UPDATED_EVENT, type PaneStateUpdatedDetail } from "../../lib/paneStateEvents";
import {
  listAvailableEditors,
  openContentInEditor,
  openDiffInEditor,
  openFileInEditor,
  openPath,
} from "../../lib/pathActions";
import {
  type ViewerExternalAppsSnapshot,
  type ViewerToolPreferences,
  useViewerExternalAppsContext,
} from "../../lib/viewerExternalAppsContext";
import {
  APPROX_ROW_HEIGHT,
  DIFF_VIRTUALIZE_ROW_COUNT,
  EXPAND_LINES_STEP,
  INITIAL_EXPANDED_LINES,
  INLINE_FALLBACK_SYNTAX_LINE_LIMIT,
  VIRTUALIZE_ROW_COUNT,
} from "./viewerConfig";
import {
  type ViewerKind,
  analyzeTextContent,
  detectLanguageFromFilePath,
  detectViewerKind,
  getContentSummary,
  shouldProgressivelyRender,
} from "./viewerDetection";
import {
  buildDiffRenderSource,
  buildDiffViewModel,
  trimProjectPrefixFromPath,
} from "./viewerDiffModel";

const EMPTY_KEYWORDS = new Set<string>();
const JS_KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "class",
  "extends",
  "new",
  "import",
  "from",
  "export",
  "default",
  "async",
  "await",
  "try",
  "catch",
  "finally",
  "throw",
  "type",
  "interface",
]);
const PYTHON_KEYWORDS = new Set([
  "def",
  "class",
  "if",
  "elif",
  "else",
  "for",
  "while",
  "return",
  "import",
  "from",
  "as",
  "try",
  "except",
  "finally",
  "with",
  "lambda",
  "pass",
  "raise",
  "yield",
  "async",
  "await",
]);
const SQL_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "ON",
  "GROUP",
  "BY",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "INSERT",
  "UPDATE",
  "DELETE",
  "INTO",
  "VALUES",
  "AND",
  "OR",
  "NOT",
  "AS",
]);
const JSON_KEYWORDS = new Set(["true", "false", "null"]);
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "fi",
  "for",
  "in",
  "do",
  "done",
  "case",
  "esac",
]);
const LANGUAGE_KEYWORDS: Record<string, Set<string>> = {
  js: JS_KEYWORDS,
  jsx: JS_KEYWORDS,
  ts: JS_KEYWORDS,
  tsx: JS_KEYWORDS,
  javascript: JS_KEYWORDS,
  typescript: JS_KEYWORDS,
  py: PYTHON_KEYWORDS,
  python: PYTHON_KEYWORDS,
  sql: SQL_KEYWORDS,
  json: JSON_KEYWORDS,
  bash: SHELL_KEYWORDS,
  sh: SHELL_KEYWORDS,
  zsh: SHELL_KEYWORDS,
  shell: SHELL_KEYWORDS,
};
const HIGHLIGHT_REGEX_CACHE_LIMIT = 64;
const highlightRegexCache = new Map<string, RegExp | null>();
const MARKDOWN_COMPONENTS_CACHE_LIMIT = 32;
const markdownComponentsCache = new Map<string, Components>();
const SHIKI_TOKEN_CACHE_LIMIT = 48;
const shikiHighlighterPromises = new Map<
  string,
  Promise<Awaited<ReturnType<typeof createHighlighter>>>
>();
let availableEditorsPromise: Promise<Awaited<ReturnType<typeof listAvailableEditors>>> | null =
  null;
let availableEditorsPromiseKey = "";
let paneStatePromise: Promise<{
  preferredExternalEditor: string | null;
  preferredExternalDiffTool: string | null;
  terminalAppCommand: string;
  orderedToolIds: string[];
  externalTools: ExternalToolConfig[];
}> | null = null;

type EditorInfo = Awaited<ReturnType<typeof listAvailableEditors>>["editors"][number];
type ShikiTokenLine = Array<{ content: string; color?: string; fontStyle?: number }>;

const defaultViewerExternalAppsSnapshot: ViewerExternalAppsSnapshot = {
  editors: [],
  diffTools: [],
  preferences: {
    preferredExternalEditor: null,
    preferredExternalDiffTool: null,
    terminalAppCommand: "",
    orderedToolIds: [],
    externalTools: [],
  },
};

const viewerExternalAppsStore = {
  snapshot: defaultViewerExternalAppsSnapshot,
  listeners: new Set<() => void>(),
  promise: null as Promise<void> | null,
  unsubscribePaneState: null as (() => void) | null,
};

const themeVariantStore = {
  current: getCurrentThemeVariant(),
  shikiTheme: getCurrentShikiTheme(),
  defaultViewerWrapMode: getCurrentDefaultViewerWrapMode(),
  defaultDiffViewMode: getCurrentDefaultDiffViewMode(),
  listeners: new Set<() => void>(),
  observer: null as MutationObserver | null,
};

const tokenLineCache = new Map<
  string,
  {
    value: ShikiTokenLine[] | null | undefined;
    pending: Promise<ShikiTokenLine[] | null> | null;
  }
>();

export function resetContentViewerCachesForTests(): void {
  shikiHighlighterPromises.clear();
  availableEditorsPromise = null;
  paneStatePromise = null;
  viewerExternalAppsStore.unsubscribePaneState?.();
  viewerExternalAppsStore.unsubscribePaneState = null;
  viewerExternalAppsStore.snapshot = defaultViewerExternalAppsSnapshot;
  viewerExternalAppsStore.promise = null;
  themeVariantStore.current = getCurrentThemeVariant();
  themeVariantStore.shikiTheme = getCurrentShikiTheme();
  themeVariantStore.defaultViewerWrapMode = getCurrentDefaultViewerWrapMode();
  themeVariantStore.defaultDiffViewMode = getCurrentDefaultDiffViewMode();
  tokenLineCache.clear();
}

function resolveViewerShikiThemes(themeVariant: string, shikiTheme: string) {
  const defaultTheme = getDefaultShikiThemeForUiTheme(
    themeVariant as Parameters<typeof getDefaultShikiThemeForUiTheme>[0],
  );
  const family = getThemeFamily(
    themeVariant as Parameters<typeof getDefaultShikiThemeForUiTheme>[0],
  );
  const selectedTheme = resolveShikiThemeForUiTheme(
    themeVariant as Parameters<typeof resolveShikiThemeForUiTheme>[0],
    family === "dark" ? shikiTheme : null,
    family === "light" ? shikiTheme : null,
  );
  return {
    defaultTheme,
    selectedTheme,
    themes: [...new Set([defaultTheme, selectedTheme])],
  };
}

async function getShikiHighlighter(themeVariant: string, shikiTheme: string) {
  const { themes } = resolveViewerShikiThemes(themeVariant, shikiTheme);
  const cacheKey = themes.join("\u0000");
  const existing = shikiHighlighterPromises.get(cacheKey);
  if (existing) {
    return existing;
  }
  const pending = createHighlighter({
    themes,
    langs: [
      "plaintext",
      "javascript",
      "jsx",
      "typescript",
      "tsx",
      "json",
      "bash",
      "python",
      "sql",
      "html",
      "css",
      "markdown",
    ],
  });
  shikiHighlighterPromises.set(cacheKey, pending);
  return pending;
}

function getCurrentThemeVariant(): string {
  if (typeof document === "undefined") {
    return "light";
  }
  return (
    document.documentElement.dataset.themeVariant ??
    document.documentElement.dataset.theme ??
    "light"
  );
}

function getCurrentShikiTheme(): string {
  if (typeof document === "undefined") {
    return getDefaultShikiThemeForUiTheme("light");
  }
  const theme = (document.documentElement.dataset.themeVariant ??
    document.documentElement.dataset.theme ??
    "light") as Parameters<typeof getDefaultShikiThemeForUiTheme>[0];
  const activeTheme = document.documentElement.dataset.shikiTheme;
  const family = getThemeFamily(theme);
  return resolveShikiThemeForUiTheme(
    theme,
    family === "dark" ? activeTheme : null,
    family === "light" ? activeTheme : null,
  );
}

function getCurrentDefaultViewerWrapMode(): "nowrap" | "wrap" {
  if (typeof document === "undefined") {
    return "nowrap";
  }
  return document.documentElement.dataset.defaultViewerWrapMode === "wrap" ? "wrap" : "nowrap";
}

function getCurrentDefaultDiffViewMode(): "unified" | "split" {
  if (typeof document === "undefined") {
    return "unified";
  }
  return document.documentElement.dataset.defaultDiffViewMode === "split" ? "split" : "unified";
}

function emitViewerExternalAppsStore(): void {
  for (const listener of viewerExternalAppsStore.listeners) {
    listener();
  }
}

function refreshViewerExternalApps(): void {
  availableEditorsPromise = null;
  availableEditorsPromiseKey = "";
  paneStatePromise = null;
  viewerExternalAppsStore.promise = null;
  ensureViewerExternalAppsLoaded();
}

function emitThemeVariantStore(): void {
  for (const listener of themeVariantStore.listeners) {
    listener();
  }
}

function ensureThemeVariantObserver(): void {
  if (typeof document === "undefined" || themeVariantStore.observer) {
    return;
  }
  themeVariantStore.current = getCurrentThemeVariant();
  themeVariantStore.shikiTheme = getCurrentShikiTheme();
  themeVariantStore.defaultViewerWrapMode = getCurrentDefaultViewerWrapMode();
  themeVariantStore.defaultDiffViewMode = getCurrentDefaultDiffViewMode();
  themeVariantStore.observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (mutation) =>
          mutation.type === "attributes" &&
          (mutation.attributeName === "data-theme" ||
            mutation.attributeName === "data-theme-variant" ||
            mutation.attributeName === "data-shiki-theme" ||
            mutation.attributeName === "data-default-viewer-wrap-mode" ||
            mutation.attributeName === "data-default-diff-view-mode"),
      )
    ) {
      const next = getCurrentThemeVariant();
      const nextShikiTheme = getCurrentShikiTheme();
      const nextViewerWrapMode = getCurrentDefaultViewerWrapMode();
      const nextDiffViewMode = getCurrentDefaultDiffViewMode();
      if (
        next !== themeVariantStore.current ||
        nextShikiTheme !== themeVariantStore.shikiTheme ||
        nextViewerWrapMode !== themeVariantStore.defaultViewerWrapMode ||
        nextDiffViewMode !== themeVariantStore.defaultDiffViewMode
      ) {
        themeVariantStore.current = next;
        themeVariantStore.shikiTheme = nextShikiTheme;
        themeVariantStore.defaultViewerWrapMode = nextViewerWrapMode;
        themeVariantStore.defaultDiffViewMode = nextDiffViewMode;
        emitThemeVariantStore();
      }
    }
  });
  themeVariantStore.observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "data-theme",
      "data-theme-variant",
      "data-shiki-theme",
      "data-default-viewer-wrap-mode",
      "data-default-diff-view-mode",
    ],
  });
}

function subscribeToThemeVariant(listener: () => void): () => void {
  ensureThemeVariantObserver();
  themeVariantStore.listeners.add(listener);
  return () => {
    themeVariantStore.listeners.delete(listener);
  };
}

function useDocumentThemeVariant(): string {
  return useSyncExternalStore(
    subscribeToThemeVariant,
    () => themeVariantStore.current,
    () => "light",
  );
}

function useDocumentShikiTheme(): string {
  return useSyncExternalStore(
    subscribeToThemeVariant,
    () => themeVariantStore.shikiTheme,
    () => getDefaultShikiThemeForUiTheme("light"),
  );
}

function useDocumentDefaultViewerWrapMode(): "nowrap" | "wrap" {
  return useSyncExternalStore(
    subscribeToThemeVariant,
    () => themeVariantStore.defaultViewerWrapMode,
    () => "nowrap",
  );
}

function useDocumentDefaultDiffViewMode(): "unified" | "split" {
  return useSyncExternalStore(
    subscribeToThemeVariant,
    () => themeVariantStore.defaultDiffViewMode,
    () => "unified",
  );
}

function getCurrentThemeBase(): "light" | "dark" {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function normalizeShikiLanguage(language: string): string {
  switch (language) {
    case "shell":
    case "sh":
    case "zsh":
      return "bash";
    case "javascript":
    case "js":
      return "javascript";
    case "jsx":
      return "jsx";
    case "typescript":
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "python":
    case "py":
      return "python";
    case "sql":
      return "sql";
    case "html":
      return "html";
    case "css":
      return "css";
    case "markdown":
    case "md":
      return "markdown";
    default:
      return "text";
  }
}

function getThemeCssColor(variableName: string, fallback: string): string {
  if (typeof document === "undefined") {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value.length > 0 ? value : fallback;
}

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

type RgbColor = { r: number; g: number; b: number };

function parseHexColor(value: string): RgbColor | null {
  const normalized = value.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(normalized);
  if (!match) {
    return null;
  }
  const hex = match[1] ?? "";
  if (hex.length === 3) {
    return {
      r: Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      g: Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      b: Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    };
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function formatHexColor(color: RgbColor): string {
  const toHex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function mixColors(source: RgbColor, target: RgbColor, ratio: number): RgbColor {
  return {
    r: source.r + (target.r - source.r) * ratio,
    g: source.g + (target.g - source.g) * ratio,
    b: source.b + (target.b - source.b) * ratio,
  };
}

function toLinearChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbColor): number {
  return (
    0.2126 * toLinearChannel(color.r) +
    0.7152 * toLinearChannel(color.g) +
    0.0722 * toLinearChannel(color.b)
  );
}

function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function normalizeTokenColorForContrast(
  color: string,
  backgroundColor: string,
  anchorColor: string,
  minContrast = 4.2,
): string {
  const foreground = parseHexColor(color);
  const background = parseHexColor(backgroundColor);
  const anchor = parseHexColor(anchorColor);
  if (!foreground || !background || !anchor) {
    return color;
  }
  if (contrastRatio(foreground, background) >= minContrast) {
    return color;
  }

  let best = foreground;
  for (let step = 1; step <= 10; step += 1) {
    const candidate = mixColors(foreground, anchor, step / 10);
    best = candidate;
    if (contrastRatio(candidate, background) >= minContrast) {
      return formatHexColor(candidate);
    }
  }

  return formatHexColor(best);
}

function useTokenColorResolver(): (color: string | undefined) => string | undefined {
  const themeVariant = useDocumentThemeVariant();
  return useMemo(() => {
    if (getThemeFamily(themeVariant as Parameters<typeof getThemeFamily>[0]) !== "light") {
      return (color: string | undefined) => color;
    }
    const backgroundColor = getThemeCssColor("--code-bg", "#fafbfe");
    const anchorColor = getThemeCssColor("--text-primary", "#1a1c24");
    return (color: string | undefined) =>
      color ? normalizeTokenColorForContrast(color, backgroundColor, anchorColor) : color;
  }, [themeVariant]);
}

function getExternalToolsCacheKey(externalTools: ExternalToolConfig[]): string {
  return JSON.stringify(
    externalTools.map((tool) => ({
      id: tool.id,
      kind: tool.kind,
      label: tool.label,
      appId: tool.appId,
      command: tool.command,
      editorArgs: tool.editorArgs,
      diffArgs: tool.diffArgs,
      enabledForEditor: tool.enabledForEditor,
      enabledForDiff: tool.enabledForDiff,
    })),
  );
}

async function getCachedAvailableEditors(externalTools: ExternalToolConfig[]) {
  const cacheKey = getExternalToolsCacheKey(externalTools);
  if (!availableEditorsPromise || availableEditorsPromiseKey !== cacheKey) {
    availableEditorsPromiseKey = cacheKey;
    availableEditorsPromise = listAvailableEditors({
      externalTools,
    }).catch(() => ({ editors: [], diffTools: [] }));
  }
  return availableEditorsPromise;
}

async function getCachedViewerToolPreferences(): Promise<ViewerToolPreferences> {
  if (!paneStatePromise) {
    paneStatePromise = getCodetrailClient()
      .invoke("ui:getPaneState", {})
      .then((paneState) => ({
        preferredExternalEditor: paneState.preferredExternalEditor,
        preferredExternalDiffTool: paneState.preferredExternalDiffTool,
        terminalAppCommand:
          typeof paneState.terminalAppCommand === "string" ? paneState.terminalAppCommand : "",
        orderedToolIds: Array.isArray(paneState.externalTools)
          ? paneState.externalTools.map((tool) => tool.id)
          : [],
        externalTools: Array.isArray(paneState.externalTools) ? paneState.externalTools : [],
      }))
      .catch(() => ({
        preferredExternalEditor: null,
        preferredExternalDiffTool: null,
        terminalAppCommand: "",
        orderedToolIds: [],
        externalTools: [],
      }));
  }
  return paneStatePromise;
}

function ensureViewerExternalAppsLoaded(): void {
  if (viewerExternalAppsStore.promise) {
    return;
  }
  viewerExternalAppsStore.promise = getCachedViewerToolPreferences()
    .then(async (nextPreferences) => {
      const nextTools = await getCachedAvailableEditors(nextPreferences.externalTools);
      viewerExternalAppsStore.snapshot = {
        editors: nextTools.editors,
        diffTools: nextTools.diffTools,
        preferences: nextPreferences,
      };
      emitViewerExternalAppsStore();
    })
    .catch(() => {
      viewerExternalAppsStore.snapshot = {
        ...viewerExternalAppsStore.snapshot,
        editors: [],
        diffTools: [],
      };
      emitViewerExternalAppsStore();
    })
    .finally(() => {
      viewerExternalAppsStore.promise = null;
    });
}

function ensureViewerExternalAppsPaneStateSubscription(): void {
  if (viewerExternalAppsStore.unsubscribePaneState || typeof window === "undefined") {
    return;
  }

  const handlePaneStateUpdated = (event: Event) => {
    const detail = (event as CustomEvent<PaneStateUpdatedDetail>).detail;
    if (detail) {
      viewerExternalAppsStore.snapshot = {
        ...viewerExternalAppsStore.snapshot,
        preferences: {
          preferredExternalEditor: detail.preferredExternalEditor,
          preferredExternalDiffTool: detail.preferredExternalDiffTool,
          terminalAppCommand: detail.terminalAppCommand,
          orderedToolIds: detail.externalTools.map((tool) => tool.id),
          externalTools: detail.externalTools,
        },
      };
      emitViewerExternalAppsStore();
    }
    refreshViewerExternalApps();
  };

  window.addEventListener(PANE_STATE_UPDATED_EVENT, handlePaneStateUpdated as EventListener);
  viewerExternalAppsStore.unsubscribePaneState = () => {
    window.removeEventListener(PANE_STATE_UPDATED_EVENT, handlePaneStateUpdated as EventListener);
  };
}

function subscribeToViewerExternalApps(listener: () => void): () => void {
  viewerExternalAppsStore.listeners.add(listener);
  ensureViewerExternalAppsPaneStateSubscription();
  ensureViewerExternalAppsLoaded();
  return () => {
    viewerExternalAppsStore.listeners.delete(listener);
    if (
      viewerExternalAppsStore.listeners.size === 0 &&
      viewerExternalAppsStore.unsubscribePaneState
    ) {
      viewerExternalAppsStore.unsubscribePaneState();
      viewerExternalAppsStore.unsubscribePaneState = null;
    }
  };
}

function useViewerExternalApps() {
  const contextSnapshot = useViewerExternalAppsContext();
  useEffect(() => {
    if (!contextSnapshot) {
      ensureViewerExternalAppsLoaded();
    }
  }, [contextSnapshot]);
  const fallbackSnapshot = useSyncExternalStore(
    contextSnapshot ? () => () => undefined : subscribeToViewerExternalApps,
    () => contextSnapshot ?? viewerExternalAppsStore.snapshot,
    () => contextSnapshot ?? defaultViewerExternalAppsSnapshot,
  );
  return contextSnapshot ?? fallbackSnapshot;
}

function getShikiTokenCacheKey(shikiTheme: string, language: string, codeValue: string): string {
  return `${shikiTheme}\u0000${language}\u0000${codeValue.length}\u0000${hashText(codeValue)}`;
}

function getCachedTokenLines(cacheKey: string): ShikiTokenLine[] | null | undefined {
  return tokenLineCache.get(cacheKey)?.value;
}

async function loadShikiTokenLines(
  cacheKey: string,
  themeVariant: string,
  shikiTheme: string,
  normalizedLanguage: string,
  codeValue: string,
): Promise<ShikiTokenLine[] | null> {
  const existing = tokenLineCache.get(cacheKey);
  if (existing?.value !== undefined) {
    return existing.value;
  }
  if (existing?.pending) {
    return existing.pending;
  }

  const pending = getShikiHighlighter(themeVariant, shikiTheme)
    .then(async (highlighter) => {
      const { defaultTheme, selectedTheme } = resolveViewerShikiThemes(themeVariant, shikiTheme);
      try {
        return (await highlighter.codeToTokens(codeValue, {
          lang: normalizedLanguage as never,
          theme: selectedTheme,
        })) as unknown;
      } catch {
        return (await highlighter.codeToTokens(codeValue, {
          lang: normalizedLanguage as never,
          theme: defaultTheme,
        })) as unknown;
      }
    })
    .then((tokensResult) => {
      const tokens = Array.isArray(tokensResult)
        ? tokensResult
        : ((
            tokensResult as {
              tokens?: Array<Array<{ content: string; color?: string; fontStyle?: number }>>;
            }
          ).tokens ?? null);
      tokenLineCache.set(cacheKey, { value: tokens, pending: null });
      if (tokenLineCache.size > SHIKI_TOKEN_CACHE_LIMIT) {
        const oldestKey = tokenLineCache.keys().next().value;
        if (typeof oldestKey === "string") {
          tokenLineCache.delete(oldestKey);
        }
      }
      return tokens;
    })
    .catch(() => {
      tokenLineCache.set(cacheKey, { value: null, pending: null });
      return null;
    });

  tokenLineCache.set(cacheKey, { value: undefined, pending });
  return pending;
}

function useShikiTokenLines(language: string, codeValue: string, enabled = true) {
  const themeVariant = useDocumentThemeVariant();
  const shikiTheme = useDocumentShikiTheme();
  const normalizedLanguage = normalizeShikiLanguage(language);
  const cacheKey =
    enabled && normalizedLanguage !== "text" && codeValue.length > 0
      ? getShikiTokenCacheKey(shikiTheme, normalizedLanguage, codeValue)
      : null;
  const [tokenLines, setTokenLines] = useState<ShikiTokenLine[] | null>(() =>
    cacheKey ? (getCachedTokenLines(cacheKey) ?? null) : null,
  );

  useEffect(() => {
    if (!enabled || normalizedLanguage === "text" || codeValue.length === 0 || !cacheKey) {
      setTokenLines(null);
      return;
    }
    const cached = getCachedTokenLines(cacheKey);
    if (cached !== undefined) {
      setTokenLines(cached);
      return;
    }
    let cancelled = false;
    void loadShikiTokenLines(
      cacheKey,
      themeVariant,
      shikiTheme,
      normalizedLanguage,
      codeValue,
    ).then((tokens) => {
      if (!cancelled) {
        startTransition(() => {
          setTokenLines(tokens);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, codeValue, enabled, normalizedLanguage, shikiTheme, themeVariant]);

  return tokenLines;
}

function renderInlineDiffParts(
  parts: Array<{ text: string; changed: boolean }>,
  className: string,
  lineKey: string,
): ReactNode[] {
  let cursor = 0;
  return parts.map((part) => {
    const key = `${lineKey}:${cursor}:${part.changed ? "1" : "0"}`;
    cursor += part.text.length;
    return (
      <span key={key} className={part.changed ? className : undefined}>
        {part.text}
      </span>
    );
  });
}

function normalizeBadgeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function getEnabledAppsForRole(editors: EditorInfo[]): EditorInfo[] {
  return editors.filter((editor) => editor.detected);
}

function sortAppsByPreferenceOrder(
  apps: EditorInfo[],
  preferences: ViewerToolPreferences,
): EditorInfo[] {
  if (preferences.orderedToolIds.length === 0) {
    return apps;
  }
  const indexById = new Map(preferences.orderedToolIds.map((id, index) => [id, index]));
  return [...apps].sort((left, right) => {
    const leftIndex = indexById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = indexById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.label.localeCompare(right.label);
  });
}

function getPreferredAppId(
  preferences: ViewerToolPreferences,
  role: "editor" | "diff",
): string | null {
  return role === "diff"
    ? preferences.preferredExternalDiffTool
    : preferences.preferredExternalEditor;
}

function pickDefaultApp(
  editors: EditorInfo[],
  preferences: ViewerToolPreferences,
  role: "editor" | "diff",
): EditorInfo | null {
  const candidates = getEnabledAppsForRole(editors);
  if (candidates.length === 0) {
    return null;
  }
  const preferredId = getPreferredAppId(preferences, role);
  return candidates.find((editor) => editor.id === preferredId) ?? candidates[0] ?? null;
}

function buildEditorOpenStateOverride(preferences: ViewerToolPreferences) {
  return {
    ...(preferences.preferredExternalEditor
      ? { preferredExternalEditor: preferences.preferredExternalEditor }
      : {}),
    ...(preferences.preferredExternalDiffTool
      ? { preferredExternalDiffTool: preferences.preferredExternalDiffTool }
      : {}),
    ...(preferences.terminalAppCommand !== undefined
      ? { terminalAppCommand: preferences.terminalAppCommand }
      : {}),
    ...(preferences.externalTools.length > 0 ? { externalTools: preferences.externalTools } : {}),
  };
}

function ContentViewer({
  kind,
  language,
  codeValue,
  metaLabel,
  filePath,
  pathRoots = [],
  query = "",
  highlightPatterns = [],
  startLine,
}: {
  kind: ViewerKind;
  language: string;
  codeValue: string;
  metaLabel?: string;
  filePath?: string | null;
  pathRoots?: string[];
  query?: string;
  highlightPatterns?: string[];
  startLine?: number;
}) {
  const { editors, diffTools, preferences } = useViewerExternalApps();
  const tokenColorResolver = useTokenColorResolver();
  const defaultViewerWrapMode = useDocumentDefaultViewerWrapMode();
  const defaultDiffViewMode = useDocumentDefaultDiffViewMode();
  const [wrap, setWrap] = useState(defaultViewerWrapMode === "wrap");
  const [diffMode, setDiffMode] = useState<"unified" | "split">(defaultDiffViewMode);
  const diffModel = useMemo(
    () => (kind === "diff" ? buildDiffViewModel(codeValue, filePath, pathRoots) : null),
    [codeValue, filePath, kind, pathRoots],
  );
  const absoluteFilePath = diffModel?.absoluteFilePath ?? (filePath ? toLocalPath(filePath) : null);
  const syntaxLanguage = kind === "diff" ? (diffModel?.sourceLanguage ?? language) : language;
  const textAnalysis = useMemo(() => analyzeTextContent(codeValue), [codeValue]);
  const totalLines = kind === "diff" ? (diffModel?.rows.length ?? 0) : textAnalysis.totalLines;
  const isLarge =
    kind === "diff" ? shouldProgressivelyRender(codeValue, totalLines) : textAnalysis.isLarge;
  const allowFallbackSyntax = !isLarge && totalLines <= INLINE_FALLBACK_SYNTAX_LINE_LIMIT;
  const highlightActive = query.trim().length > 0 || highlightPatterns.length > 0;
  const [visibleCount, setVisibleCount] = useState(
    isLarge ? Math.min(totalLines, INITIAL_EXPANDED_LINES) : totalLines,
  );
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    setWrap(defaultViewerWrapMode === "wrap");
  }, [defaultViewerWrapMode]);

  useEffect(() => {
    setDiffMode(defaultDiffViewMode);
  }, [defaultDiffViewMode]);

  useEffect(() => {
    setVisibleCount(isLarge ? Math.min(totalLines, INITIAL_EXPANDED_LINES) : totalLines);
  }, [isLarge, totalLines]);

  const visibleCodeValue = useMemo(
    () => textAnalysis.lineValues.slice(0, visibleCount).join("\n"),
    [textAnalysis.lineValues, visibleCount],
  );
  const diffRenderSource = useMemo(
    () => buildDiffRenderSource(diffModel, diffMode, visibleCount),
    [diffModel, diffMode, visibleCount],
  );
  const tokenLines = useShikiTokenLines(
    syntaxLanguage,
    visibleCodeValue,
    kind !== "diff" && !highlightActive,
  );
  const diffUnifiedTokenLines = useShikiTokenLines(
    syntaxLanguage,
    diffRenderSource.unified,
    kind === "diff" && diffMode === "unified" && !highlightActive,
  );
  const diffSplitLeftTokenLines = useShikiTokenLines(
    syntaxLanguage,
    diffRenderSource.splitLeft,
    kind === "diff" && diffMode === "split" && !highlightActive,
  );
  const diffSplitRightTokenLines = useShikiTokenLines(
    syntaxLanguage,
    diffRenderSource.splitRight,
    kind === "diff" && diffMode === "split" && !highlightActive,
  );

  const canReveal =
    absoluteFilePath !== null && isPathUnderProjectRoots(absoluteFilePath, pathRoots);
  const sortedEditors = useMemo(
    () => sortAppsByPreferenceOrder(editors, preferences),
    [editors, preferences],
  );
  const sortedDiffTools = useMemo(
    () => sortAppsByPreferenceOrder(diffTools, preferences),
    [diffTools, preferences],
  );
  const editorApps = useMemo(() => getEnabledAppsForRole(sortedEditors), [sortedEditors]);
  const diffApps = useMemo(() => getEnabledAppsForRole(sortedDiffTools), [sortedDiffTools]);
  const defaultEditorApp = useMemo(
    () => pickDefaultApp(sortedEditors, preferences, "editor"),
    [sortedEditors, preferences],
  );
  const canOpenFile =
    kind === "diff"
      ? absoluteFilePath !== null
      : absoluteFilePath !== null || editorApps.some((editor) => editor.capabilities.openContent);
  const canOpenDiff = kind === "diff" && diffApps.length > 0;
  const canOpenViewerContent = kind !== "diff" && canOpenFile;
  const editorOpenStateOverride = useMemo(
    () => buildEditorOpenStateOverride(preferences),
    [preferences],
  );
  const metaPath = metaLabel?.trim() ? metaLabel.trim() : (diffModel?.displayFilePath ?? null);
  const normalizedKind = normalizeBadgeLabel(kind);
  const normalizedLanguage = normalizeBadgeLabel(language);
  const showLanguageBadge =
    normalizedLanguage.length > 0 &&
    kind !== "plain" &&
    kind !== "log" &&
    normalizedLanguage !== normalizedKind;
  const showMetaPath =
    metaPath !== null &&
    metaPath.length > 0 &&
    normalizeBadgeLabel(metaPath) !== normalizedKind &&
    normalizeBadgeLabel(metaPath) !== normalizedLanguage;
  const displayedMetaPath = showMetaPath ? metaPath : null;

  const buildDiffPayload = () => {
    if (!diffModel) {
      return null;
    }
    const firstRemoved = diffModel.rows.find(
      (row) => row.kind === "remove" || row.kind === "paired",
    );
    const firstAdded = diffModel.rows.find((row) => row.kind === "add" || row.kind === "paired");
    const leftContent = diffModel.rows
      .filter((row) => row.kind !== "add")
      .map((row) =>
        row.kind === "context"
          ? row.text
          : row.kind === "remove"
            ? row.text
            : row.kind === "paired"
              ? row.leftText
              : "",
      )
      .join("\n");
    const rightContent = diffModel.rows
      .filter((row) => row.kind !== "remove")
      .map((row) =>
        row.kind === "context"
          ? row.text
          : row.kind === "add"
            ? row.text
            : row.kind === "paired"
              ? row.rightText
              : "",
      )
      .join("\n");
    const targetLine =
      firstAdded?.kind === "add"
        ? firstAdded.newLine
        : firstAdded?.kind === "paired"
          ? firstAdded.newLine
          : firstRemoved?.kind === "remove"
            ? firstRemoved.oldLine
            : firstRemoved?.kind === "paired"
              ? firstRemoved.oldLine
              : startLine;
    return {
      title: (metaPath ?? diffModel.displayFilePath) || "Diff",
      leftContent,
      rightContent,
      filePath: absoluteFilePath ?? filePath ?? undefined,
      line: targetLine,
    };
  };

  const handleOpenDiff = async (editorId?: EditorInfo["id"]) => {
    if (kind === "diff" && diffModel) {
      const payload = buildDiffPayload();
      if (!payload) {
        return;
      }
      await openDiffInEditor({
        title: payload.title,
        leftContent: payload.leftContent,
        rightContent: payload.rightContent,
        ...editorOpenStateOverride,
        ...(editorId ? { editorId } : {}),
        ...(payload.filePath ? { filePath: payload.filePath } : {}),
        ...(payload.line ? { line: payload.line } : {}),
      });
    }
  };

  const handleOpenFileOrContent = async (editorId?: EditorInfo["id"]) => {
    if (absoluteFilePath) {
      await openFileInEditor(absoluteFilePath, {
        ...editorOpenStateOverride,
        ...(editorId ? { editorId } : {}),
        ...(startLine ? { line: startLine } : {}),
      });
      return;
    }
    await openContentInEditor({
      ...editorOpenStateOverride,
      ...(editorId ? { editorId } : {}),
      title: metaPath ?? "Code",
      content: codeValue,
      ...(filePath ? { filePath } : {}),
      ...(language ? { language } : {}),
      ...(startLine ? { line: startLine } : {}),
    });
  };

  const virtualize = !wrap && kind !== "diff" && totalLines > VIRTUALIZE_ROW_COUNT;
  const visibleLineValues = textAnalysis.lineValues.slice(0, visibleCount);
  const visibleDiffRows = useMemo(
    () => (kind === "diff" && diffModel ? diffModel.rows.slice(0, visibleCount) : []),
    [diffModel, kind, visibleCount],
  );
  const diffVisualOffsets = useMemo(
    () => (kind === "diff" ? buildDiffVisualOffsets(visibleDiffRows, diffMode) : [0]),
    [diffMode, kind, visibleDiffRows],
  );
  const diffVisualRowCount =
    kind === "diff" ? (diffVisualOffsets[diffVisualOffsets.length - 1] ?? 0) : 0;
  const virtualizeDiff = !wrap && kind === "diff" && diffVisualRowCount > DIFF_VIRTUALIZE_ROW_COUNT;
  const viewportRowCount = 40;
  const startIndex = virtualize ? Math.max(0, Math.floor(scrollTop / APPROX_ROW_HEIGHT) - 10) : 0;
  const endIndex = virtualize
    ? Math.min(visibleLineValues.length, startIndex + viewportRowCount + 20)
    : visibleLineValues.length;
  const renderedLineValues = visibleLineValues.slice(startIndex, endIndex);
  const diffStartVisualIndex = virtualizeDiff
    ? Math.max(0, Math.floor(scrollTop / APPROX_ROW_HEIGHT) - 10)
    : 0;
  const diffEndVisualIndex = virtualizeDiff
    ? Math.min(diffVisualRowCount, diffStartVisualIndex + viewportRowCount + 20)
    : diffVisualRowCount;
  const diffRenderStartIndex = virtualizeDiff
    ? findDiffRowIndexByVisualOffset(diffVisualOffsets, diffStartVisualIndex)
    : 0;
  const diffRenderEndIndex = virtualizeDiff
    ? Math.min(
        visibleDiffRows.length,
        findDiffRowIndexByVisualOffset(
          diffVisualOffsets,
          Math.max(diffStartVisualIndex, diffEndVisualIndex - 1),
        ) + 1,
      )
    : visibleDiffRows.length;
  const diffTopSpacerHeight = virtualizeDiff
    ? (diffVisualOffsets[diffRenderStartIndex] ?? 0) * APPROX_ROW_HEIGHT
    : 0;
  const diffBottomSpacerHeight = virtualizeDiff
    ? Math.max(
        0,
        diffVisualRowCount - (diffVisualOffsets[diffRenderEndIndex] ?? diffVisualRowCount),
      ) * APPROX_ROW_HEIGHT
    : 0;

  return (
    <div
      className={`code-block${kind === "diff" ? " diff-block" : ""} content-viewer content-viewer-${kind}${wrap ? " wrap" : ""}`}
    >
      <div className="code-meta content-viewer-header">
        <div className="content-viewer-meta">
          {kind === "diff" ? null : <span className="content-viewer-badge">{kind}</span>}
          {showLanguageBadge ? (
            <span className="content-viewer-badge secondary">{language}</span>
          ) : null}
          {kind === "diff" && diffModel ? (
            <span
              className="content-viewer-diff-counts"
              aria-label={`${diffModel.addedLineCount} added lines and ${diffModel.removedLineCount} removed lines`}
              title={`${diffModel.addedLineCount} added, ${diffModel.removedLineCount} removed`}
            >
              <span className="diff-meta-added">+{diffModel.addedLineCount}</span>
              <span className="diff-meta-removed">-{diffModel.removedLineCount}</span>
            </span>
          ) : null}
          {displayedMetaPath ? (
            <span className="content-viewer-path" title={metaPath ?? undefined}>
              {displayedMetaPath}
            </span>
          ) : null}
        </div>
        <div className="content-viewer-actions">
          {kind === "diff" ? (
            <button
              type="button"
              className={`content-viewer-action message-action-button${
                diffMode === "split" ? " is-active" : ""
              }`}
              title={diffMode === "unified" ? "Unified diff" : "Split diff"}
              onClick={() => setDiffMode((value) => (value === "unified" ? "split" : "unified"))}
            >
              {diffMode === "unified" ? "Unified" : "Split"}
            </button>
          ) : null}
          <button
            type="button"
            className="content-viewer-action message-action-button"
            title={wrap ? "Wrap lines" : "Do not wrap lines"}
            onClick={() => setWrap((value) => !value)}
          >
            {wrap ? "Wrap" : "No Wrap"}
          </button>
          <button
            type="button"
            className="content-viewer-action message-action-button"
            title="Copy content"
            onClick={() => {
              void copyTextToClipboard(codeValue);
            }}
          >
            Copy
          </button>
          {kind === "diff" && canOpenFile ? (
            <button
              type="button"
              className="content-viewer-action message-action-button"
              title="Open in editor"
              onClick={() => void handleOpenFileOrContent(defaultEditorApp?.id)}
            >
              Open
            </button>
          ) : null}
          {kind !== "diff" && canOpenViewerContent ? (
            <button
              type="button"
              className="content-viewer-action message-action-button"
              title="Open in editor"
              onClick={() => void handleOpenFileOrContent()}
            >
              Open
            </button>
          ) : null}
          {kind === "diff" && absoluteFilePath && editorApps.length > 0 ? (
            <ViewerAppMenu
              label="Open With"
              apps={editorApps}
              onSelect={(editorId) => void handleOpenFileOrContent(editorId)}
            />
          ) : null}
          {canOpenDiff ? (
            <button
              type="button"
              className="content-viewer-action message-action-button"
              title="Open in diff tool"
              onClick={() => void handleOpenDiff()}
            >
              Diff
            </button>
          ) : null}
          {kind === "diff" && diffApps.length > 0 ? (
            <ViewerAppMenu
              label="Diff With"
              apps={diffApps}
              onSelect={(editorId) => void handleOpenDiff(editorId)}
            />
          ) : null}
          {kind !== "diff" && editorApps.length > 1 ? (
            <ViewerAppMenu
              label="Open With"
              apps={editorApps}
              onSelect={(editorId) => void handleOpenFileOrContent(editorId)}
            />
          ) : null}
          {canReveal && absoluteFilePath ? (
            <button
              type="button"
              className="content-viewer-action message-action-button"
              title="Reveal in Finder"
              onClick={() => {
                void openPath(absoluteFilePath);
              }}
            >
              Reveal
            </button>
          ) : null}
        </div>
      </div>
      {kind === "diff" && diffModel ? (
        <div
          ref={bodyRef}
          className={`content-viewer-body${virtualizeDiff ? " virtualized" : ""}`}
          onScroll={(event) => {
            if (virtualizeDiff) {
              setScrollTop(event.currentTarget.scrollTop);
            }
          }}
        >
          <DiffViewerBody
            diffModel={diffModel}
            diffMode={diffMode}
            wrap={wrap}
            syntaxLanguage={syntaxLanguage}
            query={query}
            highlightActive={highlightActive}
            highlightPatterns={highlightPatterns}
            visibleCount={visibleCount}
            startIndex={diffRenderStartIndex}
            endIndex={diffRenderEndIndex}
            virtualize={virtualizeDiff}
            topSpacerHeight={diffTopSpacerHeight}
            bottomSpacerHeight={diffBottomSpacerHeight}
            unifiedTokenLines={diffUnifiedTokenLines}
            splitLeftTokenLines={diffSplitLeftTokenLines}
            splitRightTokenLines={diffSplitRightTokenLines}
            allowFallbackSyntax={allowFallbackSyntax}
            tokenColorResolver={tokenColorResolver}
          />
        </div>
      ) : (
        <div
          ref={bodyRef}
          className={`content-viewer-body${virtualize ? " virtualized" : ""}`}
          onScroll={(event) => {
            if (virtualize) {
              setScrollTop(event.currentTarget.scrollTop);
            }
          }}
        >
          {virtualize ? (
            <div style={{ height: startIndex * APPROX_ROW_HEIGHT }} aria-hidden />
          ) : null}
          <pre className="code-pre">
            {renderedLineValues.map((line, index) => {
              const lineNumber = startIndex + index + 1;
              const tokenLine = tokenLines?.[lineNumber - 1];
              return (
                <div
                  key={`${lineNumber}:${line.length}`}
                  className={`content-viewer-line kind-${kind}`}
                >
                  <span className="content-viewer-ln">{lineNumber}</span>
                  <span className="content-viewer-code">
                    {renderCodeLineContent(
                      line,
                      highlightActive,
                      query,
                      `viewer:${lineNumber}`,
                      highlightPatterns,
                      tokenLine,
                      syntaxLanguage,
                      allowFallbackSyntax,
                      tokenColorResolver,
                    )}
                  </span>
                </div>
              );
            })}
          </pre>
          {virtualize ? (
            <div
              style={{
                height: Math.max(0, visibleLineValues.length - endIndex) * APPROX_ROW_HEIGHT,
              }}
              aria-hidden
            />
          ) : null}
        </div>
      )}
      {visibleCount < totalLines ? (
        <div className="content-viewer-footer">
          <button
            type="button"
            className="content-viewer-action message-action-button"
            onClick={() =>
              setVisibleCount((value) => Math.min(totalLines, value + EXPAND_LINES_STEP))
            }
          >
            Show More
          </button>
        </div>
      ) : null}
    </div>
  );
}

function renderTokenLine(
  lineNumber: string,
  tokenLine: ShikiTokenLine,
  tokenColorResolver: (color: string | undefined) => string | undefined,
): ReactNode[] {
  return tokenLine.map((token, tokenIndex) => (
    <span
      key={`${lineNumber}:${tokenIndex}:${token.content.length}`}
      style={{
        color: tokenColorResolver(token.color),
        fontStyle: ((token.fontStyle ?? 0) & 1) !== 0 ? "italic" : undefined,
        fontWeight: ((token.fontStyle ?? 0) & 2) !== 0 ? 650 : undefined,
      }}
    >
      {token.content}
    </span>
  ));
}

function renderCodeLineContent(
  line: string,
  highlightActive: boolean,
  query: string,
  key: string,
  highlightPatterns: string[],
  tokenLine: ShikiTokenLine | null | undefined,
  language: string,
  allowFallbackSyntax: boolean,
  tokenColorResolver: (color: string | undefined) => string | undefined,
): ReactNode[] {
  if (highlightActive) {
    return buildHighlightedTextNodes(line, query, key, highlightPatterns);
  }
  if (tokenLine) {
    return renderTokenLine(key, tokenLine, tokenColorResolver);
  }
  if (allowFallbackSyntax) {
    return renderSyntaxHighlightedLine(line, language);
  }
  return [<span key={`${key}:plain`}>{line}</span>];
}

function countDiffVisualRows(
  rows: ReturnType<typeof buildDiffViewModel>["rows"],
  diffMode: "unified" | "split",
): number {
  if (diffMode === "split") {
    return rows.length;
  }
  let count = 0;
  for (const row of rows) {
    count += row.kind === "paired" ? 2 : 1;
  }
  return count;
}

function buildDiffVisualOffsets(
  rows: ReturnType<typeof buildDiffViewModel>["rows"],
  diffMode: "unified" | "split",
): number[] {
  const offsets = new Array<number>(rows.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const previousOffset = offsets[index] ?? 0;
    offsets[index + 1] =
      previousOffset + (diffMode === "unified" && rows[index]?.kind === "paired" ? 2 : 1);
  }
  return offsets;
}

function findDiffRowIndexByVisualOffset(offsets: number[], visualIndex: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const nextOffset = offsets[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (nextOffset <= visualIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function ViewerAppMenu({
  label,
  apps,
  onSelect,
}: {
  label: string;
  apps: EditorInfo[];
  onSelect: (editorId: EditorInfo["id"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const initialMenuFocusIndexRef = useRef(0);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    minWidth: number;
  } | null>(null);

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      returnFocusRef.current?.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      itemRefs.current = [];
      return;
    }

    setActiveItemIndex(Math.min(initialMenuFocusIndexRef.current, Math.max(0, apps.length - 1)));

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const estimatedWidth = Math.max(rect.width, 220);
      const left = Math.max(
        12,
        Math.min(rect.right - estimatedWidth, window.innerWidth - estimatedWidth - 12),
      );
      setMenuPosition({
        top: rect.bottom + 6,
        left,
        minWidth: Math.max(rect.width, 180),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [apps.length, open]);

  useEffect(() => {
    if (!open || !menuPosition) {
      return;
    }
    itemRefs.current[activeItemIndex]?.focus({ preventScroll: true });
  }, [activeItemIndex, menuPosition, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [closeMenu, open]);

  return (
    <div ref={menuRef} className="content-viewer-menu">
      <button
        type="button"
        className="content-viewer-action message-action-button"
        aria-haspopup="menu"
        aria-expanded={open}
        ref={buttonRef}
        onMouseDown={(event) => {
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            returnFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            initialMenuFocusIndexRef.current = event.key === "ArrowUp" ? apps.length - 1 : 0;
            setOpen(true);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
          }
        }}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              className="content-viewer-menu-popover"
              role="menu"
              aria-label={label}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (apps.length === 0) {
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeMenu();
                  return;
                }
                if (event.key === "Tab") {
                  closeMenu(false);
                  return;
                }
                let nextIndex: number | null = null;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  nextIndex = (activeItemIndex + 1) % apps.length;
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  nextIndex = (activeItemIndex - 1 + apps.length) % apps.length;
                } else if (event.key === "Home") {
                  event.preventDefault();
                  nextIndex = 0;
                } else if (event.key === "End") {
                  event.preventDefault();
                  nextIndex = apps.length - 1;
                }
                if (nextIndex !== null) {
                  setActiveItemIndex(nextIndex);
                }
              }}
              style={{
                position: "fixed",
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                minWidth: `${menuPosition.minWidth}px`,
              }}
            >
              {apps.map((app, index) => (
                <button
                  key={app.id}
                  type="button"
                  className="content-viewer-menu-item"
                  role="menuitem"
                  tabIndex={index === activeItemIndex ? 0 : -1}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onFocus={() => {
                    setActiveItemIndex(index);
                  }}
                  onClick={() => {
                    closeMenu();
                    onSelect(app.id);
                  }}
                >
                  <span>{app.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function DiffViewerBody({
  diffModel,
  diffMode,
  wrap,
  syntaxLanguage,
  query,
  highlightActive,
  highlightPatterns,
  visibleCount,
  startIndex,
  endIndex,
  virtualize,
  topSpacerHeight,
  bottomSpacerHeight,
  unifiedTokenLines,
  splitLeftTokenLines,
  splitRightTokenLines,
  allowFallbackSyntax,
  tokenColorResolver,
}: {
  diffModel: ReturnType<typeof buildDiffViewModel>;
  diffMode: "unified" | "split";
  wrap: boolean;
  syntaxLanguage: string;
  query: string;
  highlightActive: boolean;
  highlightPatterns: string[];
  visibleCount: number;
  startIndex: number;
  endIndex: number;
  virtualize: boolean;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  unifiedTokenLines: ShikiTokenLine[] | null;
  splitLeftTokenLines: ShikiTokenLine[] | null;
  splitRightTokenLines: ShikiTokenLine[] | null;
  allowFallbackSyntax: boolean;
  tokenColorResolver: (color: string | undefined) => string | undefined;
}) {
  const rows = useMemo(() => diffModel.rows.slice(0, visibleCount), [diffModel.rows, visibleCount]);
  const renderedRows = rows.slice(startIndex, endIndex);
  const unifiedTokenRows = useMemo(() => {
    if (!unifiedTokenLines) {
      return null;
    }
    const mapped: Array<
      | { kind: "single"; tokenLine: ShikiTokenLine | undefined }
      | {
          kind: "paired";
          leftTokenLine: ShikiTokenLine | undefined;
          rightTokenLine: ShikiTokenLine | undefined;
        }
    > = [];
    let tokenIndex = 0;
    for (const row of rows) {
      if (row.kind === "paired") {
        mapped.push({
          kind: "paired",
          leftTokenLine: unifiedTokenLines[tokenIndex],
          rightTokenLine: unifiedTokenLines[tokenIndex + 1],
        });
        tokenIndex += 2;
        continue;
      }
      mapped.push({
        kind: "single",
        tokenLine: unifiedTokenLines[tokenIndex],
      });
      tokenIndex += 1;
    }
    return mapped;
  }, [rows, unifiedTokenLines]);
  return diffMode === "split" ? (
    <div className={`diff-table diff-table-split${wrap ? " wrap" : ""}`}>
      {virtualize && topSpacerHeight > 0 ? (
        <div style={{ height: topSpacerHeight }} aria-hidden />
      ) : null}
      {renderedRows.map((row, index) => {
        const rowIndex = startIndex + index;
        const key = `${row.kind}:${rowIndex}`;
        const leftTokenLine = splitLeftTokenLines?.[rowIndex];
        const rightTokenLine = splitRightTokenLines?.[rowIndex];
        if (row.kind === "context") {
          return (
            <div key={key} className="diff-split-row diff-context">
              <span className="diff-ln">{row.oldLine}</span>
              <span className="diff-code">
                {renderCodeLineContent(
                  row.text,
                  highlightActive,
                  query,
                  `${key}:l`,
                  highlightPatterns,
                  leftTokenLine,
                  syntaxLanguage,
                  allowFallbackSyntax,
                  tokenColorResolver,
                )}
              </span>
              <span className="diff-ln">{row.newLine}</span>
              <span className="diff-code">
                {renderCodeLineContent(
                  row.text,
                  highlightActive,
                  query,
                  `${key}:r`,
                  highlightPatterns,
                  rightTokenLine,
                  syntaxLanguage,
                  allowFallbackSyntax,
                  tokenColorResolver,
                )}
              </span>
            </div>
          );
        }
        if (row.kind === "paired") {
          return (
            <div key={key} className="diff-split-row">
              <span className="diff-ln">{row.oldLine}</span>
              <span className="diff-code diff-remove">
                {highlightActive
                  ? buildHighlightedTextNodes(row.leftText, query, `${key}:lp`, highlightPatterns)
                  : leftTokenLine
                    ? renderTokenLine(`${key}:left`, leftTokenLine, tokenColorResolver)
                    : allowFallbackSyntax
                      ? renderInlineDiffParts(row.leftParts, "diff-word-remove", `${key}:left`)
                      : [<span key={`${key}:left:plain`}>{row.leftText}</span>]}
              </span>
              <span className="diff-ln">{row.newLine}</span>
              <span className="diff-code diff-add">
                {highlightActive
                  ? buildHighlightedTextNodes(row.rightText, query, `${key}:rp`, highlightPatterns)
                  : rightTokenLine
                    ? renderTokenLine(`${key}:right`, rightTokenLine, tokenColorResolver)
                    : allowFallbackSyntax
                      ? renderInlineDiffParts(row.rightParts, "diff-word-add", `${key}:right`)
                      : [<span key={`${key}:right:plain`}>{row.rightText}</span>]}
              </span>
            </div>
          );
        }
        if (row.kind === "remove") {
          return (
            <div key={key} className="diff-split-row">
              <span className="diff-ln">{row.oldLine}</span>
              <span className="diff-code diff-remove">
                {renderCodeLineContent(
                  row.text,
                  highlightActive,
                  query,
                  `${key}:remove`,
                  highlightPatterns,
                  leftTokenLine,
                  syntaxLanguage,
                  allowFallbackSyntax,
                  tokenColorResolver,
                )}
              </span>
              <span className="diff-ln"> </span>
              <span className="diff-code" />
            </div>
          );
        }
        return (
          <div key={key} className="diff-split-row">
            <span className="diff-ln"> </span>
            <span className="diff-code" />
            <span className="diff-ln">{row.newLine}</span>
            <span className="diff-code diff-add">
              {renderCodeLineContent(
                row.text,
                highlightActive,
                query,
                `${key}:add`,
                highlightPatterns,
                rightTokenLine,
                syntaxLanguage,
                allowFallbackSyntax,
                tokenColorResolver,
              )}
            </span>
          </div>
        );
      })}
      {virtualize && bottomSpacerHeight > 0 ? (
        <div style={{ height: bottomSpacerHeight }} aria-hidden />
      ) : null}
    </div>
  ) : (
    <div className={`diff-table${wrap ? " wrap" : ""}`}>
      {virtualize && topSpacerHeight > 0 ? (
        <div style={{ height: topSpacerHeight }} aria-hidden />
      ) : null}
      {renderedRows.map((row, index) => {
        const rowIndex = startIndex + index;
        const key = `${row.kind}:${rowIndex}`;
        if (row.kind === "context") {
          const tokenRow = unifiedTokenRows?.[rowIndex];
          const tokenLine = tokenRow?.kind === "single" ? tokenRow.tokenLine : undefined;
          return (
            <div key={key} className="diff-row diff-context">
              <span className="diff-ln">{row.newLine}</span>
              <span className="diff-code">
                {renderCodeLineContent(
                  row.text,
                  highlightActive,
                  query,
                  `${key}:context`,
                  highlightPatterns,
                  tokenLine,
                  syntaxLanguage,
                  allowFallbackSyntax,
                  tokenColorResolver,
                )}
              </span>
            </div>
          );
        }
        if (row.kind === "paired") {
          const tokenRow = unifiedTokenRows?.[rowIndex];
          const removeTokenLine = tokenRow?.kind === "paired" ? tokenRow.leftTokenLine : undefined;
          const addTokenLine = tokenRow?.kind === "paired" ? tokenRow.rightTokenLine : undefined;
          return (
            <Fragment key={key}>
              <div key={`${key}:remove`} className="diff-row diff-remove">
                <span className="diff-ln">{row.oldLine}</span>
                <span className="diff-code">
                  {highlightActive
                    ? buildHighlightedTextNodes(
                        row.leftText,
                        query,
                        `${key}:left`,
                        highlightPatterns,
                      )
                    : removeTokenLine
                      ? renderTokenLine(`${key}:l`, removeTokenLine, tokenColorResolver)
                      : allowFallbackSyntax
                        ? renderInlineDiffParts(row.leftParts, "diff-word-remove", `${key}:l`)
                        : [<span key={`${key}:l:plain`}>{row.leftText}</span>]}
                </span>
              </div>
              <div key={`${key}:add`} className="diff-row diff-add">
                <span className="diff-ln">{row.newLine}</span>
                <span className="diff-code">
                  {highlightActive
                    ? buildHighlightedTextNodes(
                        row.rightText,
                        query,
                        `${key}:right`,
                        highlightPatterns,
                      )
                    : addTokenLine
                      ? renderTokenLine(`${key}:r`, addTokenLine, tokenColorResolver)
                      : allowFallbackSyntax
                        ? renderInlineDiffParts(row.rightParts, "diff-word-add", `${key}:r`)
                        : [<span key={`${key}:r:plain`}>{row.rightText}</span>]}
                </span>
              </div>
            </Fragment>
          );
        }
        if (row.kind === "remove") {
          const tokenRow = unifiedTokenRows?.[rowIndex];
          const tokenLine = tokenRow?.kind === "single" ? tokenRow.tokenLine : undefined;
          return (
            <div key={key} className="diff-row diff-remove">
              <span className="diff-ln">{row.oldLine}</span>
              <span className="diff-code">
                {renderCodeLineContent(
                  row.text,
                  highlightActive,
                  query,
                  `${key}:remove`,
                  highlightPatterns,
                  tokenLine,
                  syntaxLanguage,
                  allowFallbackSyntax,
                  tokenColorResolver,
                )}
              </span>
            </div>
          );
        }
        const tokenRow = unifiedTokenRows?.[rowIndex];
        const tokenLine = tokenRow?.kind === "single" ? tokenRow.tokenLine : undefined;
        return (
          <div key={key} className="diff-row diff-add">
            <span className="diff-ln">{row.newLine}</span>
            <span className="diff-code">
              {renderCodeLineContent(
                row.text,
                highlightActive,
                query,
                `${key}:add`,
                highlightPatterns,
                tokenLine,
                syntaxLanguage,
                allowFallbackSyntax,
                tokenColorResolver,
              )}
            </span>
          </div>
        );
      })}
      {virtualize && bottomSpacerHeight > 0 ? (
        <div style={{ height: bottomSpacerHeight }} aria-hidden />
      ) : null}
    </div>
  );
}

export function renderRichText(
  value: string,
  query: string,
  keyPrefix: string,
  pathRoots: string[] = [],
  highlightPatterns: string[] = [],
): ReactNode[] {
  const normalized = normalizeMarkdownInput(value);
  return [
    <ReactMarkdown
      key={`${keyPrefix}:md`}
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={getMarkdownComponents(pathRoots, query, highlightPatterns)}
    >
      {normalized}
    </ReactMarkdown>,
  ];
}

export function renderPlainText(
  value: string,
  query: string,
  keyPrefix: string,
  pathRoots: string[] = [],
  highlightPatterns: string[] = [],
): ReactNode[] {
  const lines = value.split(/\r?\n/);
  const items: ReactNode[] = [];
  for (const [index, line] of lines.entries()) {
    const key = `${keyPrefix}:${index}:${line.length}`;
    if (line.trim().length === 0) {
      items.push(<div key={`${key}:empty`} className="md-empty" />);
      continue;
    }
    items.push(
      <p key={`${key}:p`} className="md-p">
        {renderTextWithLocalPathLinks(line, query, `${key}:txt`, pathRoots, highlightPatterns)}
      </p>,
    );
  }
  return items;
}

export function looksLikeMarkdown(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("```")) {
    return true;
  }
  if (/^\s{0,3}(#{1,6}|[-*+]\s+|\d+\.\s+|>\s+)/m.test(value)) {
    return true;
  }
  if (/\[[^\]]+\]\s*\([^)]+\)/.test(value)) {
    return true;
  }
  return /(^|[^\\])(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/m.test(value);
}

const TEXT_PATH_PATTERN =
  /(file:\/\/[^\s)\],;!?"'`]+|[A-Za-z]:[\\/][^\s)\],;!?"'`]+|\/[^\s)\],;!?"'`]+)/g;

function buildMarkdownComponents(
  pathRoots: string[],
  query: string,
  highlightPatterns: string[],
): Components {
  return {
    h1({ children }) {
      return (
        <h3 className="md-h1">
          {renderChildrenWithLocalPathLinks(children, query, pathRoots, "h1", highlightPatterns)}
        </h3>
      );
    },
    h2({ children }) {
      return (
        <h4 className="md-h2">
          {renderChildrenWithLocalPathLinks(children, query, pathRoots, "h2", highlightPatterns)}
        </h4>
      );
    },
    h3({ children }) {
      return (
        <h5 className="md-h3">
          {renderChildrenWithLocalPathLinks(children, query, pathRoots, "h3", highlightPatterns)}
        </h5>
      );
    },
    h4({ children }) {
      return (
        <h6 className="md-h3">
          {renderChildrenWithLocalPathLinks(children, query, pathRoots, "h4", highlightPatterns)}
        </h6>
      );
    },
    h5({ children }) {
      return (
        <h6 className="md-h3">
          {renderChildrenWithLocalPathLinks(children, query, pathRoots, "h5", highlightPatterns)}
        </h6>
      );
    },
    h6({ children }) {
      return (
        <h6 className="md-h3">
          {renderChildrenWithLocalPathLinks(children, query, pathRoots, "h6", highlightPatterns)}
        </h6>
      );
    },
    p({ children }) {
      return (
        <p className="md-p">
          {renderChildrenWithLocalPathLinks(children, query, pathRoots, "p", highlightPatterns)}
        </p>
      );
    },
    li({ children }) {
      return (
        <li>
          {renderChildrenWithLocalPathLinks(children, query, pathRoots, "li", highlightPatterns)}
        </li>
      );
    },
    ul({ children }) {
      return <ul className="md-list">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="md-list md-list-ordered">{children}</ol>;
    },
    blockquote({ children }) {
      return <blockquote className="md-quote">{children}</blockquote>;
    },
    pre({ children }) {
      return <>{children}</>;
    },
    code({ className, children, node }) {
      const fenceInfo = extractFenceInfoFromClassName(className);
      const codeDescriptor = describeCodeFence(fenceInfo, pathRoots);
      const rawValue = String(children ?? "");
      const codeValue = rawValue.replace(/\n$/, "");
      const position = (
        node as { position?: { start?: { line?: number }; end?: { line?: number } } }
      )?.position;
      const spansMultipleLines =
        typeof position?.start?.line === "number" &&
        typeof position?.end?.line === "number" &&
        position.start.line !== position.end.line;
      const isInlineCode = !fenceInfo && !spansMultipleLines && !rawValue.includes("\n");

      if (isInlineCode) {
        const resolved = resolvePathToken(codeValue.trim(), pathRoots);
        if (resolved) {
          return (
            <button
              type="button"
              className="md-link-local"
              onClick={() => {
                void openLocalPath(resolved.absolutePath);
              }}
            >
              {buildHighlightedTextNodes(
                resolved.displayLabel,
                query,
                "inline-code-path",
                highlightPatterns,
              )}
            </button>
          );
        }
        return (
          <code>
            {renderChildrenWithHighlights(children, query, "inline-code", highlightPatterns)}
          </code>
        );
      }
      return (
        <CodeBlock
          language={codeDescriptor.syntaxLanguage}
          codeValue={codeValue}
          metaLabel={codeDescriptor.metaLabel}
          {...(codeDescriptor.filePath ? { filePath: codeDescriptor.filePath } : {})}
          {...(codeDescriptor.startLine ? { startLine: codeDescriptor.startLine } : {})}
          query={query}
          highlightPatterns={highlightPatterns}
        />
      );
    },
    a({ href, children }) {
      const parsedHref = parseMarkdownHref(href ?? "", pathRoots);
      if (parsedHref.kind === "external") {
        return (
          <a className="md-link" href={parsedHref.href} target="_blank" rel="noreferrer">
            {renderChildrenWithHighlights(children, query, "external-link", highlightPatterns)}
          </a>
        );
      }
      if (parsedHref.kind === "local") {
        return (
          <button
            type="button"
            className="md-link-local"
            onClick={() => {
              void openLocalPath(parsedHref.path);
            }}
          >
            {buildHighlightedTextNodes(
              String(formatLocalLinkLabel(children, parsedHref.path, pathRoots)),
              query,
              "local-link",
              highlightPatterns,
            )}
          </button>
        );
      }
      return (
        <span>
          {renderChildrenWithLocalPathLinks(
            children,
            query,
            pathRoots,
            "unsafe-link",
            highlightPatterns,
          )}
        </span>
      );
    },
  };
}

function getMarkdownComponents(
  pathRoots: string[],
  query: string,
  highlightPatterns: string[],
): Components {
  const cacheKey = `${pathRoots.join("\u0000")}\u0001${query}\u0001${highlightPatterns.join("\u0000")}`;
  const cached = markdownComponentsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const components = buildMarkdownComponents(pathRoots, query, highlightPatterns);
  markdownComponentsCache.set(cacheKey, components);
  if (markdownComponentsCache.size > MARKDOWN_COMPONENTS_CACHE_LIMIT) {
    const oldestKey = markdownComponentsCache.keys().next().value;
    if (typeof oldestKey === "string") {
      markdownComponentsCache.delete(oldestKey);
    }
  }
  return components;
}

function normalizeMarkdownInput(value: string): string {
  const normalizedLinks = value.replace(/\]\s+\(/g, "](");
  const normalizedBracketedPathCode = normalizedLinks.replace(
    /\[\s*`((?:\/|[A-Za-z]:[\\/]|file:\/\/)[^`]+)`\s*\]/g,
    "`$1`",
  );
  return normalizedBracketedPathCode.replace(/<\/?[A-Za-z_][A-Za-z0-9_.:-]*>/g, (tag) =>
    tag.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
}

function formatLocalLinkLabel(
  children: ReactNode,
  localPath: string,
  pathRoots: string[],
): ReactNode {
  const text = flattenText(children).trim();
  const parsedLabelPath = toLocalPath(text);
  if (parsedLabelPath) {
    return formatLocalPathLabel(parsedLabelPath, pathRoots);
  }
  if (text.length === 0) {
    return formatLocalPathLabel(localPath, pathRoots);
  }
  if (looksLikePathLabel(text)) {
    return formatLocalPathLabel(localPath, pathRoots);
  }
  return text;
}

function flattenText(node: ReactNode): string {
  let result = "";
  for (const child of Children.toArray(node)) {
    if (typeof child === "string" || typeof child === "number") {
      result += String(child);
      continue;
    }
    if (child && typeof child === "object" && "props" in child) {
      result += flattenText((child as { props?: { children?: ReactNode } }).props?.children ?? "");
    }
  }
  return result;
}

function formatLocalPathLabel(path: string, pathRoots: string[] = []): string {
  const normalized = path.replace(/\\/g, "/");
  for (const root of pathRoots) {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalizedRoot) {
      continue;
    }
    if (normalized === normalizedRoot) {
      return normalized.split("/").pop() ?? normalized;
    }
    if (normalized.startsWith(`${normalizedRoot}/`)) {
      return normalized.slice(normalizedRoot.length + 1);
    }
  }
  return normalized;
}

function renderChildrenWithLocalPathLinks(
  children: ReactNode,
  query: string,
  pathRoots: string[],
  keyPrefix: string,
  highlightPatterns: string[],
): ReactNode {
  const mapped: ReactNode[] = [];

  for (const [index, child] of Children.toArray(children).entries()) {
    const childKey = `${keyPrefix}:${index}`;
    if (typeof child === "string" || typeof child === "number") {
      mapped.push(
        ...renderTextWithLocalPathLinks(
          String(child),
          query,
          `${childKey}:text`,
          pathRoots,
          highlightPatterns,
        ),
      );
      continue;
    }

    if (!isValidElement(child)) {
      mapped.push(child);
      continue;
    }

    if (typeof child.type !== "string") {
      mapped.push(child);
      continue;
    }

    const elementType = child.type;
    const props = child.props as { children?: ReactNode };
    if (props.children === undefined) {
      mapped.push(child);
      continue;
    }

    if (
      elementType === "code" ||
      elementType === "a" ||
      elementType === "button" ||
      elementType === "pre"
    ) {
      mapped.push(
        cloneElement(
          child,
          undefined,
          renderChildrenWithHighlights(
            props.children,
            query,
            `${childKey}:child`,
            highlightPatterns,
          ),
        ),
      );
      continue;
    }

    mapped.push(
      cloneElement(
        child,
        undefined,
        renderChildrenWithLocalPathLinks(
          props.children,
          query,
          pathRoots,
          `${childKey}:child`,
          highlightPatterns,
        ),
      ),
    );
  }

  return mapped;
}

function renderTextWithLocalPathLinks(
  value: string,
  query: string,
  keyPrefix: string,
  pathRoots: string[],
  highlightPatterns: string[],
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(TEXT_PATH_PATTERN)) {
    const rawToken = match[0] ?? "";
    const index = match.index ?? 0;
    const tokenEnd = index + rawToken.length;
    const resolved = resolvePathToken(rawToken, pathRoots);
    const bracketWrapped =
      !!resolved &&
      index > cursor &&
      value[index - 1] === "[" &&
      tokenEnd < value.length &&
      value[tokenEnd] === "]";
    const plainEnd = bracketWrapped ? index - 1 : index;
    if (plainEnd > cursor) {
      nodes.push(
        ...buildHighlightedTextNodes(
          value.slice(cursor, plainEnd),
          query,
          `${keyPrefix}:${cursor}:plain`,
          highlightPatterns,
        ),
      );
    }

    if (resolved) {
      nodes.push(
        <button
          key={`${keyPrefix}:${index}:path`}
          type="button"
          className="md-link-local"
          onClick={() => {
            void openLocalPath(resolved.absolutePath);
          }}
        >
          {buildHighlightedTextNodes(
            resolved.displayLabel,
            query,
            `${keyPrefix}:${index}:label`,
            highlightPatterns,
          )}
        </button>,
      );
      cursor = tokenEnd + (bracketWrapped ? 1 : 0);
    } else {
      nodes.push(
        ...buildHighlightedTextNodes(
          rawToken,
          query,
          `${keyPrefix}:${index}:raw`,
          highlightPatterns,
        ),
      );
      cursor = tokenEnd;
    }
  }

  if (cursor < value.length) {
    nodes.push(
      ...buildHighlightedTextNodes(
        value.slice(cursor),
        query,
        `${keyPrefix}:${cursor}:tail`,
        highlightPatterns,
      ),
    );
  }

  if (nodes.length === 0) {
    nodes.push(...buildHighlightedTextNodes(value, query, `${keyPrefix}:all`, highlightPatterns));
  }

  return nodes;
}

function renderChildrenWithHighlights(
  children: ReactNode,
  query: string,
  keyPrefix: string,
  highlightPatterns: string[],
): ReactNode {
  const mapped: ReactNode[] = [];

  for (const [index, child] of Children.toArray(children).entries()) {
    const childKey = `${keyPrefix}:${index}`;
    if (typeof child === "string" || typeof child === "number") {
      mapped.push(...buildHighlightedTextNodes(String(child), query, childKey, highlightPatterns));
      continue;
    }

    if (!isValidElement(child)) {
      mapped.push(child);
      continue;
    }

    const props = child.props as { children?: ReactNode };
    if (props.children === undefined) {
      mapped.push(child);
      continue;
    }

    mapped.push(
      cloneElement(
        child,
        undefined,
        renderChildrenWithHighlights(props.children, query, `${childKey}:child`, highlightPatterns),
      ),
    );
  }

  return mapped;
}

function resolvePathToken(
  token: string,
  pathRoots: string[],
): { absolutePath: string; displayLabel: string } | null {
  const candidate = stripWrappingPunctuation(token.trim());
  if (!candidate) {
    return null;
  }
  if (candidate.startsWith("/") && candidate.indexOf("/", 1) < 0) {
    return null;
  }

  const absolutePath = toLocalPath(candidate);
  if (!absolutePath) {
    return null;
  }
  if (!isPathUnderProjectRoots(absolutePath, pathRoots)) {
    return null;
  }
  return {
    absolutePath,
    displayLabel: formatLocalPathLabel(absolutePath, pathRoots),
  };
}

function isPathUnderProjectRoots(path: string, pathRoots: string[]): boolean {
  if (pathRoots.length === 0) {
    return false;
  }

  const normalizedPath = normalizePathForComparison(path);
  if (!normalizedPath) {
    return false;
  }

  for (const root of pathRoots) {
    const normalizedRoot = normalizePathForComparison(root);
    if (!normalizedRoot) {
      continue;
    }

    if (normalizedRoot === "/" || /^[a-z]:\/$/.test(normalizedRoot)) {
      if (normalizedPath.startsWith(normalizedRoot)) {
        return true;
      }
      continue;
    }

    if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return true;
    }
  }
  return false;
}

function stripWrappingPunctuation(value: string): string {
  let trimmed = value;
  while (
    trimmed.length > 0 &&
    (trimmed.endsWith(".") ||
      trimmed.endsWith(",") ||
      trimmed.endsWith(";") ||
      trimmed.endsWith("!") ||
      trimmed.endsWith("?") ||
      trimmed.endsWith(")") ||
      trimmed.endsWith("]"))
  ) {
    trimmed = trimmed.slice(0, -1);
  }
  while (
    trimmed.startsWith("(") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("'") ||
    trimmed.startsWith('"')
  ) {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

function looksLikePathLabel(value: string): boolean {
  if (value.startsWith("./") || value.startsWith("../") || value.startsWith("/")) {
    return true;
  }
  return value.includes("/") || value.includes("\\");
}

function parseMarkdownHref(
  href: string,
  pathRoots: string[],
): { kind: "external"; href: string } | { kind: "local"; path: string } | { kind: "invalid" } {
  const normalized = href.trim();
  if (normalized.length === 0) {
    return { kind: "invalid" };
  }
  if (containsAsciiControlChars(normalized)) {
    return { kind: "invalid" };
  }

  if (
    normalized.startsWith("https://") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("mailto:")
  ) {
    return { kind: "external", href: normalized };
  }

  const localPath = toLocalPath(normalized);
  if (localPath && isPathUnderProjectRoots(localPath, pathRoots)) {
    return { kind: "local", path: localPath };
  }
  return { kind: "invalid" };
}

function toLocalPath(href: string): string | null {
  let value = href.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep undecoded input.
  }

  if (value.startsWith("file://")) {
    value = value.slice("file://".length);
    if (value.startsWith("localhost/")) {
      value = value.slice("localhost".length);
    }
  }

  const hashIndex = value.indexOf("#");
  if (hashIndex >= 0) {
    value = value.slice(0, hashIndex);
  }
  value = value.trim();
  if (value.length === 0) {
    return null;
  }
  if (containsAsciiControlChars(value)) {
    return null;
  }
  if (value.startsWith("//")) {
    return null;
  }

  const isUnixAbsolute = value.startsWith("/");
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(value);
  if (!isUnixAbsolute && !isWindowsAbsolute) {
    return null;
  }

  return normalizeAbsolutePath(stripLineColumnSuffix(value));
}

function stripLineColumnSuffix(pathValue: string): string {
  const suffixMatch = /^(.*\.[A-Za-z0-9_-]+)(?::\d+(?::\d+)?)$/.exec(pathValue);
  if (!suffixMatch) {
    return pathValue;
  }
  return suffixMatch[1] ?? pathValue;
}

async function openLocalPath(path: string): Promise<void> {
  try {
    const preferences = await getCachedViewerToolPreferences();
    const result = await getCodetrailClient().invoke("editor:open", {
      kind: "file",
      filePath: path,
      preferredExternalEditor: preferences.preferredExternalEditor ?? undefined,
      preferredExternalDiffTool: preferences.preferredExternalDiffTool ?? undefined,
      terminalAppCommand: preferences.terminalAppCommand,
      externalTools: preferences.externalTools,
    });
    if (!result.ok) {
      console.error("[codetrail] failed opening local markdown link", path, result.error);
    }
  } catch (error) {
    console.error("[codetrail] failed opening local markdown link", path, error);
  }
}

export function CodeBlock({
  language,
  codeValue,
  metaLabel,
  filePath,
  pathRoots = [],
  startLine,
  query = "",
  highlightPatterns = [],
}: {
  language: string;
  codeValue: string;
  metaLabel?: string;
  filePath?: string | null;
  pathRoots?: string[];
  startLine?: number;
  query?: string;
  highlightPatterns?: string[];
}) {
  const normalizedLanguage = language.trim().toLowerCase();
  const kind = detectViewerKind(normalizedLanguage, codeValue);
  return (
    <ContentViewer
      kind={kind}
      language={normalizedLanguage}
      codeValue={codeValue}
      {...(metaLabel ? { metaLabel } : {})}
      {...(filePath !== undefined ? { filePath } : {})}
      pathRoots={pathRoots}
      query={query}
      highlightPatterns={highlightPatterns}
      {...(startLine ? { startLine } : {})}
    />
  );
}

type CodeFenceDescriptor = {
  syntaxLanguage: string;
  metaLabel: string;
  filePath: string | null;
  startLine?: number;
};

function describeCodeFence(fenceInfo: string | null, pathRoots: string[]): CodeFenceDescriptor {
  const normalizedInfo = fenceInfo?.trim() ?? "";
  if (normalizedInfo.length === 0) {
    return {
      syntaxLanguage: "",
      metaLabel: "",
      filePath: null,
    };
  }

  const sourceRef = parseSourceReferenceFenceInfo(normalizedInfo);
  if (sourceRef) {
    const displayPath = trimProjectPrefixFromPath(sourceRef.filePath, pathRoots);
    return {
      syntaxLanguage: detectLanguageFromFilePath(sourceRef.filePath),
      metaLabel: `${displayPath}:${sourceRef.startLine}`,
      filePath: sourceRef.filePath,
      startLine: sourceRef.startLine,
    };
  }

  const path = toLocalPath(normalizedInfo);
  if (path && isPathUnderProjectRoots(path, pathRoots)) {
    return {
      syntaxLanguage: detectLanguageFromFilePath(path),
      metaLabel: trimProjectPrefixFromPath(path, pathRoots),
      filePath: path,
    };
  }

  return {
    syntaxLanguage: normalizedInfo,
    metaLabel: normalizedInfo,
    filePath: null,
  };
}

function extractFenceInfoFromClassName(className?: string): string | null {
  if (!className) {
    return null;
  }
  const token = className.split(/\s+/).find((classToken) => classToken.startsWith("language-"));
  if (!token) {
    return null;
  }

  const value = token.slice("language-".length).trim();
  return value.length > 0 ? value : null;
}

function parseSourceReferenceFenceInfo(
  info: string,
): { startLine: number; filePath: string } | null {
  const match = /^(\d+)(?::\d+)?:(.+)$/.exec(info);
  if (!match) {
    return null;
  }

  const startLine = Number(match[1]);
  if (!Number.isFinite(startLine) || startLine <= 0) {
    return null;
  }
  const rawPath = match[2]?.trim() ?? "";
  const filePath = toLocalPath(rawPath);
  if (!filePath) {
    return null;
  }
  return { startLine, filePath };
}

export function DiffBlock({
  codeValue,
  filePath,
  pathRoots = [],
  query = "",
  highlightPatterns = [],
}: {
  codeValue: string;
  filePath?: string | null;
  pathRoots?: string[];
  query?: string;
  highlightPatterns?: string[];
}) {
  return (
    <ContentViewer
      kind="diff"
      language="diff"
      codeValue={codeValue}
      {...(filePath ? { metaLabel: trimProjectPrefixFromPath(filePath, pathRoots) } : {})}
      {...(filePath !== undefined ? { filePath } : {})}
      pathRoots={pathRoots}
      query={query}
      highlightPatterns={highlightPatterns}
    />
  );
}

function renderSyntaxHighlightedLine(line: string, language: string): ReactNode[] {
  const tokens = tokenizeCodeLine(line, language);
  return tokens.map((token, index) =>
    token.kind === "plain" ? (
      <span key={`${index}:${token.text.length}`}>{token.text}</span>
    ) : (
      <span key={`${index}:${token.text.length}`} className={`tok-${token.kind}`}>
        {token.text}
      </span>
    ),
  );
}

function tokenizeCodeLine(
  line: string,
  language: string,
): Array<{ text: string; kind: "plain" | "keyword" | "string" | "number" | "comment" }> {
  const keywordSet = languageKeywords(language);
  const pattern =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*$|#.*$|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const tokens: Array<{
    text: string;
    kind: "plain" | "keyword" | "string" | "number" | "comment";
  }> = [];
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const value = match[0] ?? "";
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ text: line.slice(cursor, index), kind: "plain" });
    }
    if (value.startsWith("//") || value.startsWith("#")) {
      tokens.push({ text: value, kind: "comment" });
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith("`") && value.endsWith("`"))
    ) {
      tokens.push({ text: value, kind: "string" });
    } else if (/^\d/.test(value)) {
      tokens.push({ text: value, kind: "number" });
    } else if (keywordSet.has(language === "sql" ? value.toUpperCase() : value)) {
      tokens.push({ text: value, kind: "keyword" });
    } else {
      tokens.push({ text: value, kind: "plain" });
    }
    cursor = index + value.length;
  }

  if (cursor < line.length) {
    tokens.push({ text: line.slice(cursor), kind: "plain" });
  }
  if (tokens.length === 0) {
    tokens.push({ text: line, kind: "plain" });
  }
  return tokens;
}

function languageKeywords(language: string): Set<string> {
  return LANGUAGE_KEYWORDS[language] ?? EMPTY_KEYWORDS;
}

export {
  detectLanguageFromContent,
  detectLanguageFromFilePath,
  isLikelyDiff,
  looksLikeLogContent,
} from "./viewerDetection";

export function buildHighlightedTextNodes(
  value: string,
  query: string,
  keyPrefix: string,
  highlightPatterns: string[] = [],
): ReactNode[] {
  const matcher = getCachedHighlightRegex(query, highlightPatterns);
  if (!matcher) {
    return [<span key={`${keyPrefix}:all`}>{value}</span>];
  }

  const splitMatcher = new RegExp(`(${matcher.source})`, matcher.flags);
  const parts = value.split(splitMatcher);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const [index, part] of parts.entries()) {
    const key = `${keyPrefix}:${cursor}:${part.length}`;
    if (index % 2 === 1) {
      nodes.push(<mark key={`${key}:m`}>{part}</mark>);
    } else if (part.length > 0) {
      nodes.push(<span key={`${key}:t`}>{part}</span>);
    }
    cursor += part.length;
  }
  return nodes;
}

function getCachedHighlightRegex(query: string, highlightPatterns: string[]): RegExp | null {
  const cacheKey = `${query}\u0000${highlightPatterns.join("\u0001")}`;
  if (highlightRegexCache.has(cacheKey)) {
    return highlightRegexCache.get(cacheKey) ?? null;
  }

  const matcher =
    highlightPatterns.length > 0
      ? buildSearchHighlightRegex({
          normalizedQuery: query.trim(),
          mode: "simple",
          ftsTokens: [],
          ftsQuery: null,
          highlightPatterns,
          hasTerms: highlightPatterns.length > 0,
          error: null,
        })
      : buildSearchHighlightRegex(query);
  highlightRegexCache.set(cacheKey, matcher);
  if (highlightRegexCache.size > HIGHLIGHT_REGEX_CACHE_LIMIT) {
    const oldestKey = highlightRegexCache.keys().next().value;
    if (oldestKey) {
      highlightRegexCache.delete(oldestKey);
    }
  }
  return matcher;
}

export function renderMarkedSnippet(value: string): ReactNode {
  const segments = value.split(/(<\/?mark>)/g);
  let markOpen = false;
  let cursor = 0;
  const content: ReactNode[] = [];

  for (const segment of segments) {
    if (segment === "<mark>") {
      markOpen = true;
      cursor += segment.length;
      continue;
    }
    if (segment === "</mark>") {
      markOpen = false;
      cursor += segment.length;
      continue;
    }

    const key = `${cursor}:${segment.length}:${markOpen ? "m" : "t"}`;
    if (markOpen) {
      content.push(<mark key={key}>{segment}</mark>);
    } else {
      content.push(<span key={key}>{segment}</span>);
    }
    cursor += segment.length;
  }

  return content;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAsciiControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function normalizeAbsolutePath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/");
  const windowsPrefix = /^([A-Za-z]):\//.exec(normalized);

  if (!windowsPrefix && !normalized.startsWith("/")) {
    return null;
  }

  const rootPrefix = windowsPrefix ? `${windowsPrefix[1] ?? ""}:` : "/";
  const suffix = windowsPrefix ? normalized.slice(2) : normalized;
  const parts: string[] = [];

  for (const part of suffix.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  if (windowsPrefix) {
    return parts.length > 0 ? `${rootPrefix}/${parts.join("/")}` : `${rootPrefix}/`;
  }

  return parts.length > 0 ? `/${parts.join("/")}` : "/";
}

function normalizePathForComparison(value: string): string | null {
  const normalizedAbsolute = normalizeAbsolutePath(value);
  if (!normalizedAbsolute) {
    return null;
  }

  const trimmedPath = trimTrailingSeparators(normalizedAbsolute);
  return /^[A-Za-z]:\//.test(trimmedPath) ? trimmedPath.toLowerCase() : trimmedPath;
}

function trimTrailingSeparators(value: string): string {
  if (value === "/" || /^[A-Za-z]:\/$/.test(value)) {
    return value;
  }
  return value.replace(/\/+$/, "");
}

export function tryFormatJson(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

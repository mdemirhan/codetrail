import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  type IpcRequest,
  type MessageCategory,
  type Provider,
  createProviderRecord,
} from "@codetrail/core";

import { DEFAULT_DESKTOP_PLATFORM, type DesktopPlatform } from "../shared/desktopPlatform";
import {
  type DiffViewMode,
  type ExternalEditorId,
  type ExternalToolConfig,
  KNOWN_EXTERNAL_APP_VALUES,
  type MessagePageSize,
  type MonoFontFamily,
  type MonoFontSize,
  type RegularFontFamily,
  type RegularFontSize,
  type ShikiThemeId,
  type ThemeMode,
  UI_DIFF_VIEW_MODE_VALUES,
  UI_MESSAGE_CATEGORY_VALUES,
  UI_MESSAGE_PAGE_SIZE_VALUES,
  UI_MONO_FONT_SIZE_VALUES,
  UI_MONO_FONT_VALUES,
  UI_PROVIDER_VALUES,
  UI_REGULAR_FONT_SIZE_VALUES,
  UI_REGULAR_FONT_VALUES,
  UI_THEME_VALUES,
  UI_VIEWER_WRAP_MODE_VALUES,
  type ViewerWrapMode,
  createDefaultExternalTools,
  getDefaultShikiThemeForFamily,
  getEnabledExternalTools,
  getShikiThemeFamily,
  isShikiThemeId,
  normalizeExternalTools,
} from "../shared/uiPreferences";

type PaneStateFull = Required<IpcRequest<"ui:setPaneState">>;
type PaneStateResolved = { [K in keyof PaneStateFull]-?: Exclude<PaneStateFull[K], undefined> };
type PaneStatePatch = { [K in keyof PaneStateResolved]?: PaneStateResolved[K] | undefined };
export type PaneState = Partial<PaneStateResolved> &
  Pick<PaneStateResolved, "projectPaneWidth" | "sessionPaneWidth">;
type IndexingConfigState = Partial<IpcRequest<"indexer:setConfig">>;

export type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
};

type AppState = {
  pane?: PaneState;
  indexing?: IndexingConfigState;
  window?: WindowState;
};

type AppStateStoreFileSystem = {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: true }) => void;
  readFileSync: (path: string, encoding: "utf8") => string;
  writeFileSync: (path: string, data: string, encoding: "utf8") => void;
};

type AppStateStoreTimer = {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

export type AppStateStoreDependencies = {
  fs?: AppStateStoreFileSystem;
  timer?: AppStateStoreTimer;
  platform?: DesktopPlatform;
  onPersistError?: (error: unknown) => void;
};

const PANE_MIN = 120;
const PANE_MAX = 2000;
const PAGE_MIN = 0;
const PAGE_MAX = 1_000_000;
const SCROLL_TOP_MIN = 0;
const SCROLL_TOP_MAX = 10_000_000;
const SYSTEM_MESSAGE_RULES_MAX = 100;
const SYSTEM_MESSAGE_RULE_LENGTH_MAX = 2000;
const WINDOW_MIN = 320;
const WINDOW_MAX = 6000;
const PROVIDER_VALUES: Provider[] = [...UI_PROVIDER_VALUES];
const CATEGORY_VALUES: MessageCategory[] = [...UI_MESSAGE_CATEGORY_VALUES];
const THEME_VALUES: ThemeMode[] = [...UI_THEME_VALUES];
const MONO_FONT_VALUES: MonoFontFamily[] = [...UI_MONO_FONT_VALUES];
const REGULAR_FONT_VALUES: RegularFontFamily[] = [...UI_REGULAR_FONT_VALUES];
const MONO_FONT_SIZE_VALUES: MonoFontSize[] = [...UI_MONO_FONT_SIZE_VALUES];
const REGULAR_FONT_SIZE_VALUES: RegularFontSize[] = [...UI_REGULAR_FONT_SIZE_VALUES];
const MESSAGE_PAGE_SIZE_VALUES: MessagePageSize[] = [...UI_MESSAGE_PAGE_SIZE_VALUES];
const VIEWER_WRAP_MODE_VALUES: ViewerWrapMode[] = [...UI_VIEWER_WRAP_MODE_VALUES];
const DIFF_VIEW_MODE_VALUES: DiffViewMode[] = [...UI_DIFF_VIEW_MODE_VALUES];
const HISTORY_MODE_VALUES = ["session", "bookmarks", "project_all"] as const;
const HISTORY_VISUALIZATION_VALUES = ["messages", "turns", "bookmarks"] as const;
const PROJECT_VIEW_MODE_VALUES = ["list", "tree"] as const;
const PROJECT_SORT_FIELD_VALUES = ["last_active", "name"] as const;
const SORT_DIRECTION_VALUES = ["asc", "desc"] as const;
const AUTO_REFRESH_STRATEGY_VALUES = [
  "watch-1s",
  "watch-3s",
  "watch-5s",
  "scan-5s",
  "scan-10s",
  "scan-30s",
  "scan-1min",
  "scan-5min",
] as const;
const CURRENT_AUTO_REFRESH_STRATEGY_VALUES = ["off", ...AUTO_REFRESH_STRATEGY_VALUES] as const;
const LEGACY_DEFAULT_ENABLED_PROVIDERS: Provider[] = [
  "claude",
  "codex",
  "gemini",
  "cursor",
  "copilot",
];
const LEGACY_PRE_OPENCODE_ENABLED_PROVIDERS: Provider[] = [
  "claude",
  "codex",
  "gemini",
  "cursor",
  "copilot",
  "copilot_cli",
];
const DEFAULT_FILE_SYSTEM: AppStateStoreFileSystem = {
  existsSync: (path) => existsSync(path),
  mkdirSync: (path, options) => mkdirSync(path, options),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync: (path, data, encoding) => writeFileSync(path, data, encoding),
};
const DEFAULT_TIMER: AppStateStoreTimer = {
  setTimeout,
  clearTimeout,
};

// AppStateStore persists only sanitized UI state. Invalid or stale values are dropped on read so a
// corrupted settings file cannot break startup.
export class AppStateStore {
  private readonly filePath: string;
  private readonly fileSystem: AppStateStoreFileSystem;
  private readonly timer: AppStateStoreTimer;
  private readonly platform: DesktopPlatform;
  private readonly onPersistError: (error: unknown) => void;
  private state: AppState;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string, dependencies: AppStateStoreDependencies = {}) {
    this.filePath = filePath;
    this.fileSystem = dependencies.fs ?? DEFAULT_FILE_SYSTEM;
    this.timer = dependencies.timer ?? DEFAULT_TIMER;
    this.platform = dependencies.platform ?? DEFAULT_DESKTOP_PLATFORM;
    this.onPersistError =
      dependencies.onPersistError ??
      ((error) => {
        console.error("[codetrail] failed persisting app state", error);
      });
    this.state = readState(filePath, this.fileSystem, this.platform);
  }

  getFilePath(): string {
    return this.filePath;
  }

  getPaneState(): PaneState | null {
    return this.state.pane ?? null;
  }

  setPaneState(value: PaneState): void {
    this.updatePaneState(value, true);
  }

  setPaneStateRuntimeOnly(value: PaneStatePatch): void {
    this.updatePaneState(value, false);
  }

  private updatePaneState(value: PaneStatePatch, persist: boolean): void {
    const pane = sanitizePaneState(
      {
        ...(this.state.pane ?? {}),
        ...value,
      },
      this.state.indexing?.enabledProviders,
      this.platform,
    );
    if (!pane) {
      return;
    }
    this.state = {
      ...this.state,
      pane,
    };
    if (persist) {
      this.schedulePersist();
    }
  }

  getIndexingState(): IndexingConfigState | null {
    return this.state.indexing ?? null;
  }

  setIndexingState(value: IndexingConfigState): void {
    const indexing = sanitizeIndexingState(value);
    if (!indexing) {
      return;
    }
    this.state = {
      ...this.state,
      indexing,
    };
    this.schedulePersist();
  }

  getWindowState(): WindowState | null {
    return this.state.window ?? null;
  }

  setWindowState(value: WindowState): void {
    const window = sanitizeWindowState(value);
    if (!window) {
      return;
    }
    this.state = {
      ...this.state,
      window,
    };
    this.schedulePersist();
  }

  flush(): void {
    if (this.persistTimer) {
      this.timer.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    persistState(this.filePath, this.state, this.fileSystem, this.onPersistError);
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      this.timer.clearTimeout(this.persistTimer);
    }

    // Debounce small UI changes into one write because pane resize/scroll can be very chatty.
    this.persistTimer = this.timer.setTimeout(() => {
      this.persistTimer = null;
      persistState(this.filePath, this.state, this.fileSystem, this.onPersistError);
    }, 150);
  }
}

export function createAppStateStore(
  filePath: string,
  dependencies: AppStateStoreDependencies = {},
): AppStateStore {
  return new AppStateStore(filePath, dependencies);
}

function readState(
  filePath: string,
  fileSystem: AppStateStoreFileSystem,
  platform: DesktopPlatform,
): AppState {
  if (!fileSystem.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fileSystem.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const record = parsed as Record<string, unknown>;
    // Sanitize each subtree independently so one malformed section does not discard the other.
    const indexing = sanitizeIndexingState(record.indexing);
    const pane = sanitizePaneState(record.pane, indexing?.enabledProviders, platform);
    const window = sanitizeWindowState(record.window);
    return {
      ...(pane ? { pane } : {}),
      ...(indexing ? { indexing } : {}),
      ...(window ? { window } : {}),
    };
  } catch {
    return {};
  }
}

function persistState(
  filePath: string,
  state: AppState,
  fileSystem: AppStateStoreFileSystem,
  onPersistError: (error: unknown) => void,
): void {
  try {
    fileSystem.mkdirSync(dirname(filePath), { recursive: true });
    fileSystem.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    onPersistError(error);
  }
}

function sanitizePaneState(
  value: unknown,
  enabledProviderScope: Provider[] | undefined = undefined,
  platform: DesktopPlatform = DEFAULT_DESKTOP_PLATFORM,
): PaneState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const projectPaneWidth = sanitizeInt(record.projectPaneWidth, PANE_MIN, PANE_MAX);
  const sessionPaneWidth = sanitizeInt(record.sessionPaneWidth, PANE_MIN, PANE_MAX);
  if (projectPaneWidth === null || sessionPaneWidth === null) {
    return null;
  }
  const projectPaneCollapsed = sanitizeOptionalBoolean(record.projectPaneCollapsed);
  const sessionPaneCollapsed = sanitizeOptionalBoolean(record.sessionPaneCollapsed);
  const singleClickFoldersExpand = sanitizeOptionalBoolean(record.singleClickFoldersExpand);
  const singleClickProjectsExpand = sanitizeOptionalBoolean(record.singleClickProjectsExpand);
  const hideSessionsPaneInTreeView = sanitizeOptionalBoolean(record.hideSessionsPaneInTreeView);
  // Provider arrays are healed to include newly-added providers so older settings files do not hide
  // data just because they were saved before a provider existed.
  const enabledProviders = enabledProviderScope ?? PROVIDER_VALUES;
  const projectProviders = addMissingProviders(
    sanitizeStringArray(record.projectProviders, enabledProviders),
    enabledProviders,
  );
  const historyCategories = sanitizeStringArray(record.historyCategories, CATEGORY_VALUES);
  const expandedByDefaultCategories = sanitizeStringArray(
    record.expandedByDefaultCategories,
    CATEGORY_VALUES,
  );
  const turnViewCategories = sanitizeStringArray(record.turnViewCategories, CATEGORY_VALUES);
  const turnViewExpandedByDefaultCategories = sanitizeStringArray(
    record.turnViewExpandedByDefaultCategories,
    CATEGORY_VALUES,
  );
  const turnViewCombinedChangesExpanded = sanitizeOptionalBoolean(
    record.turnViewCombinedChangesExpanded,
  );
  const searchProviders = addMissingProviders(
    sanitizeStringArray(record.searchProviders, enabledProviders),
    enabledProviders,
  );
  const liveWatchEnabled = sanitizeOptionalBoolean(record.liveWatchEnabled);
  const liveWatchRowHasBackground = sanitizeOptionalBoolean(record.liveWatchRowHasBackground);
  const claudeHooksPrompted = sanitizeOptionalBoolean(record.claudeHooksPrompted);
  const theme = sanitizeStringValue(record.theme, THEME_VALUES);
  const darkShikiTheme = sanitizeFamilyShikiTheme(record.darkShikiTheme, "dark");
  const lightShikiTheme = sanitizeFamilyShikiTheme(record.lightShikiTheme, "light");
  const monoFontFamily = sanitizeStringValue(record.monoFontFamily, MONO_FONT_VALUES);
  const regularFontFamily = sanitizeStringValue(record.regularFontFamily, REGULAR_FONT_VALUES);
  const monoFontSize = sanitizeStringValue(record.monoFontSize, MONO_FONT_SIZE_VALUES);
  const regularFontSize = sanitizeStringValue(record.regularFontSize, REGULAR_FONT_SIZE_VALUES);
  const messagePageSize =
    sanitizeNumericValue(record.messagePageSize, MESSAGE_PAGE_SIZE_VALUES) ?? 50;
  const useMonospaceForAllMessages = sanitizeOptionalBoolean(record.useMonospaceForAllMessages);
  const autoHideMessageActions = sanitizeOptionalBoolean(record.autoHideMessageActions);
  const expandPreviewOnHiddenActions = sanitizeOptionalBoolean(record.expandPreviewOnHiddenActions);
  const autoHideViewerHeaderActions = sanitizeOptionalBoolean(record.autoHideViewerHeaderActions);
  const defaultViewerWrapMode =
    sanitizeStringValue(record.defaultViewerWrapMode, VIEWER_WRAP_MODE_VALUES) ?? "wrap";
  const defaultDiffViewMode =
    sanitizeStringValue(record.defaultDiffViewMode, DIFF_VIEW_MODE_VALUES) ?? "unified";
  const collapseMultiFileToolDiffs =
    sanitizeOptionalBoolean(record.collapseMultiFileToolDiffs) ?? true;
  const externalTools =
    sanitizeExternalToolConfigs(record.externalTools, platform) ??
    createDefaultExternalTools(platform);
  const preferredExternalEditor = sanitizePreferredExternalToolId(
    record.preferredExternalEditor,
    externalTools,
    "editor",
    platform,
  );
  const preferredExternalDiffTool = sanitizePreferredExternalToolId(
    record.preferredExternalDiffTool,
    externalTools,
    "diff",
    platform,
  );
  const terminalAppCommand = sanitizeOptionalString(record.terminalAppCommand);
  const selectedProjectId = sanitizeOptionalNonEmptyString(record.selectedProjectId);
  const selectedSessionId = sanitizeOptionalNonEmptyString(record.selectedSessionId);
  const historyMode = sanitizeStringValue(record.historyMode, HISTORY_MODE_VALUES);
  const historyVisualization = sanitizeStringValue(
    record.historyVisualization,
    HISTORY_VISUALIZATION_VALUES,
  );
  const historyDetailMode = sanitizeStringValue(record.historyDetailMode, [
    "flat",
    "turn",
  ] as const);
  const projectViewMode = sanitizeStringValue(record.projectViewMode, PROJECT_VIEW_MODE_VALUES);
  const projectSortField = sanitizeStringValue(record.projectSortField, PROJECT_SORT_FIELD_VALUES);
  const projectSortDirection = sanitizeStringValue(
    record.projectSortDirection,
    SORT_DIRECTION_VALUES,
  );
  const sessionSortDirection = sanitizeStringValue(
    record.sessionSortDirection,
    SORT_DIRECTION_VALUES,
  );
  const messageSortDirection = sanitizeStringValue(
    record.messageSortDirection,
    SORT_DIRECTION_VALUES,
  );
  const bookmarkSortDirection = sanitizeStringValue(
    record.bookmarkSortDirection,
    SORT_DIRECTION_VALUES,
  );
  const projectAllSortDirection = sanitizeStringValue(
    record.projectAllSortDirection,
    SORT_DIRECTION_VALUES,
  );
  const turnViewSortDirection = sanitizeStringValue(
    record.turnViewSortDirection,
    SORT_DIRECTION_VALUES,
  );
  const sessionPage = sanitizeOptionalInt(record.sessionPage, PAGE_MIN, PAGE_MAX);
  const sessionScrollTop = sanitizeOptionalInt(
    record.sessionScrollTop,
    SCROLL_TOP_MIN,
    SCROLL_TOP_MAX,
  );
  const preferredAutoRefreshStrategy = sanitizeStringValue(
    record.preferredAutoRefreshStrategy,
    AUTO_REFRESH_STRATEGY_VALUES,
  );
  const currentAutoRefreshStrategy = sanitizeStringValue(
    record.currentAutoRefreshStrategy,
    CURRENT_AUTO_REFRESH_STRATEGY_VALUES,
  );
  const systemMessageRegexRules = sanitizeSystemMessageRegexRules(record.systemMessageRegexRules);

  return {
    projectPaneWidth,
    sessionPaneWidth,
    ...(projectPaneCollapsed === null ? {} : { projectPaneCollapsed }),
    ...(sessionPaneCollapsed === null ? {} : { sessionPaneCollapsed }),
    ...(singleClickFoldersExpand === null ? {} : { singleClickFoldersExpand }),
    ...(singleClickProjectsExpand === null ? {} : { singleClickProjectsExpand }),
    ...(hideSessionsPaneInTreeView === null ? {} : { hideSessionsPaneInTreeView }),
    ...(projectProviders ? { projectProviders } : {}),
    ...(historyCategories ? { historyCategories } : {}),
    ...(expandedByDefaultCategories ? { expandedByDefaultCategories } : {}),
    ...(turnViewCategories ? { turnViewCategories } : {}),
    ...(turnViewExpandedByDefaultCategories ? { turnViewExpandedByDefaultCategories } : {}),
    ...(turnViewCombinedChangesExpanded === null ? {} : { turnViewCombinedChangesExpanded }),
    ...(searchProviders ? { searchProviders } : {}),
    ...(liveWatchEnabled === null ? {} : { liveWatchEnabled }),
    ...(liveWatchRowHasBackground === null ? {} : { liveWatchRowHasBackground }),
    ...(claudeHooksPrompted === null ? {} : { claudeHooksPrompted }),
    ...(theme ? { theme } : {}),
    darkShikiTheme,
    lightShikiTheme,
    ...(monoFontFamily ? { monoFontFamily } : {}),
    ...(regularFontFamily ? { regularFontFamily } : {}),
    ...(monoFontSize ? { monoFontSize } : {}),
    ...(regularFontSize ? { regularFontSize } : {}),
    messagePageSize,
    ...(useMonospaceForAllMessages === null ? {} : { useMonospaceForAllMessages }),
    ...(autoHideMessageActions === null ? {} : { autoHideMessageActions }),
    ...(expandPreviewOnHiddenActions === null ? {} : { expandPreviewOnHiddenActions }),
    ...(autoHideViewerHeaderActions === null ? {} : { autoHideViewerHeaderActions }),
    defaultViewerWrapMode,
    defaultDiffViewMode,
    collapseMultiFileToolDiffs,
    ...(preferredExternalEditor ? { preferredExternalEditor } : {}),
    ...(preferredExternalDiffTool ? { preferredExternalDiffTool } : {}),
    ...(terminalAppCommand ? { terminalAppCommand } : {}),
    ...(externalTools ? { externalTools } : {}),
    ...(selectedProjectId ? { selectedProjectId } : {}),
    ...(selectedSessionId ? { selectedSessionId } : {}),
    ...(historyMode ? { historyMode } : {}),
    ...(historyVisualization ? { historyVisualization } : {}),
    ...(historyDetailMode ? { historyDetailMode } : {}),
    ...(projectViewMode ? { projectViewMode } : {}),
    ...(projectSortField ? { projectSortField } : {}),
    ...(projectSortDirection ? { projectSortDirection } : {}),
    ...(sessionSortDirection ? { sessionSortDirection } : {}),
    ...(messageSortDirection ? { messageSortDirection } : {}),
    ...(bookmarkSortDirection ? { bookmarkSortDirection } : {}),
    ...(projectAllSortDirection ? { projectAllSortDirection } : {}),
    ...(turnViewSortDirection ? { turnViewSortDirection } : {}),
    ...(sessionPage === null ? {} : { sessionPage }),
    ...(sessionScrollTop === null ? {} : { sessionScrollTop }),
    ...(currentAutoRefreshStrategy ? { currentAutoRefreshStrategy } : {}),
    ...(preferredAutoRefreshStrategy ? { preferredAutoRefreshStrategy } : {}),
    ...(systemMessageRegexRules ? { systemMessageRegexRules } : {}),
  };
}

function sanitizeFamilyShikiTheme(value: unknown, family: "dark" | "light"): ShikiThemeId {
  if (typeof value === "string" && value.trim().length > 0) {
    const trimmed = value.trim();
    if (isShikiThemeId(trimmed) && getShikiThemeFamily(trimmed) === family) {
      return trimmed;
    }
  }
  return getDefaultShikiThemeForFamily(family);
}

function sanitizeIndexingState(value: unknown): IndexingConfigState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const enabledProviders = healLegacyEnabledProviders(
    sanitizeStringArray(record.enabledProviders, PROVIDER_VALUES),
  );
  const removeMissingSessionsDuringIncrementalIndexing = sanitizeOptionalBoolean(
    record.removeMissingSessionsDuringIncrementalIndexing,
  );
  if (!enabledProviders && removeMissingSessionsDuringIncrementalIndexing === null) {
    return null;
  }

  return {
    ...(enabledProviders ? { enabledProviders } : {}),
    ...(removeMissingSessionsDuringIncrementalIndexing === null
      ? {}
      : { removeMissingSessionsDuringIncrementalIndexing }),
  };
}

function healLegacyEnabledProviders(providers: Provider[] | null): Provider[] | null {
  if (providers === null) {
    return null;
  }
  if (!matchesLegacyDefaultProviderSelection(providers)) {
    return providers;
  }
  return addMissingProviders(providers, PROVIDER_VALUES);
}

function matchesLegacyDefaultProviderSelection(providers: readonly Provider[]): boolean {
  return (
    matchesProviderSelection(providers, LEGACY_DEFAULT_ENABLED_PROVIDERS) ||
    matchesProviderSelection(providers, LEGACY_PRE_OPENCODE_ENABLED_PROVIDERS)
  );
}

function matchesProviderSelection(
  providers: readonly Provider[],
  expected: readonly Provider[],
): boolean {
  return (
    providers.length === expected.length &&
    expected.every((provider) => providers.includes(provider))
  );
}

function sanitizeWindowState(value: unknown): WindowState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const width = sanitizeInt(record.width, WINDOW_MIN, WINDOW_MAX);
  const height = sanitizeInt(record.height, WINDOW_MIN, WINDOW_MAX);
  if (width === null || height === null) {
    return null;
  }

  const x = sanitizeOptionalInt(record.x, -20000, 20000);
  const y = sanitizeOptionalInt(record.y, -20000, 20000);
  const isMaximized = record.isMaximized === true;

  return {
    width,
    height,
    ...(x === null ? {} : { x }),
    ...(y === null ? {} : { y }),
    isMaximized,
  };
}

function sanitizeInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    return null;
  }
  return rounded;
}

function sanitizeNumericValue<T extends number>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return allowed.includes(value as T) ? (value as T) : null;
}

function sanitizeOptionalInt(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return sanitizeInt(value, min, max);
}

function addMissingProviders(
  providers: Provider[] | null,
  universe: readonly Provider[] = PROVIDER_VALUES,
): Provider[] | null {
  if (providers === null) {
    return null;
  }
  const result = [...providers];
  for (const provider of universe) {
    if (!result.includes(provider)) {
      result.push(provider);
    }
  }
  return result;
}

function sanitizeStringArray<T extends string>(value: unknown, universe: readonly T[]): T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const deduped: T[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    if (!universe.includes(item as T) || deduped.includes(item as T)) {
      continue;
    }
    deduped.push(item as T);
  }

  return deduped;
}

function sanitizeStringValue<T extends string>(value: unknown, universe: readonly T[]): T | null {
  if (typeof value !== "string") {
    return null;
  }
  return universe.includes(value as T) ? (value as T) : null;
}

function sanitizeOptionalNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length === 0 || value.length > 4096) {
    return null;
  }
  return value;
}

function sanitizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.length <= 4096 ? value : null;
}

function sanitizeOptionalStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > 4096) {
      continue;
    }
    result.push(entry);
  }
  return result;
}

function sanitizeExternalToolConfigs(
  value: unknown,
  platform: DesktopPlatform = DEFAULT_DESKTOP_PLATFORM,
): ExternalToolConfig[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const result: ExternalToolConfig[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = sanitizeOptionalNonEmptyString(record.id);
    const kind = record.kind === "known" || record.kind === "custom" ? record.kind : null;
    const label = sanitizeOptionalNonEmptyString(record.label);
    const appId =
      typeof record.appId === "string" &&
      KNOWN_EXTERNAL_APP_VALUES.includes(record.appId as (typeof KNOWN_EXTERNAL_APP_VALUES)[number])
        ? (record.appId as (typeof KNOWN_EXTERNAL_APP_VALUES)[number])
        : null;
    const command = sanitizeOptionalString(record.command) ?? "";
    const editorArgs = sanitizeOptionalStringArray(record.editorArgs) ?? [];
    const diffArgs = sanitizeOptionalStringArray(record.diffArgs) ?? [];
    const enabledForEditor = sanitizeOptionalBoolean(record.enabledForEditor);
    const enabledForDiff = sanitizeOptionalBoolean(record.enabledForDiff);
    if (!id || !kind || !label) {
      continue;
    }
    if (kind === "known" && appId === null) {
      continue;
    }
    result.push({
      id,
      kind,
      label,
      appId,
      command,
      editorArgs,
      diffArgs,
      enabledForEditor: enabledForEditor ?? kind === "known",
      enabledForDiff: enabledForDiff ?? false,
    });
  }

  return normalizeExternalTools(result, platform);
}

function sanitizePreferredExternalToolId(
  value: unknown,
  tools: ExternalToolConfig[] | null,
  role: "editor" | "diff",
  platform: DesktopPlatform = DEFAULT_DESKTOP_PLATFORM,
): string | null {
  if (!tools || tools.length === 0 || typeof value !== "string" || value.length === 0) {
    return null;
  }
  const enabledTools = getEnabledExternalTools(role, tools, platform);
  if (enabledTools.some((tool) => tool.id === value)) {
    return value;
  }
  return null;
}

function sanitizeOptionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    return null;
  }
  return value;
}

function sanitizeSystemMessageRegexRules(value: unknown): Record<Provider, string[]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rules = createProviderRecord<string[]>(() => []);
  let sawAnyProviderRules = false;

  for (const provider of PROVIDER_VALUES) {
    const rawPatterns = record[provider];
    if (rawPatterns === undefined) {
      continue;
    }
    if (!Array.isArray(rawPatterns) || rawPatterns.length > SYSTEM_MESSAGE_RULES_MAX) {
      continue;
    }

    const patterns: string[] = [];
    for (const rawPattern of rawPatterns) {
      if (typeof rawPattern !== "string") {
        continue;
      }
      const pattern = rawPattern.trim();
      if (pattern.length === 0 || pattern.length > SYSTEM_MESSAGE_RULE_LENGTH_MAX) {
        continue;
      }
      if (!patterns.includes(pattern)) {
        patterns.push(pattern);
      }
    }

    rules[provider] = patterns;
    sawAnyProviderRules = true;
  }

  return sawAnyProviderRules ? rules : null;
}

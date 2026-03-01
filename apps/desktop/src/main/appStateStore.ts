import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { MessageCategory, Provider } from "@codetrail/core";

import {
  type MonoFontFamily,
  type MonoFontSize,
  type RegularFontFamily,
  type RegularFontSize,
  type ThemeMode,
  UI_MESSAGE_CATEGORY_VALUES,
  UI_MONO_FONT_SIZE_VALUES,
  UI_MONO_FONT_VALUES,
  UI_PROVIDER_VALUES,
  UI_REGULAR_FONT_SIZE_VALUES,
  UI_REGULAR_FONT_VALUES,
  UI_THEME_VALUES,
} from "../shared/uiPreferences";

export type PaneState = {
  projectPaneWidth: number;
  sessionPaneWidth: number;
  projectProviders?: Provider[];
  historyCategories?: MessageCategory[];
  expandedByDefaultCategories?: MessageCategory[];
  searchProviders?: Provider[];
  theme?: ThemeMode;
  monoFontFamily?: MonoFontFamily;
  regularFontFamily?: RegularFontFamily;
  monoFontSize?: MonoFontSize;
  regularFontSize?: RegularFontSize;
  useMonospaceForAllMessages?: boolean;
  selectedProjectId?: string;
  selectedSessionId?: string;
  historyMode?: "session" | "bookmarks" | "project_all";
  projectSortDirection?: "asc" | "desc";
  sessionSortDirection?: "asc" | "desc";
  messageSortDirection?: "asc" | "desc";
  bookmarkSortDirection?: "asc" | "desc";
  projectAllSortDirection?: "asc" | "desc";
  sessionPage?: number;
  sessionScrollTop?: number;
  systemMessageRegexRules?: Record<Provider, string[]>;
};

export type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
};

type AppState = {
  pane?: PaneState;
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
const HISTORY_MODE_VALUES = ["session", "bookmarks", "project_all"] as const;
const SORT_DIRECTION_VALUES = ["asc", "desc"] as const;
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

export class AppStateStore {
  private readonly filePath: string;
  private readonly fileSystem: AppStateStoreFileSystem;
  private readonly timer: AppStateStoreTimer;
  private readonly onPersistError: (error: unknown) => void;
  private state: AppState;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string, dependencies: AppStateStoreDependencies = {}) {
    this.filePath = filePath;
    this.fileSystem = dependencies.fs ?? DEFAULT_FILE_SYSTEM;
    this.timer = dependencies.timer ?? DEFAULT_TIMER;
    this.onPersistError =
      dependencies.onPersistError ??
      ((error) => {
        console.error("[codetrail] failed persisting app state", error);
      });
    this.state = readState(filePath, this.fileSystem);
  }

  getFilePath(): string {
    return this.filePath;
  }

  getPaneState(): PaneState | null {
    return this.state.pane ?? null;
  }

  setPaneState(value: PaneState): void {
    const pane = sanitizePaneState(value);
    if (!pane) {
      return;
    }
    this.state = {
      ...this.state,
      pane,
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

function readState(filePath: string, fileSystem: AppStateStoreFileSystem): AppState {
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
    const pane = sanitizePaneState(record.pane);
    const window = sanitizeWindowState(record.window);
    return {
      ...(pane ? { pane } : {}),
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

function sanitizePaneState(value: unknown): PaneState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const projectPaneWidth = sanitizeInt(record.projectPaneWidth, PANE_MIN, PANE_MAX);
  const sessionPaneWidth = sanitizeInt(record.sessionPaneWidth, PANE_MIN, PANE_MAX);
  if (projectPaneWidth === null || sessionPaneWidth === null) {
    return null;
  }
  const projectProviders = sanitizeStringArray(record.projectProviders, PROVIDER_VALUES);
  const historyCategories = sanitizeStringArray(record.historyCategories, CATEGORY_VALUES);
  const expandedByDefaultCategories = sanitizeStringArray(
    record.expandedByDefaultCategories,
    CATEGORY_VALUES,
  );
  const searchProviders = sanitizeStringArray(record.searchProviders, PROVIDER_VALUES);
  const theme = sanitizeStringValue(record.theme, THEME_VALUES);
  const monoFontFamily = sanitizeStringValue(record.monoFontFamily, MONO_FONT_VALUES);
  const regularFontFamily = sanitizeStringValue(record.regularFontFamily, REGULAR_FONT_VALUES);
  const monoFontSize = sanitizeStringValue(record.monoFontSize, MONO_FONT_SIZE_VALUES);
  const regularFontSize = sanitizeStringValue(record.regularFontSize, REGULAR_FONT_SIZE_VALUES);
  const useMonospaceForAllMessages = sanitizeOptionalBoolean(record.useMonospaceForAllMessages);
  const selectedProjectId = sanitizeOptionalNonEmptyString(record.selectedProjectId);
  const selectedSessionId = sanitizeOptionalNonEmptyString(record.selectedSessionId);
  const historyMode = sanitizeStringValue(record.historyMode, HISTORY_MODE_VALUES);
  const projectSortDirection = sanitizeStringValue(record.projectSortDirection, SORT_DIRECTION_VALUES);
  const sessionSortDirection = sanitizeStringValue(record.sessionSortDirection, SORT_DIRECTION_VALUES);
  const messageSortDirection = sanitizeStringValue(record.messageSortDirection, SORT_DIRECTION_VALUES);
  const bookmarkSortDirection = sanitizeStringValue(
    record.bookmarkSortDirection,
    SORT_DIRECTION_VALUES,
  );
  const projectAllSortDirection = sanitizeStringValue(
    record.projectAllSortDirection,
    SORT_DIRECTION_VALUES,
  );
  const sessionPage = sanitizeOptionalInt(record.sessionPage, PAGE_MIN, PAGE_MAX);
  const sessionScrollTop = sanitizeOptionalInt(
    record.sessionScrollTop,
    SCROLL_TOP_MIN,
    SCROLL_TOP_MAX,
  );
  const systemMessageRegexRules = sanitizeSystemMessageRegexRules(record.systemMessageRegexRules);

  return {
    projectPaneWidth,
    sessionPaneWidth,
    ...(projectProviders ? { projectProviders } : {}),
    ...(historyCategories ? { historyCategories } : {}),
    ...(expandedByDefaultCategories ? { expandedByDefaultCategories } : {}),
    ...(searchProviders ? { searchProviders } : {}),
    ...(theme ? { theme } : {}),
    ...(monoFontFamily ? { monoFontFamily } : {}),
    ...(regularFontFamily ? { regularFontFamily } : {}),
    ...(monoFontSize ? { monoFontSize } : {}),
    ...(regularFontSize ? { regularFontSize } : {}),
    ...(useMonospaceForAllMessages === null ? {} : { useMonospaceForAllMessages }),
    ...(selectedProjectId ? { selectedProjectId } : {}),
    ...(selectedSessionId ? { selectedSessionId } : {}),
    ...(historyMode ? { historyMode } : {}),
    ...(projectSortDirection ? { projectSortDirection } : {}),
    ...(sessionSortDirection ? { sessionSortDirection } : {}),
    ...(messageSortDirection ? { messageSortDirection } : {}),
    ...(bookmarkSortDirection ? { bookmarkSortDirection } : {}),
    ...(projectAllSortDirection ? { projectAllSortDirection } : {}),
    ...(sessionPage === null ? {} : { sessionPage }),
    ...(sessionScrollTop === null ? {} : { sessionScrollTop }),
    ...(systemMessageRegexRules ? { systemMessageRegexRules } : {}),
  };
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

function sanitizeOptionalInt(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return sanitizeInt(value, min, max);
}

function sanitizeStringArray<T extends string>(value: unknown, universe: readonly T[]): T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const deduped: T[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    if (!universe.includes(item as T) || deduped.includes(item as T)) {
      return null;
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
  const rules: Record<Provider, string[]> = {
    claude: [],
    codex: [],
    gemini: [],
  };

  for (const provider of PROVIDER_VALUES) {
    const rawPatterns = record[provider];
    if (!Array.isArray(rawPatterns) || rawPatterns.length > SYSTEM_MESSAGE_RULES_MAX) {
      return null;
    }

    const patterns: string[] = [];
    for (const rawPattern of rawPatterns) {
      if (typeof rawPattern !== "string") {
        return null;
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
  }

  return rules;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { MessageCategory, Provider } from "@codetrail/core";

export type ThemeMode = "light" | "dark";
export type MonoFontFamily = "current" | "droid_sans_mono";
export type RegularFontFamily = "current" | "inter";
export type MonoFontSize =
  | "10px"
  | "11px"
  | "12px"
  | "13px"
  | "14px"
  | "15px"
  | "16px"
  | "17px"
  | "18px";
export type RegularFontSize =
  | "11px"
  | "12px"
  | "13px"
  | "13.5px"
  | "14px"
  | "15px"
  | "16px"
  | "17px"
  | "18px"
  | "20px";

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
  sessionPage?: number;
  sessionScrollTop?: number;
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

const PANE_MIN = 120;
const PANE_MAX = 2000;
const PAGE_MIN = 0;
const PAGE_MAX = 1_000_000;
const SCROLL_TOP_MIN = 0;
const SCROLL_TOP_MAX = 10_000_000;
const WINDOW_MIN = 320;
const WINDOW_MAX = 6000;
const PROVIDER_VALUES: Provider[] = ["claude", "codex", "gemini"];
const CATEGORY_VALUES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_edit",
  "tool_use",
  "tool_result",
  "thinking",
  "system",
];
const THEME_VALUES: ThemeMode[] = ["light", "dark"];
const MONO_FONT_VALUES: MonoFontFamily[] = ["current", "droid_sans_mono"];
const REGULAR_FONT_VALUES: RegularFontFamily[] = ["current", "inter"];
const MONO_FONT_SIZE_VALUES: MonoFontSize[] = [
  "10px",
  "11px",
  "12px",
  "13px",
  "14px",
  "15px",
  "16px",
  "17px",
  "18px",
];
const REGULAR_FONT_SIZE_VALUES: RegularFontSize[] = [
  "11px",
  "12px",
  "13px",
  "13.5px",
  "14px",
  "15px",
  "16px",
  "17px",
  "18px",
  "20px",
];

export class AppStateStore {
  private readonly filePath: string;
  private state: AppState;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.state = readState(filePath);
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
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    persistState(this.filePath, this.state);
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      persistState(this.filePath, this.state);
    }, 150);
  }
}

export function createAppStateStore(filePath: string): AppStateStore {
  return new AppStateStore(filePath);
}

function readState(filePath: string): AppState {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, "utf8");
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

function persistState(filePath: string, state: AppState): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("[codetrail] failed persisting app state", error);
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
  const sessionPage = sanitizeOptionalInt(record.sessionPage, PAGE_MIN, PAGE_MAX);
  const sessionScrollTop = sanitizeOptionalInt(
    record.sessionScrollTop,
    SCROLL_TOP_MIN,
    SCROLL_TOP_MAX,
  );

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
    ...(sessionPage === null ? {} : { sessionPage }),
    ...(sessionScrollTop === null ? {} : { sessionScrollTop }),
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

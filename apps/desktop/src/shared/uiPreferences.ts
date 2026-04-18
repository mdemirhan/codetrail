import { type MessageCategory, PROVIDER_VALUES, type Provider } from "@codetrail/core/browser";

export {
  DEFAULT_DARK_SHIKI_THEME,
  DEFAULT_LIGHT_SHIKI_THEME,
  SHIKI_THEME_GROUPS,
  SHIKI_THEME_OPTIONS,
  UI_SHIKI_THEME_VALUES,
  getDefaultShikiThemeForFamily,
  getShikiThemeFamily,
  getShikiThemeLabel,
  isShikiThemeId,
  resolveShikiThemeForFamily,
  type ShikiThemeId,
} from "./textViewerThemes";
export {
  EXTERNAL_APP_OPTIONS,
  KNOWN_EXTERNAL_APP_VALUES,
  buildRoleToolFromCatalog,
  buildRoleToolFromCustomTool,
  buildRoleToolsFromCatalog,
  createCustomExternalToolCatalog,
  createCustomExternalTool,
  createDefaultExternalTools,
  createKnownExternalTool,
  createKnownToolId,
  createRoleToolIdFromCustomTool,
  getEnabledExternalTools,
  getExternalAppOptions,
  getExternalAppLabel,
  getExternalToolById,
  getPreferredExternalToolId,
  isExternalToolEnabled,
  normalizeExternalTools,
  supportsKnownToolRole,
  type CustomExternalToolConfig,
  type ExternalEditorId,
  type ExternalRoleToolConfig,
  type ExternalToolConfig,
  type ExternalToolId,
  type ExternalToolRole,
  type KnownExternalAppId,
} from "./externalTools";
import {
  DEFAULT_DARK_SHIKI_THEME,
  DEFAULT_LIGHT_SHIKI_THEME,
  SHIKI_THEME_GROUPS,
  type ShikiThemeId,
  getDefaultShikiThemeForFamily,
  resolveShikiThemeForFamily,
} from "./textViewerThemes";

export const UI_THEME_VALUES = [
  "light",
  "dark",
  "ft-dark",
  "tomorrow-night",
  "catppuccin-mocha",
  "obsidian-blue",
  "obsidian",
  "graphite",
  "midnight",
  "onyx",
  "clean-white",
  "warm-paper",
  "stone",
  "sand",
] as const;

export type ThemeMode = (typeof UI_THEME_VALUES)[number];
export type MonoFontFamily = "current" | "droid_sans_mono";
export type RegularFontFamily = "current" | "inter" | "lexend";
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
export type MessagePageSize = 10 | 25 | 50 | 100 | 250;
export type ViewerWrapMode = "nowrap" | "wrap";
export type DiffViewMode = "unified" | "split";

export const UI_PROVIDER_VALUES: Provider[] = [...PROVIDER_VALUES];

export const UI_MESSAGE_CATEGORY_VALUES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_edit",
  "tool_use",
  "tool_result",
  "thinking",
  "system",
];

export const THEME_OPTIONS = [
  { value: "dark", label: "Dark", group: "dark" },
  { value: "ft-dark", label: "FT Dark", group: "dark" },
  { value: "tomorrow-night", label: "Tomorrow Night", group: "dark" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha", group: "dark" },
  { value: "obsidian-blue", label: "Obsidian Blue", group: "dark" },
  { value: "obsidian", label: "Obsidian", group: "dark" },
  { value: "graphite", label: "Graphite", group: "dark" },
  { value: "midnight", label: "Midnight", group: "dark" },
  { value: "onyx", label: "Onyx", group: "dark" },
  { value: "light", label: "Light", group: "light" },
  { value: "clean-white", label: "Clean White", group: "light" },
  { value: "warm-paper", label: "Warm Paper", group: "light" },
  { value: "stone", label: "Stone", group: "light" },
  { value: "sand", label: "Sand", group: "light" },
] as const satisfies ReadonlyArray<{
  value: ThemeMode;
  label: string;
  group: "dark" | "light";
}>;

export const THEME_GROUPS = [
  {
    value: "dark",
    label: "Dark Themes",
    options: THEME_OPTIONS.filter((option) => option.group === "dark"),
  },
  {
    value: "light",
    label: "Light Themes",
    options: THEME_OPTIONS.filter((option) => option.group === "light"),
  },
] as const;

export function getThemeFamily(theme: ThemeMode): "dark" | "light" {
  return THEME_OPTIONS.find((option) => option.value === theme)?.group ?? "dark";
}

export function getShikiThemeGroupForUiTheme(theme: ThemeMode) {
  const family = getThemeFamily(theme);
  return SHIKI_THEME_GROUPS.find((group) => group.value === family) ?? SHIKI_THEME_GROUPS[0];
}

export function getDefaultShikiThemeForUiTheme(theme: ThemeMode): ShikiThemeId {
  return getDefaultShikiThemeForFamily(getThemeFamily(theme));
}

export function resolveShikiThemeForUiTheme(
  theme: ThemeMode,
  darkTheme: string | null | undefined,
  lightTheme: string | null | undefined,
): ShikiThemeId {
  const family = getThemeFamily(theme);
  return resolveShikiThemeForFamily(family, family === "dark" ? darkTheme : lightTheme);
}

export const UI_MONO_FONT_VALUES: MonoFontFamily[] = ["current", "droid_sans_mono"];
export const UI_REGULAR_FONT_VALUES: RegularFontFamily[] = ["current", "inter", "lexend"];
export const UI_MESSAGE_PAGE_SIZE_VALUES: MessagePageSize[] = [10, 25, 50, 100, 250];
export const UI_VIEWER_WRAP_MODE_VALUES: ViewerWrapMode[] = ["nowrap", "wrap"];
export const UI_DIFF_VIEW_MODE_VALUES: DiffViewMode[] = ["unified", "split"];

export const UI_MONO_FONT_SIZE_VALUES: MonoFontSize[] = [
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

export const UI_REGULAR_FONT_SIZE_VALUES: RegularFontSize[] = [
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

export function getThemeLabel(theme: ThemeMode): string {
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? theme;
}

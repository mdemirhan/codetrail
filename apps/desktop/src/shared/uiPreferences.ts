import type { MessageCategory, Provider } from "@codetrail/core";

export const UI_THEME_VALUES = [
  "light",
  "dark",
  "ft-dark",
  "tomorrow-night",
  "catppuccin-mocha",
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

export const UI_PROVIDER_VALUES: Provider[] = ["claude", "codex", "gemini", "cursor", "opencode"];

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

export const UI_MONO_FONT_VALUES: MonoFontFamily[] = ["current", "droid_sans_mono"];
export const UI_REGULAR_FONT_VALUES: RegularFontFamily[] = ["current", "inter"];

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

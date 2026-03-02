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

export const UI_PROVIDER_VALUES: Provider[] = ["claude", "codex", "gemini", "cursor"];

export const UI_MESSAGE_CATEGORY_VALUES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_edit",
  "tool_use",
  "tool_result",
  "thinking",
  "system",
];

export const UI_THEME_VALUES: ThemeMode[] = ["light", "dark"];
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

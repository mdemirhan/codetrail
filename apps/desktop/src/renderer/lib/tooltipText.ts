const MODIFIER_SYMBOLS = {
  Cmd: "⌘",
  Ctrl: "⌃",
  Shift: "⇧",
  Alt: "⌥",
  Option: "⌥",
} as const;

const KEY_SYMBOLS = {
  Plus: "+",
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
} as const;

function formatShortcutSequence(sequence: string): string {
  const trimmed = sequence.trim().replace(/\+\+$/u, "+Plus");
  if (trimmed.length === 0) {
    return "";
  }
  const tokens = trimmed.split("+").map((token) => token.trim());
  return tokens
    .map((token) => {
      if (token in MODIFIER_SYMBOLS) {
        return MODIFIER_SYMBOLS[token as keyof typeof MODIFIER_SYMBOLS];
      }
      if (token in KEY_SYMBOLS) {
        return KEY_SYMBOLS[token as keyof typeof KEY_SYMBOLS];
      }
      return token;
    })
    .join("");
}

export function formatShortcutDisplay(shortcut: string): string {
  return formatShortcutSequence(shortcut);
}

export function formatTooltip(action: string, shortcut?: string | null): string {
  if (!shortcut) {
    return action;
  }
  return `${action}  ${formatShortcutDisplay(shortcut)}`;
}

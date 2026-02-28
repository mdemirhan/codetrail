import type { MessageCategory, Provider } from "@codetrail/core";

export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

export const CATEGORY_LABELS: Record<MessageCategory, string> = {
  user: "User",
  assistant: "Assistant",
  tool_use: "Tool Use",
  tool_edit: "Write",
  tool_result: "Tool Result",
  thinking: "Thinking",
  system: "System",
};

type SessionSummaryLike = {
  id: string;
  title: string;
  modelNames: string;
  startedAt: string | null;
  endedAt: string | null;
};

export function toggleValue<T>(values: T[], value: T): T[] {
  if (values.includes(value)) {
    return values.filter((item) => item !== value);
  }
  return [...values, value];
}

export function toggleRequiredValue<T>(values: T[], value: T, universe: readonly T[]): T[] {
  if (values.includes(value)) {
    if (values.length <= 1) {
      return values;
    }
    return values.filter((item) => item !== value);
  }

  const next = [...values, value];
  if (next.length >= universe.length) {
    return [...universe];
  }
  return next;
}

export function sessionActivityOf(session: SessionSummaryLike): string | null {
  return session.endedAt ?? session.startedAt;
}

export function compareRecent(left: string | null, right: string | null): number {
  const leftTs = left ? new Date(left).getTime() : Number.NEGATIVE_INFINITY;
  const rightTs = right ? new Date(right).getTime() : Number.NEGATIVE_INFINITY;
  return leftTs - rightTs;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (isToday) {
    return `Today ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date)}`;
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

export function prettyCategory(category: MessageCategory): string {
  return CATEGORY_LABELS[category];
}

export function prettyProvider(provider: Provider): string {
  return PROVIDER_LABELS[provider];
}

export function countProviders(values: Provider[]): Record<Provider, number> {
  const counts: Record<Provider, number> = { claude: 0, codex: 0, gemini: 0 };
  for (const value of values) {
    counts[value] += 1;
  }
  return counts;
}

export function deriveSessionTitle(session: SessionSummaryLike): string {
  const source = session.title.trim();
  if (!source) {
    return session.modelNames || session.id;
  }
  const singleLine = source.replace(/\s+/g, " ").trim();
  const words = singleLine.split(" ");
  const compactWords = words.slice(0, 12).join(" ");
  const preview = words.length > 12 ? `${compactWords}…` : compactWords;
  const maxLength = 84;
  if (preview.length <= maxLength) {
    return preview;
  }
  return `${preview.slice(0, maxLength - 1)}…`;
}

export function compactPath(path: string): string {
  if (!path) {
    return "(no path)";
  }
  const unixHome = path.match(/^\/Users\/[^/]+/);
  if (unixHome) {
    return `~${path.slice(unixHome[0].length)}`;
  }

  const windowsHome = path.match(/^[A-Za-z]:\\Users\\[^\\]+/);
  if (windowsHome) {
    return `~${path.slice(windowsHome[0].length)}`;
  }
  return path;
}

export function parentPath(path: string): string {
  if (!path) {
    return "";
  }
  const separator = path.includes("\\") ? "\\" : "/";
  const index = path.lastIndexOf(separator);
  if (index <= 0) {
    return path;
  }
  return path.slice(0, index);
}

export function toErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

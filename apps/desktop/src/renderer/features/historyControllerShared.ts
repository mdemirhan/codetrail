import type { Dispatch, SetStateAction } from "react";

import type {
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ThemeMode,
} from "../../shared/uiPreferences";

export type AppearanceState = {
  theme: ThemeMode;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  monoFontFamily: MonoFontFamily;
  setMonoFontFamily: Dispatch<SetStateAction<MonoFontFamily>>;
  regularFontFamily: RegularFontFamily;
  setRegularFontFamily: Dispatch<SetStateAction<RegularFontFamily>>;
  monoFontSize: MonoFontSize;
  setMonoFontSize: Dispatch<SetStateAction<MonoFontSize>>;
  regularFontSize: RegularFontSize;
  setRegularFontSize: Dispatch<SetStateAction<RegularFontSize>>;
  useMonospaceForAllMessages: boolean;
  setUseMonospaceForAllMessages: Dispatch<SetStateAction<boolean>>;
};

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return "-";
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function scrollFocusedHistoryMessageIntoView(
  container: HTMLDivElement,
  messageElement: HTMLDivElement,
): void {
  const containerRect = container.getBoundingClientRect();
  const messageRect = messageElement.getBoundingClientRect();
  const containerHeight = container.clientHeight || containerRect.height;
  const messageHeight = messageRect.height;

  if (containerHeight > 0 && messageHeight > containerHeight) {
    const nextScrollTop = Math.max(0, container.scrollTop + (messageRect.top - containerRect.top));
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: nextScrollTop });
      return;
    }
    container.scrollTop = nextScrollTop;
    return;
  }

  messageElement.scrollIntoView({
    block: "center",
  });
}

export function focusHistoryList(container: HTMLDivElement | null): void {
  window.setTimeout(() => {
    container?.focus({ preventScroll: true });
  }, 0);
}

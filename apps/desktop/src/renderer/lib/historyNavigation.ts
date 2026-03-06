export type Direction = "next" | "previous";

type ItemLike = {
  id: string;
};

const MESSAGE_SELECTOR = "[data-history-message-id]";

export function getAdjacentItemId<T extends ItemLike>(
  items: T[],
  currentId: string,
  direction: Direction,
): string | null {
  if (items.length === 0) {
    return null;
  }

  if (!currentId) {
    return items[0]?.id ?? null;
  }

  const currentIndex = items.findIndex((item) => item.id === currentId);
  if (currentIndex < 0) {
    return items[0]?.id ?? null;
  }

  const nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
  return items[nextIndex]?.id ?? null;
}

export function getEdgeItemId<T extends ItemLike>(
  items: T[],
  direction: Direction,
): string | null {
  if (items.length === 0) {
    return null;
  }

  return direction === "next" ? (items[0]?.id ?? null) : (items[items.length - 1]?.id ?? null);
}

export function getFirstVisibleMessageId(container: HTMLElement | null): string {
  if (!container) {
    return "";
  }

  const messageElements = Array.from(
    container.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR),
  );
  if (messageElements.length === 0) {
    return "";
  }

  const containerRect = container.getBoundingClientRect();
  const hasViewport =
    Number.isFinite(containerRect.top) &&
    Number.isFinite(containerRect.bottom) &&
    containerRect.bottom > containerRect.top;

  if (!hasViewport) {
    return messageElements[0]?.dataset.historyMessageId ?? "";
  }

  for (const messageElement of messageElements) {
    const rect = messageElement.getBoundingClientRect();
    if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
      return messageElement.dataset.historyMessageId ?? "";
    }
  }

  return messageElements[0]?.dataset.historyMessageId ?? "";
}

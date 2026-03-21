export type Direction = "next" | "previous";

type ItemLike = {
  id: string;
};

const MESSAGE_SELECTOR = "[data-history-message-id]";
const PROJECT_SELECTOR = "[data-project-nav-id]";
const PROJECT_NAV_SELECTOR = "[data-project-nav-kind]";

export type ProjectNavigationTarget =
  | { kind: "project"; id: string }
  | { kind: "folder"; id: string }
  | { kind: "session"; id: string; projectId: string };

export type VisibleProjectNavigationTarget =
  | {
      kind: "project";
      id: string;
      element: HTMLElement;
    }
  | {
      kind: "folder";
      id: string;
      element: HTMLElement;
      firstProjectId: string;
      lastProjectId: string;
      expanded: boolean;
    }
  | {
      kind: "session";
      id: string;
      projectId: string;
      element: HTMLElement;
    };

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

export function getEdgeItemId<T extends ItemLike>(items: T[], direction: Direction): string | null {
  if (items.length === 0) {
    return null;
  }

  return direction === "next" ? (items[0]?.id ?? null) : (items[items.length - 1]?.id ?? null);
}

export function getFirstVisibleMessageId(container: HTMLElement | null): string {
  if (!container) {
    return "";
  }

  const messageElements = Array.from(container.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR));
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

export function getAdjacentVisibleProjectId(
  container: HTMLElement | null,
  currentId: string,
  direction: Direction,
): string {
  if (!container) {
    return "";
  }

  const projectElements = Array.from(container.querySelectorAll<HTMLElement>(PROJECT_SELECTOR));
  const projectIds = projectElements
    .map((element) => element.dataset.projectNavId ?? "")
    .filter((id) => id.length > 0);

  if (projectIds.length === 0) {
    return "";
  }

  const nextProjectId = getAdjacentItemId(
    projectIds.map((id) => ({ id })),
    currentId,
    direction,
  );

  return nextProjectId ?? "";
}

function getNavigationTargetKey(target: ProjectNavigationTarget | null): string {
  return target ? `${target.kind}:${target.id}` : "";
}

export function getProjectNavigationTargetFromElement(
  element: HTMLElement | null,
): ProjectNavigationTarget | null {
  const navElement = element?.closest<HTMLElement>(PROJECT_NAV_SELECTOR) ?? null;
  if (!navElement) {
    return null;
  }

  if (navElement.dataset.projectNavKind === "project") {
    const projectId = navElement.dataset.projectNavId ?? "";
    return projectId ? { kind: "project", id: projectId } : null;
  }

  if (navElement.dataset.projectNavKind === "folder") {
    const folderId = navElement.dataset.folderId ?? "";
    return folderId ? { kind: "folder", id: folderId } : null;
  }

  if (navElement.dataset.projectNavKind === "session") {
    const sessionId = navElement.dataset.sessionId ?? "";
    const projectId = navElement.dataset.projectId ?? "";
    return sessionId && projectId ? { kind: "session", id: sessionId, projectId } : null;
  }

  return null;
}

export function getProjectNavigationTargetFromContainer(
  container: HTMLElement | null,
): ProjectNavigationTarget | null {
  if (!container) {
    return null;
  }
  const activeElement = container.querySelector<HTMLElement>(`${PROJECT_NAV_SELECTOR}.active`);
  return getProjectNavigationTargetFromElement(activeElement);
}

function getVisibleProjectNavigationTargetFromElement(
  element: HTMLElement | null,
): VisibleProjectNavigationTarget | null {
  const navElement = element?.closest<HTMLElement>(PROJECT_NAV_SELECTOR) ?? null;
  if (!navElement) {
    return null;
  }

  if (navElement.dataset.projectNavKind === "project") {
    const projectId = navElement.dataset.projectNavId ?? "";
    return projectId
      ? {
          kind: "project",
          id: projectId,
          element: navElement,
        }
      : null;
  }

  if (navElement.dataset.projectNavKind === "folder") {
    const folderId = navElement.dataset.folderId ?? "";
    return folderId
      ? {
          kind: "folder",
          id: folderId,
          element: navElement,
          firstProjectId: navElement.dataset.folderFirstProjectId ?? "",
          lastProjectId: navElement.dataset.folderLastProjectId ?? "",
          expanded: navElement.getAttribute("aria-expanded") === "true",
        }
      : null;
  }

  if (navElement.dataset.projectNavKind === "session") {
    const sessionId = navElement.dataset.sessionId ?? "";
    const projectId = navElement.dataset.projectId ?? "";
    return sessionId && projectId
      ? {
          kind: "session",
          id: sessionId,
          projectId,
          element: navElement,
        }
      : null;
  }

  return null;
}

export function getAdjacentVisibleProjectTarget(
  container: HTMLElement | null,
  currentTarget: ProjectNavigationTarget | null,
  direction: Direction,
): VisibleProjectNavigationTarget | null {
  if (!container) {
    return null;
  }

  const navElements = Array.from(container.querySelectorAll<HTMLElement>(PROJECT_NAV_SELECTOR))
    .map((element) => getVisibleProjectNavigationTargetFromElement(element))
    .filter((target): target is VisibleProjectNavigationTarget => target !== null);
  if (navElements.length === 0) {
    return null;
  }

  const currentKey = getNavigationTargetKey(currentTarget);
  const currentIndex = currentKey
    ? navElements.findIndex((target) => getNavigationTargetKey(target) === currentKey)
    : -1;

  if (currentIndex < 0) {
    return navElements[0] ?? null;
  }

  const step = direction === "next" ? 1 : -1;
  for (let index = currentIndex + step; index >= 0 && index < navElements.length; index += step) {
    const target = navElements[index];
    if (target) {
      return target;
    }
  }

  return null;
}

export function getProjectParentFolderTarget(
  container: HTMLElement | null,
  projectId: string,
): VisibleProjectNavigationTarget | null {
  if (!container || !projectId) {
    return null;
  }

  const projectElement = container.querySelector<HTMLElement>(
    `${PROJECT_SELECTOR}[data-project-nav-id="${CSS.escape(projectId)}"]`,
  );
  const parentFolderId = projectElement?.dataset.parentFolderId ?? "";
  if (!parentFolderId) {
    return null;
  }
  const folderElement = container.querySelector<HTMLElement>(
    `[data-project-nav-kind="folder"][data-folder-id="${CSS.escape(parentFolderId)}"]`,
  );
  return getVisibleProjectNavigationTargetFromElement(folderElement);
}

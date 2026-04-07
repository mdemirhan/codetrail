import {
  type MouseEvent as ReactMouseEvent,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { isEditableTarget } from "./focusTargets";

export type HistoryPaneId = "project" | "session" | "message";
export type ViewFocusDomainId = "dashboard" | "search" | "settings" | "help";
export type FocusDomain =
  | { kind: "history"; pane: HistoryPaneId }
  | { kind: ViewFocusDomainId }
  | { kind: "overlay"; returnDomain: FocusRestorationDomain | null };
type FocusRestorationDomain = Exclude<FocusDomain, { kind: "overlay" }>;

type HistoryPaneRegistration = {
  root: HTMLElement | null;
  focusTarget: HTMLElement | null;
};

type ViewTargetRegistration = Record<ViewFocusDomainId, HTMLElement | null>;
type OverlayEntry = {
  token: number;
  returnDomain: FocusRestorationDomain | null;
};

export type PaneFocusController = {
  activeDomain: FocusDomain;
  lastHistoryPane: HistoryPaneId;
  overlayDepth: number;
  registerHistoryPaneRoot: (pane: HistoryPaneId, element: HTMLElement | null) => void;
  registerHistoryPaneTarget: (pane: HistoryPaneId, element: HTMLElement | null) => void;
  registerViewTarget: (view: ViewFocusDomainId, element: HTMLElement | null) => void;
  focusHistoryPane: (pane: HistoryPaneId, options?: { preventScroll?: boolean }) => void;
  restoreLastHistoryPane: () => void;
  setActiveHistoryPane: (pane: HistoryPaneId) => void;
  enterView: (view: ViewFocusDomainId) => void;
  exitViewAndRestoreHistoryPane: (returnDomainOverride?: FocusRestorationDomain | null) => void;
  pushOverlay: (returnDomain?: FocusRestorationDomain | null) => number;
  popOverlayAndRestore: (token: number) => void;
  isHistoryPaneActive: (pane: HistoryPaneId) => boolean;
  isFocusWithinHistoryPane: (pane: HistoryPaneId, element?: Element | null) => boolean;
  isOverlayOpen: boolean;
  resolveAvailableHistoryPane: (preferredPane?: HistoryPaneId | null) => HistoryPaneId;
  getHistoryPaneRootProps: (pane: HistoryPaneId) => {
    "data-history-pane": HistoryPaneId;
    "data-pane-active"?: "true";
    onFocusCapture: () => void;
  };
  getPaneChromeProps: (pane: HistoryPaneId) => {
    onMouseDownCapture: (event: ReactMouseEvent<HTMLElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  };
  getPreservePaneFocusProps: (pane: HistoryPaneId) => {
    onMouseDownCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  };
  getPreserveHistoryFocusProps: () => {
    onMouseDownCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  };
};

const HISTORY_PANES: HistoryPaneId[] = ["project", "session", "message"];

const PaneFocusContext = createContext<PaneFocusController | null>(null);

function focusElement(element: HTMLElement | null, { preventScroll = true } = {}): void {
  element?.focus({ preventScroll });
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, input, select, textarea, a, label, [role="button"], [role="menuitem"], [contenteditable="true"]',
    ),
  );
}

function isPaneAvailable(registration: HistoryPaneRegistration): boolean {
  if (!registration.root || !registration.focusTarget) {
    return false;
  }
  if (registration.root.classList.contains("collapsed")) {
    return false;
  }
  const styles = window.getComputedStyle(registration.root);
  if (styles.display === "none" || styles.visibility === "hidden") {
    return false;
  }
  return registration.root.isConnected;
}

function isElementWithinHistoryPane(
  registration: HistoryPaneRegistration,
  element: Element | null | undefined,
): boolean {
  if (!element) {
    return false;
  }
  return Boolean(
    registration.root?.contains(element) || registration.focusTarget?.contains(element),
  );
}

function nonOverlayDomain(domain: FocusDomain): FocusRestorationDomain | null {
  if (domain.kind === "overlay") {
    return domain.returnDomain;
  }
  return domain;
}

export function useCreatePaneFocusController(): PaneFocusController {
  const historyPaneRegistrationsRef = useRef<Record<HistoryPaneId, HistoryPaneRegistration>>({
    project: { root: null, focusTarget: null },
    session: { root: null, focusTarget: null },
    message: { root: null, focusTarget: null },
  });
  const viewTargetsRef = useRef<ViewTargetRegistration>({
    dashboard: null,
    search: null,
    settings: null,
    help: null,
  });
  const overlayStackRef = useRef<OverlayEntry[]>([]);
  const overlayTokenRef = useRef(0);
  const viewReturnDomainRef = useRef<FocusRestorationDomain | null>(null);
  const [activeDomain, setActiveDomain] = useState<FocusDomain>({
    kind: "history",
    pane: "message",
  });
  const [lastHistoryPane, setLastHistoryPane] = useState<HistoryPaneId>("message");
  const [overlayDepth, setOverlayDepth] = useState(0);
  const activeDomainRef = useRef(activeDomain);
  const lastHistoryPaneRef = useRef(lastHistoryPane);
  activeDomainRef.current = activeDomain;
  lastHistoryPaneRef.current = lastHistoryPane;

  const resolveAvailableHistoryPane = useCallback((preferredPane?: HistoryPaneId | null) => {
    const preferred = preferredPane ?? lastHistoryPaneRef.current;
    const candidates: HistoryPaneId[] = [
      preferred,
      lastHistoryPaneRef.current,
      "message",
      "project",
      "session",
    ].filter((pane, index, all): pane is HistoryPaneId => all.indexOf(pane) === index);

    for (const candidate of candidates) {
      if (isPaneAvailable(historyPaneRegistrationsRef.current[candidate])) {
        return candidate;
      }
    }
    return "message";
  }, []);

  const registerHistoryPaneRoot = useCallback(
    (pane: HistoryPaneId, element: HTMLElement | null) => {
      historyPaneRegistrationsRef.current[pane].root = element;
    },
    [],
  );

  const registerHistoryPaneTarget = useCallback(
    (pane: HistoryPaneId, element: HTMLElement | null) => {
      historyPaneRegistrationsRef.current[pane].focusTarget = element;
    },
    [],
  );

  const registerViewTarget = useCallback((view: ViewFocusDomainId, element: HTMLElement | null) => {
    viewTargetsRef.current[view] = element;
  }, []);

  const activateHistoryPane = useCallback(
    (pane: HistoryPaneId) => {
      const nextPane = resolveAvailableHistoryPane(pane);
      setActiveDomain((current) =>
        current.kind === "history" && current.pane === nextPane
          ? current
          : { kind: "history", pane: nextPane },
      );
      setLastHistoryPane((current) => (current === nextPane ? current : nextPane));
      return nextPane;
    },
    [resolveAvailableHistoryPane],
  );

  const setActiveHistoryPane = useCallback(
    (pane: HistoryPaneId) => {
      activateHistoryPane(pane);
    },
    [activateHistoryPane],
  );

  const focusHistoryPane = useCallback(
    (pane: HistoryPaneId, options?: { preventScroll?: boolean }) => {
      const nextPane = activateHistoryPane(pane);
      const registration = historyPaneRegistrationsRef.current[nextPane];
      focusElement(registration.focusTarget ?? registration.root, options);
    },
    [activateHistoryPane],
  );

  const restoreLastHistoryPane = useCallback(() => {
    focusHistoryPane(lastHistoryPaneRef.current);
  }, [focusHistoryPane]);

  const restoreDomain = useCallback(
    (domain: FocusRestorationDomain | null) => {
      if (!domain) {
        restoreLastHistoryPane();
        return;
      }
      if (domain.kind === "history") {
        focusHistoryPane(domain.pane);
        return;
      }
      setActiveDomain(domain);
      focusElement(viewTargetsRef.current[domain.kind]);
    },
    [focusHistoryPane, restoreLastHistoryPane],
  );

  const enterView = useCallback((view: ViewFocusDomainId) => {
    if (activeDomainRef.current.kind === view) {
      return;
    }
    if (activeDomainRef.current.kind === "history") {
      viewReturnDomainRef.current = { kind: "history", pane: activeDomainRef.current.pane };
    } else if (activeDomainRef.current.kind === "overlay") {
      viewReturnDomainRef.current = activeDomainRef.current.returnDomain;
    } else if (viewReturnDomainRef.current === null) {
      viewReturnDomainRef.current = {
        kind: "history",
        pane: lastHistoryPaneRef.current,
      };
    }
    setActiveDomain((current) => (current.kind === view ? current : { kind: view }));
  }, []);

  const exitViewAndRestoreHistoryPane = useCallback(
    (returnDomainOverride?: FocusRestorationDomain | null) => {
      const returnDomain = returnDomainOverride ?? viewReturnDomainRef.current;
      viewReturnDomainRef.current = null;
      if (returnDomain) {
        restoreDomain(returnDomain);
        return;
      }
      restoreLastHistoryPane();
    },
    [restoreDomain, restoreLastHistoryPane],
  );

  const pushOverlay = useCallback((returnDomain?: FocusRestorationDomain | null) => {
    const token = ++overlayTokenRef.current;
    const overlayReturnDomain = returnDomain ?? nonOverlayDomain(activeDomainRef.current);
    const nextStack = [...overlayStackRef.current, { token, returnDomain: overlayReturnDomain }];
    overlayStackRef.current = nextStack;
    setOverlayDepth(nextStack.length);
    setActiveDomain({ kind: "overlay", returnDomain: overlayReturnDomain });
    return token;
  }, []);

  const popOverlayAndRestore = useCallback(
    (token: number) => {
      const existing = overlayStackRef.current;
      const target = existing.find((entry) => entry.token === token) ?? null;
      if (!target) {
        return;
      }
      const nextStack = existing.filter((entry) => entry.token !== token);
      overlayStackRef.current = nextStack;
      setOverlayDepth(nextStack.length);
      const top = nextStack[nextStack.length - 1] ?? null;
      if (top) {
        setActiveDomain({ kind: "overlay", returnDomain: top.returnDomain });
        return;
      }
      restoreDomain(target.returnDomain);
    },
    [restoreDomain],
  );

  const preservePaneFocusOnMouseDown = useCallback(
    (pane: HistoryPaneId, event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0 || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      focusHistoryPane(pane);
    },
    [focusHistoryPane],
  );

  const markPaneActiveOnChromeMouseDown = useCallback(
    (pane: HistoryPaneId, event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0 || isEditableTarget(event.target)) {
        return;
      }
      setActiveHistoryPane(pane);
    },
    [setActiveHistoryPane],
  );

  const focusPaneOnChromeClick = useCallback(
    (pane: HistoryPaneId, event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0 || isEditableTarget(event.target)) {
        return;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
        return;
      }
      focusHistoryPane(pane);
    },
    [focusHistoryPane],
  );

  const preserveCurrentHistoryFocusOnMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0 || isEditableTarget(event.target)) {
        return;
      }
      if (activeDomainRef.current.kind !== "history") {
        return;
      }
      event.preventDefault();
      focusHistoryPane(activeDomainRef.current.pane);
    },
    [focusHistoryPane],
  );

  const controller = useMemo<PaneFocusController>(
    () => ({
      activeDomain,
      lastHistoryPane,
      overlayDepth,
      registerHistoryPaneRoot,
      registerHistoryPaneTarget,
      registerViewTarget,
      focusHistoryPane,
      restoreLastHistoryPane,
      setActiveHistoryPane,
      enterView,
      exitViewAndRestoreHistoryPane,
      pushOverlay,
      popOverlayAndRestore,
      isHistoryPaneActive: (pane) => activeDomain.kind === "history" && activeDomain.pane === pane,
      isFocusWithinHistoryPane: (pane, element = document.activeElement) =>
        isElementWithinHistoryPane(historyPaneRegistrationsRef.current[pane], element),
      isOverlayOpen: activeDomain.kind === "overlay",
      resolveAvailableHistoryPane,
      getHistoryPaneRootProps: (pane) => ({
        "data-history-pane": pane,
        ...(activeDomain.kind === "history" && activeDomain.pane === pane
          ? { "data-pane-active": "true" as const }
          : {}),
        onFocusCapture: () => {
          setActiveHistoryPane(pane);
        },
      }),
      getPaneChromeProps: (pane) => ({
        onMouseDownCapture: (event) => {
          if (isInteractiveTarget(event.target)) {
            return;
          }
          markPaneActiveOnChromeMouseDown(pane, event);
        },
        onClickCapture: (event) => {
          if (isInteractiveTarget(event.target)) {
            return;
          }
          focusPaneOnChromeClick(pane, event);
        },
      }),
      getPreservePaneFocusProps: (pane) => ({
        onMouseDownCapture: (event) => {
          preservePaneFocusOnMouseDown(pane, event);
        },
      }),
      getPreserveHistoryFocusProps: () => ({
        onMouseDownCapture: (event) => {
          preserveCurrentHistoryFocusOnMouseDown(event);
        },
      }),
    }),
    [
      activeDomain,
      lastHistoryPane,
      overlayDepth,
      registerHistoryPaneRoot,
      registerHistoryPaneTarget,
      registerViewTarget,
      focusHistoryPane,
      restoreLastHistoryPane,
      setActiveHistoryPane,
      enterView,
      exitViewAndRestoreHistoryPane,
      pushOverlay,
      popOverlayAndRestore,
      resolveAvailableHistoryPane,
      preservePaneFocusOnMouseDown,
      markPaneActiveOnChromeMouseDown,
      focusPaneOnChromeClick,
      preserveCurrentHistoryFocusOnMouseDown,
    ],
  );

  return controller;
}

export function PaneFocusProvider({
  controller,
  children,
}: {
  controller: PaneFocusController;
  children: React.ReactNode;
}) {
  return <PaneFocusContext.Provider value={controller}>{children}</PaneFocusContext.Provider>;
}

export function usePaneFocus(): PaneFocusController {
  const controller = useContext(PaneFocusContext);
  if (!controller) {
    throw new Error("PaneFocusProvider is missing");
  }
  return controller;
}

export function usePaneFocusOverlay(open: boolean): void {
  const paneFocus = usePaneFocus();
  const tokenRef = useRef<number | null>(null);
  const pushOverlay = paneFocus.pushOverlay;
  const popOverlayAndRestore = paneFocus.popOverlayAndRestore;

  useEffect(() => {
    if (open && tokenRef.current === null) {
      tokenRef.current = pushOverlay();
      return;
    }
    if (!open && tokenRef.current !== null) {
      popOverlayAndRestore(tokenRef.current);
      tokenRef.current = null;
    }
  }, [open, popOverlayAndRestore, pushOverlay]);

  useEffect(
    () => () => {
      if (tokenRef.current !== null) {
        popOverlayAndRestore(tokenRef.current);
        tokenRef.current = null;
      }
    },
    [popOverlayAndRestore],
  );
}

export function useStableHistoryPaneOrder(): readonly HistoryPaneId[] {
  return HISTORY_PANES;
}

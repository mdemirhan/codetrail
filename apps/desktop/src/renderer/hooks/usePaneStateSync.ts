import { useEffect, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { MessageCategory, Provider } from "@codetrail/core";

import { clamp } from "../lib/viewUtils";

type ThemeMode = "light" | "dark";

type RestoredScrollTarget = {
  sessionId: string;
  sessionPage: number;
  scrollTop: number;
};

export function usePaneStateSync(args: {
  logError: (context: string, error: unknown) => void;
  projectPaneWidth: number;
  sessionPaneWidth: number;
  projectProviders: Provider[];
  historyCategories: MessageCategory[];
  expandedByDefaultCategories: MessageCategory[];
  searchProviders: Provider[];
  searchCategories: MessageCategory[];
  theme: ThemeMode;
  selectedProjectId: string;
  selectedSessionId: string;
  sessionPage: number;
  sessionScrollTop: number;
  setProjectPaneWidth: Dispatch<SetStateAction<number>>;
  setSessionPaneWidth: Dispatch<SetStateAction<number>>;
  setProjectProviders: Dispatch<SetStateAction<Provider[]>>;
  setHistoryCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setExpandedByDefaultCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setSearchProviders: Dispatch<SetStateAction<Provider[]>>;
  setSearchCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  setSelectedProjectId: Dispatch<SetStateAction<string>>;
  setSelectedSessionId: Dispatch<SetStateAction<string>>;
  setSessionPage: Dispatch<SetStateAction<number>>;
  setSessionScrollTop: Dispatch<SetStateAction<number>>;
  sessionScrollTopRef: MutableRefObject<number>;
  pendingRestoredSessionScrollRef: MutableRefObject<RestoredScrollTarget | null>;
}): { paneStateHydrated: boolean } {
  const {
    logError,
    projectPaneWidth,
    sessionPaneWidth,
    projectProviders,
    historyCategories,
    expandedByDefaultCategories,
    searchProviders,
    searchCategories,
    theme,
    selectedProjectId,
    selectedSessionId,
    sessionPage,
    sessionScrollTop,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectProviders,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setSearchProviders,
    setSearchCategories,
    setTheme,
    setSelectedProjectId,
    setSelectedSessionId,
    setSessionPage,
    setSessionScrollTop,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  } = args;
  const [paneStateHydrated, setPaneStateHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.codetrail
      .invoke("ui:getState", {})
      .then((response) => {
        if (cancelled) {
          return;
        }

        if (response.projectPaneWidth !== null) {
          setProjectPaneWidth(clamp(response.projectPaneWidth, 230, 520));
        }
        if (response.sessionPaneWidth !== null) {
          setSessionPaneWidth(clamp(response.sessionPaneWidth, 250, 620));
        }
        if (response.projectProviders !== null) {
          setProjectProviders(response.projectProviders);
        }
        if (response.historyCategories !== null) {
          setHistoryCategories(response.historyCategories);
        }
        if (response.expandedByDefaultCategories !== null) {
          setExpandedByDefaultCategories(response.expandedByDefaultCategories);
        }
        if (response.searchProviders !== null) {
          setSearchProviders(response.searchProviders);
        }
        if (response.searchCategories !== null) {
          setSearchCategories(response.searchCategories);
        }
        if (response.theme !== null) {
          setTheme(response.theme);
        }
        if (response.selectedProjectId !== null) {
          setSelectedProjectId(response.selectedProjectId);
        }
        if (response.selectedSessionId !== null) {
          setSelectedSessionId(response.selectedSessionId);
        }
        if (response.sessionPage !== null) {
          setSessionPage(response.sessionPage);
        }
        if (response.sessionScrollTop !== null) {
          sessionScrollTopRef.current = response.sessionScrollTop;
          setSessionScrollTop(response.sessionScrollTop);
        }
        if (
          response.selectedSessionId !== null &&
          response.sessionPage !== null &&
          response.sessionScrollTop !== null &&
          response.sessionScrollTop > 0
        ) {
          pendingRestoredSessionScrollRef.current = {
            sessionId: response.selectedSessionId,
            sessionPage: response.sessionPage,
            scrollTop: response.sessionScrollTop,
          };
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading UI state", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPaneStateHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    logError,
    pendingRestoredSessionScrollRef,
    sessionScrollTopRef,
    setHistoryCategories,
    setProjectPaneWidth,
    setProjectProviders,
    setExpandedByDefaultCategories,
    setSearchCategories,
    setSearchProviders,
    setSelectedProjectId,
    setSelectedSessionId,
    setSessionPage,
    setSessionPaneWidth,
    setSessionScrollTop,
    setTheme,
  ]);

  useEffect(() => {
    if (!paneStateHydrated) {
      return;
    }

    const timer = window.setTimeout(() => {
      void window.codetrail
        .invoke("ui:setState", {
          projectPaneWidth: Math.round(projectPaneWidth),
          sessionPaneWidth: Math.round(sessionPaneWidth),
          projectProviders,
          historyCategories,
          expandedByDefaultCategories,
          searchProviders,
          searchCategories,
          theme,
          selectedProjectId,
          selectedSessionId,
          sessionPage,
          sessionScrollTop,
        })
        .catch((error: unknown) => {
          logError("Failed saving UI state", error);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    historyCategories,
    logError,
    paneStateHydrated,
    projectPaneWidth,
    projectProviders,
    expandedByDefaultCategories,
    searchCategories,
    searchProviders,
    selectedProjectId,
    selectedSessionId,
    sessionPage,
    sessionScrollTop,
    sessionPaneWidth,
    theme,
  ]);

  return { paneStateHydrated };
}

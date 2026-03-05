import { useEffect, useMemo, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { IpcRequest, IpcResponse, MessageCategory, Provider } from "@codetrail/core";

import type {
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ThemeMode,
} from "../../shared/uiPreferences";
import { useCodetrailClient } from "../lib/codetrailClient";
import { clamp } from "../lib/viewUtils";

type RestoredScrollTarget = {
  sessionId: string;
  sessionPage: number;
  scrollTop: number;
};

type HistoryMode = "session" | "bookmarks" | "project_all";
type SystemMessageRegexRules = Record<Provider, string[]>;
type SortDirection = "asc" | "desc";
type PaneStateSnapshot = IpcResponse<"ui:getState">;
type PaneStatePersistRequest = IpcRequest<"ui:setState">;
type HydratableKey = Exclude<keyof PaneStateSnapshot, "projectPaneWidth" | "sessionPaneWidth">;

export function usePaneStateSync(args: {
  initialPaneStateHydrated?: boolean;
  logError: (context: string, error: unknown) => void;
  paneState: PaneStatePersistRequest;
  setProjectPaneWidth: Dispatch<SetStateAction<number>>;
  setSessionPaneWidth: Dispatch<SetStateAction<number>>;
  setProjectPaneCollapsed: Dispatch<SetStateAction<boolean>>;
  setSessionPaneCollapsed: Dispatch<SetStateAction<boolean>>;
  setProjectProviders: Dispatch<SetStateAction<Provider[]>>;
  setHistoryCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setExpandedByDefaultCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setSearchProviders: Dispatch<SetStateAction<Provider[]>>;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  setMonoFontFamily: Dispatch<SetStateAction<MonoFontFamily>>;
  setRegularFontFamily: Dispatch<SetStateAction<RegularFontFamily>>;
  setMonoFontSize: Dispatch<SetStateAction<MonoFontSize>>;
  setRegularFontSize: Dispatch<SetStateAction<RegularFontSize>>;
  setUseMonospaceForAllMessages: Dispatch<SetStateAction<boolean>>;
  setSelectedProjectId: Dispatch<SetStateAction<string>>;
  setSelectedSessionId: Dispatch<SetStateAction<string>>;
  setHistoryMode: Dispatch<SetStateAction<HistoryMode>>;
  setProjectSortDirection: Dispatch<SetStateAction<SortDirection>>;
  setSessionSortDirection: Dispatch<SetStateAction<SortDirection>>;
  setMessageSortDirection: Dispatch<SetStateAction<SortDirection>>;
  setBookmarkSortDirection: Dispatch<SetStateAction<SortDirection>>;
  setProjectAllSortDirection: Dispatch<SetStateAction<SortDirection>>;
  setSessionPage: Dispatch<SetStateAction<number>>;
  setSessionScrollTop: Dispatch<SetStateAction<number>>;
  setSystemMessageRegexRules: Dispatch<SetStateAction<SystemMessageRegexRules>>;
  sessionScrollTopRef: MutableRefObject<number>;
  pendingRestoredSessionScrollRef: MutableRefObject<RestoredScrollTarget | null>;
}): { paneStateHydrated: boolean } {
  const {
    initialPaneStateHydrated = false,
    logError,
    paneState,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectPaneCollapsed,
    setSessionPaneCollapsed,
    setProjectProviders,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setSearchProviders,
    setTheme,
    setMonoFontFamily,
    setRegularFontFamily,
    setMonoFontSize,
    setRegularFontSize,
    setUseMonospaceForAllMessages,
    setSelectedProjectId,
    setSelectedSessionId,
    setHistoryMode,
    setProjectSortDirection,
    setSessionSortDirection,
    setMessageSortDirection,
    setBookmarkSortDirection,
    setProjectAllSortDirection,
    setSessionPage,
    setSessionScrollTop,
    setSystemMessageRegexRules,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  } = args;
  const codetrail = useCodetrailClient();
  const [paneStateHydrated, setPaneStateHydrated] = useState(initialPaneStateHydrated);

  useEffect(() => {
    if (initialPaneStateHydrated) {
      return;
    }

    let cancelled = false;
    let hydrationRafId: number | null = null;
    const finishHydration = () => {
      if (cancelled || hydrationRafId !== null) {
        return;
      }
      hydrationRafId = window.requestAnimationFrame(() => {
        hydrationRafId = null;
        if (!cancelled) {
          setPaneStateHydrated(true);
        }
      });
    };
    void codetrail
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

        const setters: {
          [K in HydratableKey]?: (value: Exclude<PaneStateSnapshot[K], null>) => void;
        } = {
          projectPaneCollapsed: setProjectPaneCollapsed,
          sessionPaneCollapsed: setSessionPaneCollapsed,
          projectProviders: setProjectProviders,
          historyCategories: setHistoryCategories,
          expandedByDefaultCategories: setExpandedByDefaultCategories,
          searchProviders: setSearchProviders,
          theme: setTheme,
          monoFontFamily: setMonoFontFamily,
          regularFontFamily: setRegularFontFamily,
          monoFontSize: setMonoFontSize,
          regularFontSize: setRegularFontSize,
          useMonospaceForAllMessages: setUseMonospaceForAllMessages,
          selectedProjectId: setSelectedProjectId,
          selectedSessionId: setSelectedSessionId,
          historyMode: setHistoryMode,
          projectSortDirection: setProjectSortDirection,
          sessionSortDirection: setSessionSortDirection,
          messageSortDirection: setMessageSortDirection,
          bookmarkSortDirection: setBookmarkSortDirection,
          projectAllSortDirection: setProjectAllSortDirection,
          sessionPage: setSessionPage,
          sessionScrollTop: (value) => {
            sessionScrollTopRef.current = value;
            setSessionScrollTop(value);
          },
          systemMessageRegexRules: setSystemMessageRegexRules,
        };

        for (const [key, setter] of Object.entries(setters) as Array<
          [HydratableKey, (value: Exclude<PaneStateSnapshot[HydratableKey], null>) => void]
        >) {
          const value = response[key];
          if (value !== null) {
            setter(value as Exclude<PaneStateSnapshot[HydratableKey], null>);
          }
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

        finishHydration();
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading UI state", error);
        }
        finishHydration();
      });

    return () => {
      cancelled = true;
      if (hydrationRafId !== null) {
        window.cancelAnimationFrame(hydrationRafId);
      }
    };
  }, [
    codetrail,
    initialPaneStateHydrated,
    logError,
    pendingRestoredSessionScrollRef,
    sessionScrollTopRef,
    setHistoryCategories,
    setProjectPaneWidth,
    setProjectProviders,
    setProjectPaneCollapsed,
    setExpandedByDefaultCategories,
    setSearchProviders,
    setSelectedProjectId,
    setSelectedSessionId,
    setHistoryMode,
    setProjectSortDirection,
    setSessionSortDirection,
    setMessageSortDirection,
    setBookmarkSortDirection,
    setProjectAllSortDirection,
    setSessionPage,
    setSessionPaneWidth,
    setSessionPaneCollapsed,
    setSessionScrollTop,
    setSystemMessageRegexRules,
    setTheme,
    setMonoFontFamily,
    setRegularFontFamily,
    setMonoFontSize,
    setRegularFontSize,
    setUseMonospaceForAllMessages,
  ]);

  const paneStateToPersist = useMemo<PaneStatePersistRequest>(
    () => ({
      ...paneState,
      projectPaneWidth: Math.round(paneState.projectPaneWidth),
      sessionPaneWidth: Math.round(paneState.sessionPaneWidth),
      sessionScrollTop: Math.round(paneState.sessionScrollTop),
    }),
    [paneState],
  );

  useEffect(() => {
    if (!paneStateHydrated) {
      return;
    }

    const timer = window.setTimeout(() => {
      void codetrail.invoke("ui:setState", paneStateToPersist).catch((error: unknown) => {
        logError("Failed saving UI state", error);
      });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [codetrail, logError, paneStateHydrated, paneStateToPersist]);

  return { paneStateHydrated };
}

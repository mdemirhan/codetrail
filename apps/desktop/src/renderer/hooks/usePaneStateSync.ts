import { useEffect, useMemo, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type {
  IpcRequest,
  IpcResponse,
  MessageCategory,
  Provider,
  SystemMessageRegexRules,
} from "@codetrail/core";

import type {
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ThemeMode,
} from "../../shared/uiPreferences";
import type { NonOffRefreshStrategy } from "../app/autoRefresh";
import { EMPTY_SYSTEM_MESSAGE_REGEX_RULES } from "../app/constants";
import { createHistorySelection } from "../app/historySelection";
import type { HistorySelection } from "../app/types";
import { useCodetrailClient } from "../lib/codetrailClient";
import { clamp } from "../lib/viewUtils";

type RestoredScrollTarget = {
  sessionId: string;
  sessionPage: number;
  scrollTop: number;
};

type HistoryMode = "session" | "bookmarks" | "project_all";
type SortDirection = "asc" | "desc";
type PaneStateSnapshot = IpcResponse<"ui:getState">;
type PaneStatePersistRequest = IpcRequest<"ui:setState">;
type HydratableKey = Exclude<keyof PaneStateSnapshot, "projectPaneWidth" | "sessionPaneWidth">;

// Pane state hydration/persistence is isolated here so the main history controller can treat
// stored UI state as another asynchronous data source rather than mixing it into render logic.
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
  setPreferredAutoRefreshStrategy: Dispatch<SetStateAction<NonOffRefreshStrategy>>;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  setMonoFontFamily: Dispatch<SetStateAction<MonoFontFamily>>;
  setRegularFontFamily: Dispatch<SetStateAction<RegularFontFamily>>;
  setMonoFontSize: Dispatch<SetStateAction<MonoFontSize>>;
  setRegularFontSize: Dispatch<SetStateAction<RegularFontSize>>;
  setUseMonospaceForAllMessages: Dispatch<SetStateAction<boolean>>;
  setHistorySelection?: Dispatch<SetStateAction<HistorySelection>>;
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
    setPreferredAutoRefreshStrategy,
    setTheme,
    setMonoFontFamily,
    setRegularFontFamily,
    setMonoFontSize,
    setRegularFontSize,
    setUseMonospaceForAllMessages,
    setHistorySelection,
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
      // Delay the "hydrated" flip by a frame so restore setters land before downstream effects that
      // react to hydrated state.
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
          preferredAutoRefreshStrategy: setPreferredAutoRefreshStrategy,
          theme: setTheme,
          monoFontFamily: setMonoFontFamily,
          regularFontFamily: setRegularFontFamily,
          monoFontSize: setMonoFontSize,
          regularFontSize: setRegularFontSize,
          useMonospaceForAllMessages: setUseMonospaceForAllMessages,
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

        // Hydrate scalar settings generically, then repair selection separately because the three
        // selection fields form a coupled state machine.
        for (const [key, setter] of Object.entries(setters) as Array<
          [HydratableKey, (value: Exclude<PaneStateSnapshot[HydratableKey], null>) => void]
        >) {
          let value = response[key];
          if (value !== null) {
            if (key === "systemMessageRegexRules" && value && typeof value === "object") {
              value = { ...EMPTY_SYSTEM_MESSAGE_REGEX_RULES, ...value } as PaneStateSnapshot[typeof key];
            }
            setter(value as Exclude<PaneStateSnapshot[HydratableKey], null>);
          }
        }
        if (setHistorySelection) {
          setHistorySelection(
            createHistorySelection(
              response.historyMode ?? "project_all",
              response.selectedProjectId ?? "",
              response.selectedSessionId ?? "",
            ),
          );
        } else {
          if (response.selectedProjectId !== null) {
            setSelectedProjectId(response.selectedProjectId);
          }
          if (response.selectedSessionId !== null) {
            setSelectedSessionId(response.selectedSessionId);
          }
          if (response.historyMode !== null) {
            setHistoryMode(response.historyMode);
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
    setPreferredAutoRefreshStrategy,
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
    setHistorySelection,
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

    // Persist on a short debounce so drag-resize and scroll updates do not cause synchronous IPC
    // chatter on every animation frame.
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

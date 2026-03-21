import { useEffect, useMemo, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type {
  IpcRequest,
  MessageCategory,
  Provider,
  SystemMessageRegexRules,
} from "@codetrail/core/browser";

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
import type {
  HistorySelection,
  HistorySelectionMode,
  ProjectSortField,
  ProjectViewMode,
  SortDirection,
} from "../app/types";
import { shouldIgnoreAsyncEffectError } from "../lib/asyncEffectUtils";
import { useCodetrailClient } from "../lib/codetrailClient";
import { clamp } from "../lib/viewUtils";

type RestoredScrollTarget = {
  sessionId: string;
  sessionPage: number;
  scrollTop: number;
};

type PaneStatePersistRequest = IpcRequest<"ui:setPaneState">;
type IndexingConfigPersistRequest = IpcRequest<"indexer:setConfig">;

function hydrateIfPresent<T>(value: T | null, setter: (value: T) => void): void {
  if (value !== null) {
    setter(value);
  }
}

// Pane state hydration/persistence is isolated here so the main history controller can treat
// stored UI state as another asynchronous data source rather than mixing it into render logic.
export function usePaneStateSync(args: {
  initialPaneStateHydrated?: boolean;
  logError: (context: string, error: unknown) => void;
  paneState: PaneStatePersistRequest & IndexingConfigPersistRequest;
  setEnabledProviders: Dispatch<SetStateAction<Provider[]>>;
  setRemoveMissingSessionsDuringIncrementalIndexing: Dispatch<SetStateAction<boolean>>;
  setProjectPaneWidth: Dispatch<SetStateAction<number>>;
  setSessionPaneWidth: Dispatch<SetStateAction<number>>;
  setProjectPaneCollapsed: Dispatch<SetStateAction<boolean>>;
  setSessionPaneCollapsed: Dispatch<SetStateAction<boolean>>;
  setSingleClickFoldersExpand: Dispatch<SetStateAction<boolean>>;
  setSingleClickProjectsExpand: Dispatch<SetStateAction<boolean>>;
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
  setHistoryMode: Dispatch<SetStateAction<HistorySelectionMode>>;
  setProjectViewMode: Dispatch<SetStateAction<ProjectViewMode>>;
  setProjectSortField: Dispatch<SetStateAction<ProjectSortField>>;
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
    setEnabledProviders,
    setRemoveMissingSessionsDuringIncrementalIndexing,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectPaneCollapsed,
    setSessionPaneCollapsed,
    setSingleClickFoldersExpand,
    setSingleClickProjectsExpand,
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
    setProjectViewMode,
    setProjectSortField,
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
  const indexingConfigToPersist = useMemo<IndexingConfigPersistRequest>(
    () => ({
      enabledProviders: paneState.enabledProviders,
      removeMissingSessionsDuringIncrementalIndexing:
        paneState.removeMissingSessionsDuringIncrementalIndexing,
    }),
    [paneState.enabledProviders, paneState.removeMissingSessionsDuringIncrementalIndexing],
  );

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
    void Promise.all([
      codetrail.invoke("ui:getPaneState", {}),
      codetrail.invoke("indexer:getConfig", {}),
    ])
      .then(([paneResponse, indexingResponse]) => {
        if (cancelled) {
          return;
        }

        hydrateIfPresent(indexingResponse.enabledProviders, setEnabledProviders);
        hydrateIfPresent(
          indexingResponse.removeMissingSessionsDuringIncrementalIndexing,
          setRemoveMissingSessionsDuringIncrementalIndexing,
        );
        if (paneResponse.projectPaneWidth !== null) {
          setProjectPaneWidth(clamp(paneResponse.projectPaneWidth, 230, 520));
        }
        if (paneResponse.sessionPaneWidth !== null) {
          setSessionPaneWidth(clamp(paneResponse.sessionPaneWidth, 250, 620));
        }

        hydrateIfPresent(paneResponse.projectPaneCollapsed, setProjectPaneCollapsed);
        hydrateIfPresent(paneResponse.sessionPaneCollapsed, setSessionPaneCollapsed);
        hydrateIfPresent(paneResponse.singleClickFoldersExpand, setSingleClickFoldersExpand);
        hydrateIfPresent(paneResponse.singleClickProjectsExpand, setSingleClickProjectsExpand);
        hydrateIfPresent(paneResponse.projectProviders, setProjectProviders);
        hydrateIfPresent(paneResponse.historyCategories, setHistoryCategories);
        hydrateIfPresent(paneResponse.expandedByDefaultCategories, setExpandedByDefaultCategories);
        hydrateIfPresent(paneResponse.searchProviders, setSearchProviders);
        hydrateIfPresent(
          paneResponse.preferredAutoRefreshStrategy,
          setPreferredAutoRefreshStrategy,
        );
        hydrateIfPresent(paneResponse.theme, setTheme);
        hydrateIfPresent(paneResponse.monoFontFamily, setMonoFontFamily);
        hydrateIfPresent(paneResponse.regularFontFamily, setRegularFontFamily);
        hydrateIfPresent(paneResponse.monoFontSize, setMonoFontSize);
        hydrateIfPresent(paneResponse.regularFontSize, setRegularFontSize);
        hydrateIfPresent(paneResponse.useMonospaceForAllMessages, setUseMonospaceForAllMessages);
        hydrateIfPresent(paneResponse.projectViewMode, setProjectViewMode);
        hydrateIfPresent(paneResponse.projectSortField, setProjectSortField);
        hydrateIfPresent(paneResponse.projectSortDirection, setProjectSortDirection);
        hydrateIfPresent(paneResponse.sessionSortDirection, setSessionSortDirection);
        hydrateIfPresent(paneResponse.messageSortDirection, setMessageSortDirection);
        hydrateIfPresent(paneResponse.bookmarkSortDirection, setBookmarkSortDirection);
        hydrateIfPresent(paneResponse.projectAllSortDirection, setProjectAllSortDirection);
        hydrateIfPresent(paneResponse.sessionPage, setSessionPage);
        hydrateIfPresent(paneResponse.sessionScrollTop, (value) => {
          sessionScrollTopRef.current = value;
          setSessionScrollTop(value);
        });
        if (
          paneResponse.systemMessageRegexRules &&
          typeof paneResponse.systemMessageRegexRules === "object"
        ) {
          setSystemMessageRegexRules({
            ...EMPTY_SYSTEM_MESSAGE_REGEX_RULES,
            ...paneResponse.systemMessageRegexRules,
          });
        }
        if (setHistorySelection) {
          setHistorySelection(
            createHistorySelection(
              paneResponse.historyMode ?? "project_all",
              paneResponse.selectedProjectId ?? "",
              paneResponse.selectedSessionId ?? "",
            ),
          );
        } else {
          hydrateIfPresent(paneResponse.selectedProjectId, setSelectedProjectId);
          hydrateIfPresent(paneResponse.selectedSessionId, setSelectedSessionId);
          hydrateIfPresent(paneResponse.historyMode, setHistoryMode);
        }
        if (
          paneResponse.selectedSessionId !== null &&
          paneResponse.sessionPage !== null &&
          paneResponse.sessionScrollTop !== null &&
          paneResponse.sessionScrollTop > 0
        ) {
          pendingRestoredSessionScrollRef.current = {
            sessionId: paneResponse.selectedSessionId,
            sessionPage: paneResponse.sessionPage,
            scrollTop: paneResponse.sessionScrollTop,
          };
        }

        finishHydration();
      })
      .catch((error: unknown) => {
        if (!shouldIgnoreAsyncEffectError(cancelled, error)) {
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
    setEnabledProviders,
    setRemoveMissingSessionsDuringIncrementalIndexing,
    setHistoryCategories,
    setProjectPaneWidth,
    setProjectProviders,
    setProjectPaneCollapsed,
    setSingleClickFoldersExpand,
    setSingleClickProjectsExpand,
    setExpandedByDefaultCategories,
    setSearchProviders,
    setPreferredAutoRefreshStrategy,
    setSelectedProjectId,
    setSelectedSessionId,
    setHistoryMode,
    setProjectViewMode,
    setProjectSortField,
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
      projectPaneWidth: Math.round(paneState.projectPaneWidth),
      sessionPaneWidth: Math.round(paneState.sessionPaneWidth),
      projectPaneCollapsed: paneState.projectPaneCollapsed,
      sessionPaneCollapsed: paneState.sessionPaneCollapsed,
      singleClickFoldersExpand: paneState.singleClickFoldersExpand,
      singleClickProjectsExpand: paneState.singleClickProjectsExpand,
      projectProviders: paneState.projectProviders,
      historyCategories: paneState.historyCategories,
      expandedByDefaultCategories: paneState.expandedByDefaultCategories,
      searchProviders: paneState.searchProviders,
      preferredAutoRefreshStrategy: paneState.preferredAutoRefreshStrategy,
      theme: paneState.theme,
      monoFontFamily: paneState.monoFontFamily,
      regularFontFamily: paneState.regularFontFamily,
      monoFontSize: paneState.monoFontSize,
      regularFontSize: paneState.regularFontSize,
      useMonospaceForAllMessages: paneState.useMonospaceForAllMessages,
      selectedProjectId: paneState.selectedProjectId,
      selectedSessionId: paneState.selectedSessionId,
      historyMode: paneState.historyMode,
      projectViewMode: paneState.projectViewMode,
      projectSortField: paneState.projectSortField,
      projectSortDirection: paneState.projectSortDirection,
      sessionSortDirection: paneState.sessionSortDirection,
      messageSortDirection: paneState.messageSortDirection,
      bookmarkSortDirection: paneState.bookmarkSortDirection,
      projectAllSortDirection: paneState.projectAllSortDirection,
      sessionPage: paneState.sessionPage,
      sessionScrollTop: Math.round(paneState.sessionScrollTop),
      systemMessageRegexRules: paneState.systemMessageRegexRules,
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
      void codetrail.invoke("ui:setPaneState", paneStateToPersist).catch((error: unknown) => {
        logError("Failed saving UI state", error);
      });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [codetrail, logError, paneStateHydrated, paneStateToPersist]);

  useEffect(() => {
    if (!paneStateHydrated) {
      return;
    }

    const timer = window.setTimeout(() => {
      void codetrail
        .invoke("indexer:setConfig", indexingConfigToPersist)
        .catch((error: unknown) => {
          logError("Failed saving indexer config", error);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [codetrail, indexingConfigToPersist, logError, paneStateHydrated]);

  return { paneStateHydrated };
}

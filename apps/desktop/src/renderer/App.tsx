import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type IpcRequest,
  type IpcRequestInput,
  PROVIDER_LIST,
  type Provider,
  type SearchMode,
} from "@codetrail/core/browser";

import type { AppCommand } from "../shared/appCommands";
import {
  DEFAULT_PREFERRED_REFRESH_STRATEGY,
  type RefreshStrategy,
  SCAN_STRATEGY_TO_INTERVAL_MS,
  type ScanRefreshStrategy,
  WATCH_STRATEGY_TO_DEBOUNCE_MS,
  isScanRefreshStrategy,
  isWatchRefreshStrategy,
} from "./app/autoRefresh";
import { ADVANCED_SYNTAX_ITEMS, COMMON_SYNTAX_ITEMS, PROVIDERS } from "./app/constants";
import type { MainView, PaneStateSnapshot, WatchStatsResponse } from "./app/types";
import { ConfirmDialog } from "./components/ConfirmDialog";
import {
  DeleteIndexedHistoryDialog,
  type DeleteTarget,
} from "./components/DeleteIndexedHistoryDialog";
import { HistoryExportProgressDialog } from "./components/HistoryExportProgressDialog";
import { SettingsView } from "./components/SettingsView";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { TopBar } from "./components/TopBar";
import { HistoryDetailPane } from "./features/HistoryDetailPane";
import { HistoryLayout } from "./features/HistoryLayout";
import { SearchView } from "./features/SearchView";
import { useAppearanceController } from "./features/useAppearanceController";
import {
  type HistorySelectionDebounceOverrides,
  useHistoryController,
} from "./features/useHistoryController";
import { useLiveWatchController } from "./features/useLiveWatchController";
import { useSearchController } from "./features/useSearchController";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useReconcileProviderSelection } from "./hooks/useReconcileProviderSelection";
import { useCodetrailClient } from "./lib/codetrailClient";
import { isSessionsPaneVisible } from "./lib/historyPaneVisibility";
import { findSessionSummaryById } from "./lib/historySessionLookup";
import {
  type HistoryPaneId,
  PaneFocusProvider,
  useCreatePaneFocusController,
} from "./lib/paneFocusController";
import { canActOnSelectedProject } from "./lib/projectActionAvailability";
import { useShortcutRegistry } from "./lib/shortcutRegistry";
import { toErrorMessage } from "./lib/viewUtils";
import { ViewerExternalAppsProvider } from "./lib/viewerExternalAppsContext";

// Module-level override for tests — keeps the component API clean
let _testStrategyIntervalOverrides: Partial<Record<ScanRefreshStrategy, number>> | null = null;
const IS_TEST_ENV =
  typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom");
const WATCH_STATS_POLL_MS = IS_TEST_ENV ? 0 : 1000;
const INDEXING_STATUS_ACTIVE_POLL_MS = IS_TEST_ENV ? 0 : 1000;
const INDEXING_STATUS_IDLE_POLL_MS = IS_TEST_ENV ? 0 : 3000;
const INDEXING_STATUS_HIDDEN_POLL_MS = IS_TEST_ENV ? 0 : 5000;
const WATCHER_STATUS_BURST_POLL_MS = IS_TEST_ENV ? 0 : 250;
const WATCHER_STATUS_ACTIVE_POLL_MS = IS_TEST_ENV ? 0 : 1000;
const WATCHER_STATUS_IDLE_POLL_MS = IS_TEST_ENV ? 0 : 3000;
const WATCHER_STATUS_HIDDEN_POLL_MS = IS_TEST_ENV ? 0 : 5000;
const WATCHER_STATUS_BURST_WINDOW_MS = 5000;

export function resolveIndexingStatusPollMs(input: {
  documentVisible: boolean;
  indexingRunning: boolean;
}): number {
  if (!input.documentVisible) {
    return INDEXING_STATUS_HIDDEN_POLL_MS;
  }
  return input.indexingRunning ? INDEXING_STATUS_ACTIVE_POLL_MS : INDEXING_STATUS_IDLE_POLL_MS;
}

export function resolveWatcherStatusPollMs(input: {
  watchStrategyActive: boolean;
  documentVisible: boolean;
  nowMs: number;
  burstUntilMs: number;
  pendingPathCount: number;
}): number {
  if (!input.watchStrategyActive) {
    return 0;
  }
  if (!input.documentVisible) {
    return WATCHER_STATUS_HIDDEN_POLL_MS;
  }
  if (input.nowMs < input.burstUntilMs) {
    return WATCHER_STATUS_BURST_POLL_MS;
  }
  return input.pendingPathCount > 0 ? WATCHER_STATUS_ACTIVE_POLL_MS : WATCHER_STATUS_IDLE_POLL_MS;
}

export function setTestStrategyIntervalOverrides(
  overrides: Partial<Record<ScanRefreshStrategy, number>> | null,
): void {
  _testStrategyIntervalOverrides = overrides;
}

type PendingHistoryDelete =
  | (Extract<DeleteTarget, { kind: "project" }> & { projectId: string })
  | (Extract<DeleteTarget, { kind: "session" }> & { sessionId: string });

function resolveExplicitOrSelectedItem<T extends { id: string }>(
  items: T[],
  explicitId: string | undefined,
  selectedId: string | null | undefined,
  selectedItem: T | null | undefined,
): T | null {
  return items.find((item) => item.id === (explicitId ?? selectedId)) ?? selectedItem ?? null;
}

function resolveExplicitOrSelectedSession({
  explicitId,
  selectedId,
  selectedSession,
  sortedSessions,
  treeProjectSessionsByProjectId,
}: {
  explicitId: string | undefined;
  selectedId: string | null | undefined;
  selectedSession: ReturnType<typeof useHistoryController>["selectedSession"];
  sortedSessions: ReturnType<typeof useHistoryController>["sortedSessions"];
  treeProjectSessionsByProjectId: ReturnType<
    typeof useHistoryController
  >["treeProjectSessionsByProjectId"];
}) {
  const targetId = explicitId ?? selectedId;
  if (!targetId) {
    return selectedSession ?? null;
  }
  return (
    findSessionSummaryById(targetId, sortedSessions, treeProjectSessionsByProjectId) ??
    selectedSession ??
    null
  );
}

export function App({
  initialPaneState = null,
  testHistorySelectionDebounceOverrides = null,
}: {
  initialPaneState?: PaneStateSnapshot | null;
  testHistorySelectionDebounceOverrides?: HistorySelectionDebounceOverrides | null;
}) {
  const codetrail = useCodetrailClient();
  const [refreshing, setRefreshing] = useState(false);
  const [indexingInBackground, setIndexingInBackground] = useState(false);
  const [mainView, setMainView] = useState<MainView>("history");
  const [focusMode, setFocusMode] = useState(false);
  const [advancedSearchEnabled, setAdvancedSearchEnabled] = useState(false);
  const [showReindexConfirm, setShowReindexConfirm] = useState(false);
  const [pendingProjectReindexId, setPendingProjectReindexId] = useState<string | null>(null);
  const [pendingProviderDisable, setPendingProviderDisable] = useState<Provider | null>(null);
  const [pendingMissingSessionCleanupEnable, setPendingMissingSessionCleanupEnable] =
    useState(false);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState<PendingHistoryDelete | null>(
    null,
  );
  const [historyDeleteError, setHistoryDeleteError] = useState<string | null>(null);
  const [historyDeletePending, setHistoryDeletePending] = useState(false);
  const [refreshStrategy, setRefreshStrategy] = useState<RefreshStrategy>(
    initialPaneState?.currentAutoRefreshStrategy ?? "off",
  );
  const [watcherPendingPathCount, setWatcherPendingPathCount] = useState(0);
  const [autoRefreshScanInFlight, setAutoRefreshScanInFlight] = useState(false);
  const [watchStats, setWatchStats] = useState<WatchStatsResponse | null>(null);
  const [watchStatsLoading, setWatchStatsLoading] = useState(false);
  const [watchStatsError, setWatchStatsError] = useState<string | null>(null);
  const [enabledProviders, setEnabledProviders] = useState<Provider[]>(
    initialPaneState?.enabledProviders ?? [...PROVIDERS],
  );
  const [searchProviders, setSearchProviders] = useState<Provider[]>(
    (initialPaneState?.searchProviders ?? enabledProviders).filter((provider) =>
      enabledProviders.includes(provider),
    ),
  );

  const shortcuts = useShortcutRegistry();
  const isHistoryLayout = mainView === "history" && !focusMode;
  const searchMode: SearchMode = advancedSearchEnabled ? "advanced" : "simple";
  const logError = useCallback((context: string, error: unknown) => {
    console.error(`[codetrail] ${context}: ${toErrorMessage(error)}`);
  }, []);
  const previousMainViewRef = useRef<MainView>(mainView);
  const wasIndexingRef = useRef(false);
  const indexingInBackgroundRef = useRef(false);
  const lastCompletedJobsRef = useRef(-1);
  const watchStatsLoadedRef = useRef(false);
  const skipNextStatusDrivenReloadRef = useRef(false);
  const reloadIndexedDataRef = useRef<((source: "manual" | "auto") => Promise<void>) | null>(null);
  const handleRefreshRef = useRef<
    ((force: boolean, source?: "manual" | "auto") => Promise<void>) | null
  >(null);
  const refreshLiveStatusRef = useRef<(() => Promise<unknown>) | null>(null);
  const watcherLifecycleRef = useRef(0);
  const watcherPendingPathCountRef = useRef(0);
  const watcherStatusBurstUntilRef = useRef(0);
  const helpViewRef = useRef<HTMLElement | null>(null);
  const settingsViewRef = useRef<HTMLElement | null>(null);
  const viewFocusRafRef = useRef<number | null>(null);
  const returnToHistoryFocusRafRef = useRef<number | null>(null);
  const focusModeRafRef = useRef<number | null>(null);
  const historyInvariantRafRef = useRef<number | null>(null);
  const historyReturnPaneRef = useRef<HistoryPaneId>("message");
  const paneFocus = useCreatePaneFocusController();

  const scheduleFocusFrame = useCallback((ref: { current: number | null }, fn: () => void) => {
    if (ref.current !== null) {
      window.cancelAnimationFrame(ref.current);
    }
    ref.current = window.requestAnimationFrame(() => {
      ref.current = null;
      fn();
    });
  }, []);

  useEffect(
    () => () => {
      for (const ref of [
        viewFocusRafRef,
        returnToHistoryFocusRafRef,
        focusModeRafRef,
        historyInvariantRafRef,
      ]) {
        if (ref.current !== null) {
          window.cancelAnimationFrame(ref.current);
          ref.current = null;
        }
      }
    },
    [],
  );

  const appearance = useAppearanceController({
    initialPaneState,
    logError,
  });
  const history = useHistoryController({
    initialPaneState,
    isHistoryLayout,
    searchMode,
    enabledProviders,
    setEnabledProviders,
    searchProviders,
    setSearchProviders,
    appearance,
    logError,
    testHistorySelectionDebounceOverrides,
    focusHistoryPane: paneFocus.focusHistoryPane,
  });
  const search = useSearchController({
    searchMode,
    searchProviders,
    setSearchProviders,
    historyCategories: history.historyCategories,
    setHistoryCategories: history.setHistoryCategories,
    logError,
  });
  const preferredRefreshStrategy =
    history.preferredAutoRefreshStrategy ?? DEFAULT_PREFERRED_REFRESH_STRATEGY;
  const {
    liveStatus,
    liveStatusError,
    refreshLiveStatus,
    claudeHookActionPending,
    showClaudeHooksPrompt,
    setShowClaudeHooksPrompt,
    installClaudeHooks,
    removeClaudeHooks,
  } = useLiveWatchController({
    codetrail,
    mainView,
    refreshStrategy,
    liveWatchEnabled: history.liveWatchEnabled,
    claudeEnabled: enabledProviders.includes("claude"),
    claudeHooksPrompted: history.claudeHooksPrompted,
    logError,
  });
  useEffect(() => {
    refreshLiveStatusRef.current = refreshLiveStatus;
  }, [refreshLiveStatus]);

  useEffect(() => {
    indexingInBackgroundRef.current = indexingInBackground;
  }, [indexingInBackground]);

  useEffect(() => {
    watcherPendingPathCountRef.current = watcherPendingPathCount;
  }, [watcherPendingPathCount]);

  useEffect(() => {
    if (mainView !== "settings" || appearance.settingsInfo || appearance.settingsLoading) {
      return;
    }
    void appearance.loadSettingsInfo();
  }, [appearance.loadSettingsInfo, appearance.settingsInfo, appearance.settingsLoading, mainView]);

  useEffect(() => {
    const previousMainView = previousMainViewRef.current;
    previousMainViewRef.current = mainView;
    if (previousMainView !== "settings" || mainView === "settings") {
      return;
    }
    void codetrail.invoke("app:flushState", {}).catch((error: unknown) => {
      logError("Failed flushing app state after closing settings", error);
    });
  }, [codetrail, logError, mainView]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void codetrail
        .invoke("ui:setPaneState", {
          currentAutoRefreshStrategy: refreshStrategy,
        } as IpcRequest<"ui:setPaneState">)
        .catch((error: unknown) => {
          logError("Failed saving current auto-refresh strategy", error);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [codetrail, logError, refreshStrategy]);

  useReconcileProviderSelection(enabledProviders, setSearchProviders);

  useEffect(() => {
    if (
      search.searchProjectId &&
      !history.sortedProjects.some((project) => project.id === search.searchProjectId)
    ) {
      search.setSearchProjectId("");
    }
  }, [history.sortedProjects, search.searchProjectId, search.setSearchProjectId]);

  const searchViewTarget = mainView === "search" ? search.globalSearchInputRef.current : null;
  useEffect(() => {
    paneFocus.registerViewTarget("search", searchViewTarget);
    paneFocus.registerViewTarget("help", mainView === "help" ? helpViewRef.current : null);
    paneFocus.registerViewTarget(
      "settings",
      mainView === "settings" ? settingsViewRef.current : null,
    );
  }, [mainView, paneFocus.registerViewTarget, searchViewTarget]);

  useEffect(() => {
    if (mainView !== "history") {
      return;
    }
    historyReturnPaneRef.current =
      paneFocus.activeDomain.kind === "history"
        ? paneFocus.activeDomain.pane
        : paneFocus.lastHistoryPane;
  }, [mainView, paneFocus.activeDomain, paneFocus.lastHistoryPane]);

  useEffect(() => {
    if (mainView === "search") {
      paneFocus.enterView("search");
      return;
    }
    if (mainView === "help") {
      paneFocus.enterView("help");
      scheduleFocusFrame(viewFocusRafRef, () => {
        helpViewRef.current?.focus({ preventScroll: true });
      });
      return;
    }
    if (mainView === "settings") {
      paneFocus.enterView("settings");
      scheduleFocusFrame(viewFocusRafRef, () => {
        settingsViewRef.current?.focus({ preventScroll: true });
      });
      return;
    }
    if (viewFocusRafRef.current !== null) {
      window.cancelAnimationFrame(viewFocusRafRef.current);
      viewFocusRafRef.current = null;
    }
  }, [mainView, paneFocus.enterView, scheduleFocusFrame]);

  const reloadIndexedData = useCallback(
    async (source: "manual" | "auto") => {
      const historyRefreshPromise = history.handleRefreshAllData(source, {
        historyViewActive: mainView === "history",
      });
      const shouldReloadSearch =
        source === "manual" || (mainView === "search" && search.hasActiveSearchQuery);
      await Promise.all([
        historyRefreshPromise,
        shouldReloadSearch ? search.reloadSearch() : Promise.resolve(),
      ]);
    },
    [history.handleRefreshAllData, mainView, search.hasActiveSearchQuery, search.reloadSearch],
  );
  useEffect(() => {
    reloadIndexedDataRef.current = reloadIndexedData;
  }, [reloadIndexedData]);

  const pendingProviderDisableLabel =
    PROVIDER_LIST.find((provider) => provider.id === pendingProviderDisable)?.label ?? "Provider";
  const handleProviderToggle = useCallback(
    (provider: Provider) => {
      if (enabledProviders.includes(provider)) {
        setPendingProviderDisable(provider);
        return;
      }
      setEnabledProviders((current) => [...current, provider]);
    },
    [enabledProviders],
  );
  const handleMissingSessionCleanupToggle = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        history.setRemoveMissingSessionsDuringIncrementalIndexing(false);
        return;
      }
      if (history.removeMissingSessionsDuringIncrementalIndexing) {
        return;
      }
      setPendingMissingSessionCleanupEnable(true);
    },
    [
      history.removeMissingSessionsDuringIncrementalIndexing,
      history.setRemoveMissingSessionsDuringIncrementalIndexing,
    ],
  );
  const handleOpenProjectDelete = useCallback(
    (projectId?: string) => {
      if (
        !projectId &&
        history.projectViewMode === "tree" &&
        history.treeFocusedRow?.kind === "folder"
      ) {
        return;
      }
      const targetProject = resolveExplicitOrSelectedItem(
        history.sortedProjects,
        projectId,
        history.selectedProjectId,
        history.selectedProject,
      );
      if (!targetProject) {
        return;
      }
      setHistoryDeleteError(null);
      setPendingHistoryDelete({
        kind: "project",
        projectId: targetProject.id,
        provider: targetProject.provider,
        title: targetProject.name || targetProject.path || "(no project path)",
        path: targetProject.path,
        sessionCount: targetProject.sessionCount,
        messageCount: targetProject.messageCount,
      });
    },
    [
      history.projectViewMode,
      history.selectedProject,
      history.selectedProjectId,
      history.sortedProjects,
      history.treeFocusedRow,
    ],
  );
  const handleOpenSessionDelete = useCallback(
    (sessionId?: string) => {
      const targetSession = resolveExplicitOrSelectedSession({
        explicitId: sessionId,
        selectedId: history.selectedSessionId,
        selectedSession: history.selectedSession,
        sortedSessions: history.sortedSessions,
        treeProjectSessionsByProjectId: history.treeProjectSessionsByProjectId,
      });
      if (!targetSession) {
        return;
      }
      setHistoryDeleteError(null);
      setPendingHistoryDelete({
        kind: "session",
        sessionId: targetSession.id,
        provider: targetSession.provider,
        title: targetSession.title || "(untitled session)",
        path: targetSession.filePath,
        messageCount: targetSession.messageCount,
      });
    },
    [
      history.selectedSession,
      history.selectedSessionId,
      history.sortedSessions,
      history.treeProjectSessionsByProjectId,
    ],
  );
  const handleOpenProjectReindex = useCallback(
    (projectId?: string) => {
      if (refreshing || indexingInBackground) {
        return;
      }
      const uiSelectedProject =
        history.sortedProjects.find((project) => project.id === history.uiSelectedProjectId) ??
        null;
      const targetProject = resolveExplicitOrSelectedItem(
        history.sortedProjects,
        projectId,
        history.uiSelectedProjectId,
        uiSelectedProject,
      );
      if (!targetProject) {
        return;
      }
      setPendingProjectReindexId(targetProject.id);
    },
    [history.sortedProjects, history.uiSelectedProjectId, indexingInBackground, refreshing],
  );
  const handleConfirmHistoryDelete = useCallback(async () => {
    if (!pendingHistoryDelete || historyDeletePending) {
      return;
    }
    setHistoryDeleteError(null);
    setHistoryDeletePending(true);
    try {
      if (pendingHistoryDelete.kind === "project") {
        const response = await codetrail.invoke("projects:delete", {
          projectId: pendingHistoryDelete.projectId,
        });
        if (!response.deleted) {
          setHistoryDeleteError("This project no longer exists in the database.");
          return;
        }
      } else {
        const response = await codetrail.invoke("sessions:delete", {
          sessionId: pendingHistoryDelete.sessionId,
        });
        if (!response.deleted) {
          setHistoryDeleteError("This session no longer exists in the database.");
          return;
        }
      }
      setHistoryDeleteError(null);
      setPendingHistoryDelete(null);
      await reloadIndexedData("manual");
    } catch (error) {
      logError("Failed deleting indexed history", error);
      setHistoryDeleteError(toErrorMessage(error));
    } finally {
      setHistoryDeletePending(false);
    }
  }, [codetrail, historyDeletePending, logError, pendingHistoryDelete, reloadIndexedData]);

  useEffect(() => {
    let cancelled = false;
    const watchStrategyActive = isWatchRefreshStrategy(refreshStrategy);
    const timeoutIds = new Set<number>();

    const loadWatchStats = async (showLoading: boolean) => {
      if (mainView !== "settings") {
        return;
      }
      if (showLoading) {
        setWatchStatsLoading(true);
        setWatchStatsError(null);
      }
      try {
        const response = await codetrail.invoke("watcher:getStats", {});
        if (!cancelled) {
          setWatchStats(response);
          setWatchStatsError(null);
          watchStatsLoadedRef.current = true;
        }
      } catch (error) {
        if (!cancelled) {
          setWatchStatsError(toErrorMessage(error));
        }
      } finally {
        if (!cancelled && showLoading) {
          setWatchStatsLoading(false);
        }
      }
    };

    const syncIndexingStatus = async () => {
      try {
        const status = await codetrail.invoke("indexer:getStatus", {});
        if (cancelled) {
          return;
        }
        indexingInBackgroundRef.current = status.running;
        setIndexingInBackground((current) =>
          current === status.running ? current : status.running,
        );
        const wasIndexing = wasIndexingRef.current;
        wasIndexingRef.current = status.running;
        const prevCompleted = lastCompletedJobsRef.current;
        lastCompletedJobsRef.current = status.completedJobs;
        if (
          (wasIndexing && !status.running) ||
          (prevCompleted >= 0 && status.completedJobs > prevCompleted)
        ) {
          if (skipNextStatusDrivenReloadRef.current) {
            skipNextStatusDrivenReloadRef.current = false;
          } else {
            await reloadIndexedDataRef.current?.("auto");
          }
        }
      } catch (error) {
        if (!cancelled) {
          logError("Indexing status refresh failed", error);
        }
      }
    };

    const syncWatcherStatus = async () => {
      if (!watchStrategyActive) {
        return;
      }
      try {
        const status = await codetrail.invoke("watcher:getStatus", {});
        if (!cancelled) {
          watcherPendingPathCountRef.current = status.pendingPathCount;
          setWatcherPendingPathCount((current) =>
            current === status.pendingPathCount ? current : status.pendingPathCount,
          );
        }
      } catch (error) {
        if (!cancelled) {
          logError("Watcher status refresh failed", error);
        }
      }
    };

    const scheduleTimeout = (callback: () => void, delayMs: number) => {
      if (cancelled || delayMs <= 0) {
        return;
      }
      const timeoutId = window.setTimeout(() => {
        timeoutIds.delete(timeoutId);
        callback();
      }, delayMs);
      timeoutIds.add(timeoutId);
    };

    const isDocumentHidden = () =>
      typeof document !== "undefined" && document.visibilityState !== "visible";

    const getIndexingStatusPollMs = () =>
      resolveIndexingStatusPollMs({
        documentVisible: !isDocumentHidden(),
        indexingRunning: indexingInBackgroundRef.current,
      });

    const getWatcherStatusPollMs = () =>
      resolveWatcherStatusPollMs({
        watchStrategyActive,
        documentVisible: !isDocumentHidden(),
        nowMs: Date.now(),
        burstUntilMs: watcherStatusBurstUntilRef.current,
        pendingPathCount: watcherPendingPathCountRef.current,
      });

    const scheduleWatchStatsPoll = () => {
      if (mainView !== "settings" || WATCH_STATS_POLL_MS <= 0) {
        return;
      }
      scheduleTimeout(() => {
        void loadWatchStats(false).finally(() => {
          scheduleWatchStatsPoll();
        });
      }, WATCH_STATS_POLL_MS);
    };

    const scheduleIndexingStatusPoll = () => {
      const delayMs = getIndexingStatusPollMs();
      if (delayMs <= 0) {
        return;
      }
      scheduleTimeout(() => {
        void syncIndexingStatus().finally(() => {
          scheduleIndexingStatusPoll();
        });
      }, delayMs);
    };

    const scheduleWatcherStatusPoll = () => {
      const delayMs = getWatcherStatusPollMs();
      if (delayMs <= 0) {
        return;
      }
      scheduleTimeout(() => {
        void syncWatcherStatus().finally(() => {
          scheduleWatcherStatusPoll();
        });
      }, delayMs);
    };

    if (mainView === "settings") {
      void loadWatchStats(!watchStatsLoadedRef.current);
    }
    void syncIndexingStatus();
    if (watchStrategyActive) {
      void syncWatcherStatus();
    } else {
      watcherPendingPathCountRef.current = 0;
      setWatcherPendingPathCount((current) => (current === 0 ? current : 0));
    }

    scheduleWatchStatsPoll();
    scheduleIndexingStatusPoll();
    scheduleWatcherStatusPoll();

    const handleVisibilityChange = () => {
      if (isDocumentHidden()) {
        return;
      }
      void syncIndexingStatus();
      if (watchStrategyActive) {
        void syncWatcherStatus();
      }
      if (mainView === "settings") {
        void loadWatchStats(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
      timeoutIds.clear();
    };
  }, [codetrail, logError, mainView, refreshStrategy]);

  const focusSessionSearch = useCallback(() => {
    setMainView("history");
    history.focusSessionSearch();
  }, [history.focusSessionSearch]);

  const focusGlobalSearch = useCallback(() => {
    setMainView("search");
    search.focusGlobalSearch();
  }, [search.focusGlobalSearch]);

  const openHelpView = useCallback(() => {
    setMainView("help");
  }, []);

  const openSettingsView = useCallback(() => {
    setMainView("settings");
  }, []);

  const returnToHistoryWithPaneFocus = useCallback(() => {
    const returnPane = historyReturnPaneRef.current;
    setMainView("history");
    scheduleFocusFrame(returnToHistoryFocusRafRef, () => {
      paneFocus.exitViewAndRestoreHistoryPane({ kind: "history", pane: returnPane });
    });
  }, [paneFocus.exitViewAndRestoreHistoryPane, scheduleFocusFrame]);

  const toggleFocusMode = useCallback(() => {
    if (mainView !== "history") {
      return;
    }
    scheduleFocusFrame(focusModeRafRef, () => {
      paneFocus.focusHistoryPane("message");
    });
    setFocusMode((value) => !value);
  }, [mainView, paneFocus.focusHistoryPane, scheduleFocusFrame]);

  const handleRefresh = useCallback(
    async (force: boolean, source: "manual" | "auto" = "manual", projectId?: string) => {
      setRefreshing(true);
      try {
        skipNextStatusDrivenReloadRef.current = true;
        await codetrail.invoke("indexer:refresh", {
          force,
          ...(projectId ? { projectId } : {}),
        });
        await reloadIndexedData(source);
        if (
          source === "manual" &&
          isWatchRefreshStrategy(refreshStrategy) &&
          history.liveWatchEnabled
        ) {
          await refreshLiveStatusRef.current?.();
        }
      } catch (error) {
        skipNextStatusDrivenReloadRef.current = false;
        logError(projectId ? "Project reindex failed" : "Refresh failed", error);
      } finally {
        setRefreshing(false);
      }
    },
    [codetrail, history.liveWatchEnabled, logError, refreshStrategy, reloadIndexedData],
  );
  useEffect(() => {
    handleRefreshRef.current = handleRefresh;
  }, [handleRefresh]);

  const handleIncrementalRefresh = useCallback(async () => {
    await handleRefresh(false);
  }, [handleRefresh]);

  const handleForceRefresh = useCallback(async () => {
    await handleRefresh(true);
  }, [handleRefresh]);
  const handleProjectForceRefresh = useCallback(
    async (projectId: string) => {
      await handleRefresh(true, "manual", projectId);
    },
    [handleRefresh],
  );
  const indexing = refreshing || indexingInBackground;
  const canReindexAnyProject = !indexing;
  const hasProjectReindexTarget = canActOnSelectedProject({
    selectedProject:
      history.sortedProjects.find((project) => project.id === history.uiSelectedProjectId) ??
      history.selectedProject,
    projectViewMode: history.projectViewMode,
    treeFocusedRow: history.treeFocusedRow,
  });
  const canReindexSelectedProject =
    mainView === "history" && hasProjectReindexTarget && canReindexAnyProject;
  const pendingProjectReindex =
    history.sortedProjects.find((project) => project.id === pendingProjectReindexId) ?? null;
  const watchStrategyActive = isWatchRefreshStrategy(refreshStrategy);

  useEffect(() => {
    void codetrail
      .invoke("app:setCommandState", {
        canReindexSelectedProject,
      })
      .catch((error: unknown) => {
        logError("Failed updating app command state", error);
      });
  }, [canReindexSelectedProject, codetrail, logError]);

  const handleAddSystemMessageRegexRule = useCallback(
    (provider: Provider) => {
      history.setSystemMessageRegexRules((value) => ({
        ...value,
        [provider]: [...value[provider], ""],
      }));
    },
    [history.setSystemMessageRegexRules],
  );
  const handleUpdateSystemMessageRegexRule = useCallback(
    (provider: Provider, index: number, pattern: string) => {
      history.setSystemMessageRegexRules((value) => {
        const current = value[provider] ?? [];
        if (index < 0 || index >= current.length) {
          return value;
        }
        const next = [...current];
        next[index] = pattern;
        return {
          ...value,
          [provider]: next,
        };
      });
    },
    [history.setSystemMessageRegexRules],
  );
  const handleRemoveSystemMessageRegexRule = useCallback(
    (provider: Provider, index: number) => {
      history.setSystemMessageRegexRules((value) => {
        const current = value[provider] ?? [];
        if (index < 0 || index >= current.length) {
          return value;
        }
        return {
          ...value,
          [provider]: current.filter((_, candidateIndex) => candidateIndex !== index),
        };
      });
    },
    [history.setSystemMessageRegexRules],
  );
  const updateRefreshStrategy = useCallback(
    (nextValue: RefreshStrategy | ((value: RefreshStrategy) => RefreshStrategy)) => {
      setRefreshStrategy((current) => {
        const next = typeof nextValue === "function" ? nextValue(current) : nextValue;
        if (next !== "off") {
          history.setPreferredAutoRefreshStrategy(next);
        }
        return next;
      });
    },
    [history.setPreferredAutoRefreshStrategy],
  );

  useEffect(() => {
    return codetrail.onAppCommand((command: AppCommand) => {
      switch (command) {
        case "open-settings":
          openSettingsView();
          break;
        case "open-help":
          openHelpView();
          break;
        case "search-current-view":
          if (mainView === "search") {
            focusGlobalSearch();
          } else {
            focusSessionSearch();
          }
          break;
        case "open-global-search":
          focusGlobalSearch();
          break;
        case "refresh-now":
          void handleIncrementalRefresh();
          break;
        case "reindex-selected-project":
          if (canReindexSelectedProject && history.uiSelectedProjectId) {
            setPendingProjectReindexId(history.uiSelectedProjectId);
          }
          break;
        case "toggle-auto-refresh":
          updateRefreshStrategy((value) => (value !== "off" ? "off" : preferredRefreshStrategy));
          break;
        case "zoom-in":
          void appearance.applyZoomAction("in");
          break;
        case "zoom-out":
          void appearance.applyZoomAction("out");
          break;
        case "zoom-reset":
          void appearance.applyZoomAction("reset");
          break;
        case "toggle-project-pane":
          if (mainView === "history") {
            history.setProjectPaneCollapsed((value) => !value);
          }
          break;
        case "toggle-session-pane":
          if (mainView === "history") {
            history.setSessionPaneCollapsed((value) => !value);
          }
          break;
        case "toggle-focus-mode":
          toggleFocusMode();
          break;
        case "toggle-all-messages-expanded":
          if (mainView === "history") {
            history.handleToggleAllCategoryDefaultExpansion();
          }
          break;
      }
    });
  }, [
    appearance,
    codetrail,
    focusGlobalSearch,
    focusSessionSearch,
    canReindexSelectedProject,
    handleIncrementalRefresh,
    history,
    mainView,
    openHelpView,
    openSettingsView,
    preferredRefreshStrategy,
    toggleFocusMode,
    updateRefreshStrategy,
  ]);

  const selectAdjacentSessionWithoutFocus = useCallback(
    (direction: "previous" | "next") => {
      if (
        !isSessionsPaneVisible({
          sessionPaneCollapsed: history.sessionPaneCollapsed,
          projectViewMode: history.projectViewMode,
          hideSessionsPaneForTreeView: history.hideSessionsPaneForTreeView,
        })
      ) {
        return;
      }
      const activeElement = document.activeElement;
      const sessionPaneFocused =
        activeElement instanceof HTMLElement &&
        history.refs.sessionListRef.current?.contains(activeElement);
      if (sessionPaneFocused) {
        history.selectAdjacentSession(direction);
        return;
      }
      history.selectAdjacentSession(direction, { preserveFocus: true });
    },
    [
      history.projectViewMode,
      history.hideSessionsPaneForTreeView,
      history.sessionPaneCollapsed,
      history.refs.sessionListRef,
      history.selectAdjacentSession,
    ],
  );

  const selectAdjacentProjectWithoutFocus = useCallback(
    (direction: "previous" | "next") => {
      if (history.projectPaneCollapsed) {
        return;
      }
      const activeElement = document.activeElement;
      const projectPaneFocused =
        activeElement instanceof HTMLElement &&
        history.refs.projectListRef.current?.contains(activeElement);
      if (projectPaneFocused) {
        history.selectAdjacentProject(direction);
        return;
      }
      history.selectAdjacentProject(direction, { preserveFocus: true });
    },
    [history.projectPaneCollapsed, history.refs.projectListRef, history.selectAdjacentProject],
  );

  const selectAdjacentSessionShortcut = useCallback(
    (direction: "previous" | "next") => {
      if (
        isSessionsPaneVisible({
          sessionPaneCollapsed: history.sessionPaneCollapsed,
          projectViewMode: history.projectViewMode,
          hideSessionsPaneForTreeView: history.hideSessionsPaneForTreeView,
        })
      ) {
        selectAdjacentSessionWithoutFocus(direction);
        return;
      }
      selectAdjacentProjectWithoutFocus(direction);
    },
    [
      history.hideSessionsPaneForTreeView,
      history.projectViewMode,
      history.sessionPaneCollapsed,
      selectAdjacentProjectWithoutFocus,
      selectAdjacentSessionWithoutFocus,
    ],
  );

  const refreshingRef = useRef(false);
  useEffect(() => {
    refreshingRef.current = indexing;
  }, [indexing]);

  const activeHistoryPaneId =
    paneFocus.activeDomain.kind === "history" ? paneFocus.activeDomain.pane : null;

  const pollingIntervalMs = isScanRefreshStrategy(refreshStrategy)
    ? (_testStrategyIntervalOverrides?.[refreshStrategy] ??
      SCAN_STRATEGY_TO_INTERVAL_MS[refreshStrategy])
    : 0;
  useEffect(() => {
    if (pollingIntervalMs <= 0) return;
    const id = window.setInterval(() => {
      if (refreshingRef.current) return;
      setAutoRefreshScanInFlight(true);
      void handleRefreshRef.current?.(false, "auto")?.finally(() => {
        setAutoRefreshScanInFlight(false);
      });
    }, pollingIntervalMs);
    return () => window.clearInterval(id);
  }, [pollingIntervalMs]);

  useEffect(() => {
    if (!isWatchRefreshStrategy(refreshStrategy)) return;
    const lifecycleId = watcherLifecycleRef.current + 1;
    watcherLifecycleRef.current = lifecycleId;
    watcherStatusBurstUntilRef.current = Date.now() + WATCHER_STATUS_BURST_WINDOW_MS;
    let cancelled = false;

    void codetrail
      .invoke("watcher:start", {
        debounceMs: WATCH_STRATEGY_TO_DEBOUNCE_MS[refreshStrategy],
      })
      .then((result) => {
        if (cancelled || watcherLifecycleRef.current !== lifecycleId) {
          return;
        }
        if (!result.ok) {
          logError("File watcher started but no roots were watched", new Error("ok=false"));
          return;
        }
        void refreshLiveStatusRef.current?.();
      })
      .catch((error: unknown) => {
        if (!cancelled && watcherLifecycleRef.current === lifecycleId) {
          logError("Failed to start file watcher", error);
        }
      });

    return () => {
      cancelled = true;
      watcherLifecycleRef.current += 1;
      watcherStatusBurstUntilRef.current = Date.now() + WATCHER_STATUS_BURST_WINDOW_MS;
      void codetrail.invoke("watcher:stop", {}).catch((error: unknown) => {
        logError("Failed to stop file watcher", error);
      });
    };
  }, [codetrail, logError, refreshStrategy]);

  useEffect(() => {
    if (mainView !== "history" || paneFocus.activeDomain.kind === "overlay") {
      if (historyInvariantRafRef.current !== null) {
        window.cancelAnimationFrame(historyInvariantRafRef.current);
        historyInvariantRafRef.current = null;
      }
      return;
    }
    const preferredPane = activeHistoryPaneId ?? paneFocus.lastHistoryPane;
    const nextPane = paneFocus.resolveAvailableHistoryPane(preferredPane);
    const activePaneMatches = activeHistoryPaneId === nextPane;
    const domFocusMatches = paneFocus.isFocusWithinHistoryPane(nextPane);
    if (activePaneMatches && domFocusMatches) {
      if (historyInvariantRafRef.current !== null) {
        window.cancelAnimationFrame(historyInvariantRafRef.current);
        historyInvariantRafRef.current = null;
      }
      return;
    }
    scheduleFocusFrame(historyInvariantRafRef, () => {
      paneFocus.focusHistoryPane(nextPane);
    });
    return () => {
      if (historyInvariantRafRef.current !== null) {
        window.cancelAnimationFrame(historyInvariantRafRef.current);
        historyInvariantRafRef.current = null;
      }
    };
  }, [
    mainView,
    paneFocus.activeDomain.kind,
    activeHistoryPaneId,
    paneFocus.isFocusWithinHistoryPane,
    paneFocus.lastHistoryPane,
    paneFocus.resolveAvailableHistoryPane,
    paneFocus.focusHistoryPane,
    scheduleFocusFrame,
  ]);

  useKeyboardShortcuts({
    mainView,
    activeHistoryPane: activeHistoryPaneId,
    lastHistoryPane: paneFocus.lastHistoryPane,
    overlayOpen: paneFocus.isOverlayOpen,
    historyVisualization: history.historyVisualization,
    historyDetailMode: history.historyDetailMode,
    hasFocusedHistoryMessage: Boolean(history.visibleFocusedMessageId),
    projectListRef: history.refs.projectListRef,
    sessionListRef: history.refs.sessionListRef,
    messageListRef: history.refs.messageListRef,
    searchInputRef: search.globalSearchInputRef,
    searchAdvancedToggleRef: search.advancedSearchToggleRef,
    searchCollapseButtonRef: search.searchCollapseButtonRef,
    searchProjectFilterInputRef: search.searchProjectFilterInputRef,
    searchProjectSelectRef: search.searchProjectSelectRef,
    searchResultsViewRef: search.searchResultsScrollRef,
    setMainView,
    openSettingsView,
    openHelpView,
    returnToHistoryWithPaneFocus,
    clearFocusedHistoryMessage: () => history.setFocusMessageId(""),
    focusGlobalSearch,
    focusSessionSearch,
    toggleFocusMode,
    toggleAllMessagesExpanded: history.handleToggleAllCategoryDefaultExpansion,
    toggleCombinedChangesDiffsExpanded: history.handleToggleCombinedChangesDiffsExpanded,
    toggleHistoryCategory: history.handleToggleHistoryCategoryShortcut,
    soloHistoryCategory: history.handleSoloHistoryCategoryShortcut,
    toggleHistoryCategoryDefaultExpansion: history.handleToggleCategoryDefaultExpansion,
    togglePrimaryHistoryCategoriesVisibility: history.handleTogglePrimaryHistoryCategoriesShortcut,
    toggleAllHistoryCategoriesVisibility: history.handleToggleAllHistoryCategoriesShortcut,
    focusPrimaryHistoryCategoriesVisibility: history.handleFocusPrimaryHistoryCategoriesShortcut,
    focusAllHistoryCategoriesVisibility: history.handleFocusAllHistoryCategoriesShortcut,
    toggleProjectPaneCollapsed: () => history.setProjectPaneCollapsed((value) => !value),
    toggleSessionPaneCollapsed: () => history.setSessionPaneCollapsed((value) => !value),
    focusPreviousHistoryMessage: () =>
      history.focusAdjacentHistoryMessage("previous", { preserveFocus: true }),
    focusNextHistoryMessage: () =>
      history.focusAdjacentHistoryMessage("next", { preserveFocus: true }),
    focusPreviousSearchResult: () => search.focusAdjacentSearchResult("previous"),
    focusNextSearchResult: () => search.focusAdjacentSearchResult("next"),
    selectPreviousSession: () => selectAdjacentSessionShortcut("previous"),
    selectNextSession: () => selectAdjacentSessionShortcut("next"),
    selectPreviousProject: () => selectAdjacentProjectWithoutFocus("previous"),
    selectNextProject: () => selectAdjacentProjectWithoutFocus("next"),
    selectPreviousFocusedSession: () => history.selectAdjacentSession("previous"),
    selectNextFocusedSession: () => history.selectAdjacentSession("next"),
    selectPreviousFocusedProject: () => history.selectAdjacentProject("previous"),
    selectNextFocusedProject: () => history.selectAdjacentProject("next"),
    handleProjectTreeArrow: history.handleProjectTreeArrow,
    handleProjectTreeEnter: history.handleProjectTreeEnter,
    pageHistoryMessagesUp: history.pageHistoryMessagesUp,
    pageHistoryMessagesDown: history.pageHistoryMessagesDown,
    pageSearchResultsUp: search.pageSearchResultsUp,
    pageSearchResultsDown: search.pageSearchResultsDown,
    goToPreviousHistoryPage: history.goToPreviousHistoryPage,
    goToNextHistoryPage: history.goToNextHistoryPage,
    showMessagesView: history.handleSelectMessagesView,
    showTurnsView: () => void history.handleSelectTurnsView(),
    showBookmarksView: history.handleSelectBookmarksVisualization,
    canToggleTurnView: history.canToggleTurnView,
    goToPreviousSearchPage: search.goToPreviousSearchPage,
    goToNextSearchPage: search.goToNextSearchPage,
    handleSecondaryMessagePaneEscape: history.handleSecondaryMessagePaneEscape,
    applyZoomAction: appearance.applyZoomAction,
    triggerIncrementalRefresh: () => void handleIncrementalRefresh(),
    togglePeriodicRefresh: () =>
      updateRefreshStrategy((value) => (value !== "off" ? "off" : preferredRefreshStrategy)),
  });

  const autoRefreshStatusLabel = watchStrategyActive
    ? `${watcherPendingPathCount}`
    : isScanRefreshStrategy(refreshStrategy)
      ? autoRefreshScanInFlight
        ? "Refreshing..."
        : "Auto"
      : null;
  const autoRefreshStatusTone = watchStrategyActive
    ? ("queued" as const)
    : isScanRefreshStrategy(refreshStrategy)
      ? autoRefreshScanInFlight
        ? ("running" as const)
        : ("queued" as const)
      : null;
  const autoRefreshStatusTooltip = watchStrategyActive
    ? `Watcher queue: ${watcherPendingPathCount} files`
    : isScanRefreshStrategy(refreshStrategy)
      ? autoRefreshScanInFlight
        ? "Auto-refresh running"
        : "Auto-refresh waiting"
      : null;
  const viewerExternalAppsSnapshot = useMemo(
    () => ({
      editors: appearance.availableEditors,
      diffTools: appearance.availableDiffTools,
      preferences: {
        preferredExternalEditor: appearance.preferredExternalEditor,
        preferredExternalDiffTool: appearance.preferredExternalDiffTool,
        terminalAppCommand: appearance.terminalAppCommand,
        orderedToolIds: appearance.externalTools.map((tool) => tool.id),
        externalTools: appearance.externalTools,
      },
    }),
    [
      appearance.availableDiffTools,
      appearance.availableEditors,
      appearance.externalTools,
      appearance.preferredExternalDiffTool,
      appearance.preferredExternalEditor,
      appearance.terminalAppCommand,
    ],
  );
  const recordLiveUiTrace = useCallback(
    (payload: IpcRequestInput<"debug:recordLiveUiTrace">) => {
      if (IS_TEST_ENV) {
        return;
      }
      void codetrail.invoke("debug:recordLiveUiTrace", payload).catch((error) => {
        logError("Failed recording live UI trace", error);
      });
    },
    [codetrail, logError],
  );
  const liveTraceProps = liveStatus?.instrumentationEnabled ? { recordLiveUiTrace } : {};

  return (
    <ViewerExternalAppsProvider value={viewerExternalAppsSnapshot}>
      <PaneFocusProvider controller={paneFocus}>
        <main className="app-shell">
          <TopBar
            mainView={mainView}
            theme={appearance.theme}
            shikiTheme={appearance.shikiTheme}
            indexing={indexing}
            focusMode={focusMode}
            focusDisabled={mainView !== "history"}
            onToggleSearchView={() =>
              mainView === "search" ? returnToHistoryWithPaneFocus() : focusGlobalSearch()
            }
            onThemeChange={appearance.setTheme}
            onThemePreview={appearance.previewTheme}
            onThemePreviewReset={appearance.clearPreviewTheme}
            onShikiThemeChange={appearance.setShikiTheme}
            onShikiThemePreview={appearance.previewShikiTheme}
            onShikiThemePreviewReset={appearance.clearPreviewShikiTheme}
            onIncrementalRefresh={() => void handleIncrementalRefresh()}
            refreshStrategy={refreshStrategy}
            onRefreshStrategyChange={updateRefreshStrategy}
            autoRefreshStatusLabel={autoRefreshStatusLabel}
            autoRefreshStatusTone={autoRefreshStatusTone}
            autoRefreshStatusTooltip={autoRefreshStatusTooltip}
            onToggleFocus={toggleFocusMode}
            onToggleHelp={() =>
              mainView === "help" ? returnToHistoryWithPaneFocus() : openHelpView()
            }
            onToggleSettings={() =>
              mainView === "settings" ? returnToHistoryWithPaneFocus() : openSettingsView()
            }
          />

          <div
            className={`workspace ${isHistoryLayout ? "history-layout" : "single-layout"} ${
              mainView === "search" ? "search-layout" : ""
            }${history.projectPaneCollapsed ? " projects-collapsed" : ""}${
              history.sessionPaneCollapsed ? " sessions-collapsed" : ""
            }${
              history.hideSessionsPaneForTreeView ? " tree-sessions-hidden" : ""
            }${isHistoryLayout && !history.paneStateHydrated ? " pane-layout-hydrating" : ""}`}
            style={history.workspaceStyle}
            aria-busy={isHistoryLayout && !history.paneStateHydrated}
          >
            {mainView === "history" ? (
              isHistoryLayout ? (
                <HistoryLayout
                  history={history}
                  advancedSearchEnabled={advancedSearchEnabled}
                  setAdvancedSearchEnabled={setAdvancedSearchEnabled}
                  zoomPercent={appearance.zoomPercent}
                  canZoomIn={appearance.canZoomIn}
                  canZoomOut={appearance.canZoomOut}
                  applyZoomAction={appearance.applyZoomAction}
                  setZoomPercent={appearance.setZoomPercent}
                  logError={logError}
                  canReindexProject={canReindexAnyProject}
                  onReindexProject={handleOpenProjectReindex}
                  onDeleteProject={handleOpenProjectDelete}
                  onDeleteSession={handleOpenSessionDelete}
                  liveSessions={liveStatus?.sessions ?? []}
                  liveRowHasBackground={history.liveWatchRowHasBackground}
                  {...liveTraceProps}
                />
              ) : (
                <section
                  className={`pane content-pane history-focus-pane history-visualization-${history.historyVisualization}`}
                  {...paneFocus.getHistoryPaneRootProps("message")}
                  ref={(element) => {
                    paneFocus.registerHistoryPaneRoot("message", element);
                  }}
                >
                  <HistoryDetailPane
                    history={history}
                    advancedSearchEnabled={advancedSearchEnabled}
                    setAdvancedSearchEnabled={setAdvancedSearchEnabled}
                    zoomPercent={appearance.zoomPercent}
                    canZoomIn={appearance.canZoomIn}
                    canZoomOut={appearance.canZoomOut}
                    applyZoomAction={appearance.applyZoomAction}
                    setZoomPercent={appearance.setZoomPercent}
                    liveSessions={liveStatus?.sessions ?? []}
                    liveRowHasBackground={history.liveWatchRowHasBackground}
                    {...liveTraceProps}
                  />
                </section>
              )
            ) : mainView === "search" ? (
              <SearchView
                search={search}
                enabledProviders={enabledProviders}
                projects={history.sortedProjects}
                advancedSearchEnabled={advancedSearchEnabled}
                setAdvancedSearchEnabled={setAdvancedSearchEnabled}
                onSelectResult={(result) => {
                  history.navigateFromSearchResult({
                    targetMode: "project_all",
                    projectId: result.projectId,
                    sessionId: result.sessionId,
                    messageId: result.messageId,
                    sourceId: result.messageSourceId,
                    historyCategories: [...history.historyCategories],
                  });
                  returnToHistoryWithPaneFocus();
                }}
              />
            ) : mainView === "help" ? (
              <section className="pane content-pane" ref={helpViewRef} tabIndex={-1}>
                <ShortcutsDialog
                  shortcuts={shortcuts}
                  commonSyntaxItems={[...COMMON_SYNTAX_ITEMS]}
                  advancedSyntaxItems={[...ADVANCED_SYNTAX_ITEMS]}
                />
              </section>
            ) : (
              <section className="pane content-pane" ref={settingsViewRef} tabIndex={-1}>
                <SettingsView
                  info={appearance.settingsInfo}
                  loading={appearance.settingsLoading}
                  error={appearance.settingsError}
                  diagnostics={watchStats}
                  diagnosticsLoading={watchStatsLoading}
                  diagnosticsError={watchStatsError}
                  liveStatus={liveStatus}
                  liveStatusError={liveStatusError}
                  claudeHookState={liveStatus?.claudeHookState ?? null}
                  claudeHookActionPending={claudeHookActionPending}
                  onInstallClaudeHooks={() => void installClaudeHooks()}
                  onRemoveClaudeHooks={() => void removeClaudeHooks()}
                  liveWatchEnabled={history.liveWatchEnabled}
                  liveWatchRowHasBackground={history.liveWatchRowHasBackground}
                  onLiveWatchEnabledChange={history.setLiveWatchEnabled}
                  onLiveWatchRowHasBackgroundChange={history.setLiveWatchRowHasBackground}
                  appearance={{
                    theme: appearance.theme,
                    shikiTheme: appearance.shikiTheme,
                    zoomPercent: appearance.zoomPercent,
                    messagePageSize: appearance.messagePageSize,
                    monoFontFamily: appearance.monoFontFamily,
                    regularFontFamily: appearance.regularFontFamily,
                    monoFontSize: appearance.monoFontSize,
                    regularFontSize: appearance.regularFontSize,
                    useMonospaceForAllMessages: appearance.useMonospaceForAllMessages,
                    autoHideMessageActions: appearance.autoHideMessageActions,
                    expandPreviewOnHiddenActions: appearance.expandPreviewOnHiddenActions,
                    autoHideViewerHeaderActions: appearance.autoHideViewerHeaderActions,
                    defaultViewerWrapMode: appearance.defaultViewerWrapMode,
                    defaultDiffViewMode: appearance.defaultDiffViewMode,
                    collapseMultiFileToolDiffs: appearance.collapseMultiFileToolDiffs,
                    preferredExternalEditor: appearance.preferredExternalEditor,
                    preferredExternalDiffTool: appearance.preferredExternalDiffTool,
                    terminalAppCommand: appearance.terminalAppCommand,
                    externalTools: appearance.externalTools,
                    availableEditors: appearance.availableEditors,
                    availableDiffTools: appearance.availableDiffTools,
                    onThemeChange: appearance.setTheme,
                    onShikiThemeChange: appearance.setShikiTheme,
                    onZoomPercentChange: appearance.setZoomPercent,
                    onMessagePageSizeChange: appearance.setMessagePageSize,
                    onMonoFontFamilyChange: appearance.setMonoFontFamily,
                    onRegularFontFamilyChange: appearance.setRegularFontFamily,
                    onMonoFontSizeChange: appearance.setMonoFontSize,
                    onRegularFontSizeChange: appearance.setRegularFontSize,
                    onUseMonospaceForAllMessagesChange: appearance.setUseMonospaceForAllMessages,
                    onAutoHideMessageActionsChange: appearance.setAutoHideMessageActions,
                    onExpandPreviewOnHiddenActionsChange:
                      appearance.setExpandPreviewOnHiddenActions,
                    onAutoHideViewerHeaderActionsChange: appearance.setAutoHideViewerHeaderActions,
                    onDefaultViewerWrapModeChange: appearance.setDefaultViewerWrapMode,
                    onDefaultDiffViewModeChange: appearance.setDefaultDiffViewMode,
                    onCollapseMultiFileToolDiffsChange: appearance.setCollapseMultiFileToolDiffs,
                    onPreferredExternalEditorChange: appearance.setPreferredExternalEditor,
                    onPreferredExternalDiffToolChange: appearance.setPreferredExternalDiffTool,
                    onTerminalAppCommandChange: appearance.setTerminalAppCommand,
                    onExternalToolsChange: appearance.setExternalTools,
                    onRescanExternalTools: async () => {
                      await appearance.loadAvailableExternalTools();
                    },
                  }}
                  indexing={{
                    enabledProviders,
                    removeMissingSessionsDuringIncrementalIndexing:
                      history.removeMissingSessionsDuringIncrementalIndexing,
                    canForceReindex: !indexing && refreshStrategy === "off",
                    onToggleProviderEnabled: handleProviderToggle,
                    onForceReindex: () => setShowReindexConfirm(true),
                    onRemoveMissingSessionsDuringIncrementalIndexingChange:
                      handleMissingSessionCleanupToggle,
                  }}
                  messageRules={{
                    systemMessageRegexRules: history.systemMessageRegexRules,
                    onAddSystemMessageRegexRule: handleAddSystemMessageRegexRule,
                    onUpdateSystemMessageRegexRule: handleUpdateSystemMessageRegexRule,
                    onRemoveSystemMessageRegexRule: handleRemoveSystemMessageRegexRule,
                  }}
                  onActionError={logError}
                />
              </section>
            )}
          </div>
          <ConfirmDialog
            open={showClaudeHooksPrompt}
            title="Install Claude Hooks?"
            message="Claude can report precise waiting-for-input, approval, and tool states only when Codetrail-managed Claude hooks are installed. Install them now?"
            confirmLabel="Install Hooks"
            cancelLabel="Not Now"
            onConfirm={() => {
              history.setClaudeHooksPrompted(true);
              setShowClaudeHooksPrompt(false);
              void installClaudeHooks();
            }}
            onCancel={() => {
              history.setClaudeHooksPrompted(true);
              setShowClaudeHooksPrompt(false);
            }}
          />
          <ConfirmDialog
            open={showReindexConfirm}
            title="Force Reindex"
            message="This will re-read all enabled provider session files from scratch and rebuild indexed history from disk. If some old sessions only exist in the database because their raw transcript files were already cleaned up, they can disappear after this reindex. Continue?"
            confirmLabel="Reindex"
            cancelLabel="Cancel"
            onConfirm={() => {
              setShowReindexConfirm(false);
              void handleForceRefresh();
            }}
            onCancel={() => setShowReindexConfirm(false)}
          />
          <ConfirmDialog
            open={pendingProjectReindexId !== null}
            title="Reindex Project"
            message={`This will re-read all enabled provider session files for ${
              pendingProjectReindex?.name || pendingProjectReindex?.path || "the selected project"
            } only and rebuild indexed history for that project only. If some old sessions for this project exist only in the database because their raw transcript files were already cleaned up, they can disappear after this reindex. Other projects are unaffected. Continue?`}
            confirmLabel="Reindex Project"
            cancelLabel="Cancel"
            onConfirm={() => {
              const projectId = pendingProjectReindexId;
              setPendingProjectReindexId(null);
              if (!projectId) {
                return;
              }
              if (!pendingProjectReindex) {
                logError(
                  "Project reindex failed",
                  new Error("This project no longer exists in the database."),
                );
                return;
              }
              void handleProjectForceRefresh(projectId);
            }}
            onCancel={() => setPendingProjectReindexId(null)}
          />
          <ConfirmDialog
            open={pendingProviderDisable !== null}
            title={`Disable ${pendingProviderDisableLabel}?`}
            message={`Disabling ${pendingProviderDisableLabel} will delete all indexed sessions and all bookmarks for that provider from Codetrail. Raw transcript files on disk will not be touched. Continue?`}
            confirmLabel="Disable Provider"
            cancelLabel="Cancel"
            onConfirm={() => {
              if (!pendingProviderDisable) {
                return;
              }
              setEnabledProviders((current) =>
                current.filter((provider) => provider !== pendingProviderDisable),
              );
              setPendingProviderDisable(null);
            }}
            onCancel={() => setPendingProviderDisable(null)}
          />
          <ConfirmDialog
            open={pendingMissingSessionCleanupEnable}
            title="Enable Missing Session Cleanup?"
            message="When this is enabled, incremental refreshes will delete indexed sessions whose raw transcript files can no longer be found on disk. This can also remove related bookmarks if their sessions disappear. Continue?"
            confirmLabel="Enable Cleanup"
            cancelLabel="Cancel"
            onConfirm={() => {
              history.setRemoveMissingSessionsDuringIncrementalIndexing(true);
              setPendingMissingSessionCleanupEnable(false);
            }}
            onCancel={() => setPendingMissingSessionCleanupEnable(false)}
          />
          <DeleteIndexedHistoryDialog
            open={pendingHistoryDelete !== null}
            target={pendingHistoryDelete}
            errorMessage={historyDeleteError}
            busy={historyDeletePending}
            onConfirm={() => {
              void handleConfirmHistoryDelete();
            }}
            onCancel={() => {
              setHistoryDeleteError(null);
              setPendingHistoryDelete(null);
            }}
          />
          <HistoryExportProgressDialog
            open={history.historyExportState.open}
            percent={history.historyExportState.percent}
            message={history.historyExportState.message}
            scopeLabel={
              history.historyExportState.scope === "all_pages" ? "All pages" : "Current page"
            }
          />
        </main>
      </PaneFocusProvider>
    </ViewerExternalAppsProvider>
  );
}

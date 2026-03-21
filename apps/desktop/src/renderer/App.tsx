import { useCallback, useEffect, useRef, useState } from "react";

import {
  type MessageCategory,
  PROVIDER_LIST,
  type Provider,
  type SearchMode,
} from "@codetrail/core/browser";

import {
  DEFAULT_PREFERRED_REFRESH_STRATEGY,
  type RefreshStrategy,
  SCAN_STRATEGY_TO_INTERVAL_MS,
  type ScanRefreshStrategy,
  WATCH_STRATEGY_TO_DEBOUNCE_MS,
  isScanRefreshStrategy,
  isWatchRefreshStrategy,
} from "./app/autoRefresh";
import {
  ADVANCED_SYNTAX_ITEMS,
  COMMON_SYNTAX_ITEMS,
  PROVIDERS,
  SHORTCUT_ITEMS,
} from "./app/constants";
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
import { useHistoryController } from "./features/useHistoryController";
import { useSearchController } from "./features/useSearchController";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useReconcileProviderSelection } from "./hooks/useReconcileProviderSelection";
import { isMissingCodetrailClient, useCodetrailClient } from "./lib/codetrailClient";
import { findSessionSummaryById } from "./lib/historySessionLookup";
import { toErrorMessage, toggleValue } from "./lib/viewUtils";

// Module-level override for tests — keeps the component API clean
let _testStrategyIntervalOverrides: Partial<Record<ScanRefreshStrategy, number>> | null = null;
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
}: {
  initialPaneState?: PaneStateSnapshot | null;
}) {
  const codetrail = useCodetrailClient();
  const preloadUnavailable = isMissingCodetrailClient(codetrail);
  const [refreshing, setRefreshing] = useState(false);
  const [indexingInBackground, setIndexingInBackground] = useState(false);
  const [mainView, setMainView] = useState<MainView>("history");
  const [focusMode, setFocusMode] = useState(false);
  const [advancedSearchEnabled, setAdvancedSearchEnabled] = useState(false);
  const [showReindexConfirm, setShowReindexConfirm] = useState(false);
  const [pendingProviderDisable, setPendingProviderDisable] = useState<Provider | null>(null);
  const [pendingMissingSessionCleanupEnable, setPendingMissingSessionCleanupEnable] =
    useState(false);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState<PendingHistoryDelete | null>(
    null,
  );
  const [historyDeleteError, setHistoryDeleteError] = useState<string | null>(null);
  const [historyDeletePending, setHistoryDeletePending] = useState(false);
  const [refreshStrategy, setRefreshStrategy] = useState<RefreshStrategy>("off");
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

  const isHistoryLayout = mainView === "history" && !focusMode;
  const searchMode: SearchMode = advancedSearchEnabled ? "advanced" : "simple";
  const logError = useCallback((context: string, error: unknown) => {
    console.error(`[codetrail] ${context}: ${toErrorMessage(error)}`);
  }, []);
  const wasIndexingRef = useRef(false);
  const lastCompletedJobsRef = useRef(-1);
  const watchStatsLoadedRef = useRef(false);
  const skipNextStatusDrivenReloadRef = useRef(false);

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

  useEffect(() => {
    if (mainView !== "settings" || appearance.settingsInfo || appearance.settingsLoading) {
      return;
    }
    void appearance.loadSettingsInfo();
  }, [appearance.loadSettingsInfo, appearance.settingsInfo, appearance.settingsLoading, mainView]);

  useEffect(() => {
    if (mainView !== "settings") {
      return;
    }

    let cancelled = false;

    const loadWatchStats = async (showLoading: boolean) => {
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

    void loadWatchStats(!watchStatsLoadedRef.current);
    const intervalId = window.setInterval(() => {
      void loadWatchStats(false);
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [codetrail, mainView]);

  useReconcileProviderSelection(enabledProviders, setSearchProviders);

  useEffect(() => {
    if (
      search.searchProjectId &&
      !history.sortedProjects.some((project) => project.id === search.searchProjectId)
    ) {
      search.setSearchProjectId("");
    }
  }, [history.sortedProjects, search]);

  const reloadIndexedData = useCallback(
    async (source: "manual" | "auto") => {
      await Promise.all([history.handleRefreshAllData(source), search.reloadSearch()]);
    },
    [history.handleRefreshAllData, search.reloadSearch],
  );

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
    [history.selectedProject, history.selectedProjectId, history.sortedProjects],
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

    const syncIndexingStatus = async () => {
      try {
        const status = await codetrail.invoke("indexer:getStatus", {});
        if (cancelled) {
          return;
        }
        setIndexingInBackground(status.running);
        const wasIndexing = wasIndexingRef.current;
        wasIndexingRef.current = status.running;
        // Reload when indexing finishes (transition detection) OR when completedJobs
        // counter advances (catches fast jobs that complete between polls).
        const prevCompleted = lastCompletedJobsRef.current;
        lastCompletedJobsRef.current = status.completedJobs;
        if (
          (wasIndexing && !status.running) ||
          (prevCompleted >= 0 && status.completedJobs > prevCompleted)
        ) {
          if (skipNextStatusDrivenReloadRef.current) {
            skipNextStatusDrivenReloadRef.current = false;
          } else {
            await reloadIndexedData("auto");
          }
        }
      } catch (error) {
        if (!cancelled) {
          logError("Indexing status refresh failed", error);
        }
      }
    };

    void syncIndexingStatus();
    const intervalId = window.setInterval(() => {
      void syncIndexingStatus();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [codetrail, logError, reloadIndexedData]);

  useEffect(() => {
    if (!isWatchRefreshStrategy(refreshStrategy)) {
      setWatcherPendingPathCount(0);
      return;
    }

    let cancelled = false;

    const syncWatcherStatus = async () => {
      try {
        const status = await codetrail.invoke("watcher:getStatus", {});
        if (!cancelled) {
          setWatcherPendingPathCount(status.pendingPathCount);
        }
      } catch (error) {
        if (!cancelled) {
          logError("Watcher status refresh failed", error);
        }
      }
    };

    void syncWatcherStatus();
    const intervalId = window.setInterval(() => {
      void syncWatcherStatus();
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [codetrail, logError, refreshStrategy]);

  const focusSessionSearch = useCallback(() => {
    setMainView("history");
    history.focusSessionSearch();
  }, [history]);

  const focusGlobalSearch = useCallback(() => {
    setMainView("search");
    search.focusGlobalSearch();
  }, [search]);

  const toggleFocusMode = useCallback(() => {
    if (mainView !== "history") {
      return;
    }
    window.requestAnimationFrame(() => {
      history.refs.messageListRef.current?.focus({ preventScroll: true });
    });
    setFocusMode((value) => !value);
  }, [history.refs.messageListRef, mainView]);

  const handleRefresh = useCallback(
    async (force: boolean) => {
      setRefreshing(true);
      try {
        skipNextStatusDrivenReloadRef.current = true;
        await codetrail.invoke("indexer:refresh", { force });
        await reloadIndexedData("manual");
      } catch (error) {
        skipNextStatusDrivenReloadRef.current = false;
        logError("Refresh failed", error);
      } finally {
        setRefreshing(false);
      }
    },
    [codetrail, logError, reloadIndexedData],
  );

  const handleIncrementalRefresh = useCallback(async () => {
    await handleRefresh(false);
  }, [handleRefresh]);

  const handleForceRefresh = useCallback(async () => {
    await handleRefresh(true);
  }, [handleRefresh]);
  const indexing = refreshing || indexingInBackground;
  const handleToggleExpandedByDefault = useCallback(
    (category: MessageCategory) => {
      history.setExpandedByDefaultCategories((value) =>
        toggleValue<MessageCategory>(value, category),
      );
    },
    [history],
  );
  const handleAddSystemMessageRegexRule = useCallback(
    (provider: Provider) => {
      history.setSystemMessageRegexRules((value) => ({
        ...value,
        [provider]: [...value[provider], ""],
      }));
    },
    [history],
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
    [history],
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
    [history],
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
    [history],
  );

  const refreshingRef = useRef(false);
  useEffect(() => {
    refreshingRef.current = indexing;
  }, [indexing]);

  const pollingIntervalMs = isScanRefreshStrategy(refreshStrategy)
    ? (_testStrategyIntervalOverrides?.[refreshStrategy] ??
      SCAN_STRATEGY_TO_INTERVAL_MS[refreshStrategy])
    : 0;
  useEffect(() => {
    if (pollingIntervalMs <= 0) return;
    const id = window.setInterval(() => {
      if (refreshingRef.current) return;
      setAutoRefreshScanInFlight(true);
      void handleRefresh(false).finally(() => {
        setAutoRefreshScanInFlight(false);
      });
    }, pollingIntervalMs);
    return () => window.clearInterval(id);
  }, [handleRefresh, pollingIntervalMs]);

  useEffect(() => {
    if (!isWatchRefreshStrategy(refreshStrategy)) return;

    void codetrail
      .invoke("watcher:start", {
        debounceMs: WATCH_STRATEGY_TO_DEBOUNCE_MS[refreshStrategy],
      })
      .then((result) => {
        if (!result.ok) {
          logError("File watcher started but no roots were watched", new Error("ok=false"));
        }
      })
      .catch((error: unknown) => {
        logError("Failed to start file watcher", error);
      });

    return () => {
      void codetrail.invoke("watcher:stop", {}).catch((error: unknown) => {
        logError("Failed to stop file watcher", error);
      });
    };
  }, [codetrail, logError, refreshStrategy]);

  useKeyboardShortcuts({
    mainView,
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
    clearFocusedHistoryMessage: () => history.setFocusMessageId(""),
    focusGlobalSearch,
    focusSessionSearch,
    toggleFocusMode,
    toggleScopedMessagesExpanded: history.handleToggleScopedMessagesExpanded,
    toggleHistoryCategory: history.handleToggleHistoryCategoryShortcut,
    toggleHistoryCategoryExpanded: history.handleToggleCategoryMessagesExpanded,
    toggleProjectPaneCollapsed: () => history.setProjectPaneCollapsed((value) => !value),
    toggleSessionPaneCollapsed: () => history.setSessionPaneCollapsed((value) => !value),
    focusPreviousHistoryMessage: () => history.focusAdjacentHistoryMessage("previous"),
    focusNextHistoryMessage: () => history.focusAdjacentHistoryMessage("next"),
    focusPreviousSearchResult: () => search.focusAdjacentSearchResult("previous"),
    focusNextSearchResult: () => search.focusAdjacentSearchResult("next"),
    selectPreviousSession: () => history.selectAdjacentSession("previous"),
    selectNextSession: () => history.selectAdjacentSession("next"),
    selectPreviousProject: () => history.selectAdjacentProject("previous"),
    selectNextProject: () => history.selectAdjacentProject("next"),
    handleProjectTreeArrow: history.handleProjectTreeArrow,
    handleProjectTreeEnter: history.handleProjectTreeEnter,
    pageHistoryMessagesUp: history.pageHistoryMessagesUp,
    pageHistoryMessagesDown: history.pageHistoryMessagesDown,
    pageSearchResultsUp: search.pageSearchResultsUp,
    pageSearchResultsDown: search.pageSearchResultsDown,
    goToPreviousHistoryPage: history.goToPreviousHistoryPage,
    goToNextHistoryPage: history.goToNextHistoryPage,
    goToPreviousSearchPage: search.goToPreviousSearchPage,
    goToNextSearchPage: search.goToNextSearchPage,
    applyZoomAction: appearance.applyZoomAction,
    triggerIncrementalRefresh: () => void handleIncrementalRefresh(),
    togglePeriodicRefresh: () =>
      updateRefreshStrategy((value) => (value !== "off" ? "off" : preferredRefreshStrategy)),
  });

  const autoRefreshStatusLabel = isWatchRefreshStrategy(refreshStrategy)
    ? `${watcherPendingPathCount}`
    : isScanRefreshStrategy(refreshStrategy)
      ? autoRefreshScanInFlight
        ? "Refreshing..."
        : "Auto"
      : null;
  const autoRefreshStatusTone = isWatchRefreshStrategy(refreshStrategy)
    ? ("queued" as const)
    : isScanRefreshStrategy(refreshStrategy)
      ? autoRefreshScanInFlight
        ? ("running" as const)
        : ("queued" as const)
      : null;
  const autoRefreshStatusTooltip = isWatchRefreshStrategy(refreshStrategy)
    ? "Number of changed files currently queued by the watcher before auto-refresh runs."
    : isScanRefreshStrategy(refreshStrategy)
      ? autoRefreshScanInFlight
        ? "Automatic scan refresh is currently running."
        : "Automatic scan refresh is enabled and waiting for the next interval."
      : null;

  return (
    <main className="app-shell">
      {preloadUnavailable ? (
        <section className="pane content-pane" style={{ display: "grid", placeItems: "center" }}>
          <div style={{ maxWidth: 760, padding: 24, textAlign: "left" }}>
            <h2 style={{ marginTop: 0 }}>Preload Bridge Unavailable</h2>
            <p>
              The renderer could not access <code>window.codetrail</code>. Check preload loading and
              context isolation setup.
            </p>
          </div>
        </section>
      ) : null}

      <TopBar
        mainView={mainView}
        theme={appearance.theme}
        indexing={indexing}
        focusMode={focusMode}
        focusDisabled={mainView !== "history"}
        onToggleSearchView={() =>
          setMainView((value) => (value === "search" ? "history" : "search"))
        }
        onThemeChange={appearance.setTheme}
        onIncrementalRefresh={() => void handleIncrementalRefresh()}
        refreshStrategy={refreshStrategy}
        onRefreshStrategyChange={updateRefreshStrategy}
        autoRefreshStatusLabel={autoRefreshStatusLabel}
        autoRefreshStatusTone={autoRefreshStatusTone}
        autoRefreshStatusTooltip={autoRefreshStatusTooltip}
        onToggleFocus={toggleFocusMode}
        onToggleHelp={() => setMainView((value) => (value === "help" ? "history" : "help"))}
        onToggleSettings={() =>
          setMainView((value) => (value === "settings" ? "history" : "settings"))
        }
      />

      <div
        className={`workspace ${isHistoryLayout ? "history-layout" : "single-layout"} ${
          mainView === "search" ? "search-layout" : ""
        }${history.projectPaneCollapsed ? " projects-collapsed" : ""}${
          history.sessionPaneCollapsed ? " sessions-collapsed" : ""
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
              onDeleteProject={handleOpenProjectDelete}
              onDeleteSession={handleOpenSessionDelete}
            />
          ) : (
            <section className="pane content-pane history-focus-pane">
              <HistoryDetailPane
                history={history}
                advancedSearchEnabled={advancedSearchEnabled}
                setAdvancedSearchEnabled={setAdvancedSearchEnabled}
                zoomPercent={appearance.zoomPercent}
                canZoomIn={appearance.canZoomIn}
                canZoomOut={appearance.canZoomOut}
                applyZoomAction={appearance.applyZoomAction}
                setZoomPercent={appearance.setZoomPercent}
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
                projectId: result.projectId,
                sessionId: result.sessionId,
                messageId: result.messageId,
                sourceId: result.messageSourceId,
                historyCategories: [...history.historyCategories],
              });
              setMainView("history");
            }}
          />
        ) : mainView === "help" ? (
          <section className="pane content-pane">
            <ShortcutsDialog
              shortcutItems={[...SHORTCUT_ITEMS]}
              commonSyntaxItems={[...COMMON_SYNTAX_ITEMS]}
              advancedSyntaxItems={[...ADVANCED_SYNTAX_ITEMS]}
            />
          </section>
        ) : (
          <section className="pane content-pane">
            <SettingsView
              info={appearance.settingsInfo}
              loading={appearance.settingsLoading}
              error={appearance.settingsError}
              diagnostics={watchStats}
              diagnosticsLoading={watchStatsLoading}
              diagnosticsError={watchStatsError}
              appearance={{
                theme: appearance.theme,
                zoomPercent: appearance.zoomPercent,
                monoFontFamily: appearance.monoFontFamily,
                regularFontFamily: appearance.regularFontFamily,
                monoFontSize: appearance.monoFontSize,
                regularFontSize: appearance.regularFontSize,
                useMonospaceForAllMessages: appearance.useMonospaceForAllMessages,
                onThemeChange: appearance.setTheme,
                onZoomPercentChange: appearance.setZoomPercent,
                onMonoFontFamilyChange: appearance.setMonoFontFamily,
                onRegularFontFamilyChange: appearance.setRegularFontFamily,
                onMonoFontSizeChange: appearance.setMonoFontSize,
                onRegularFontSizeChange: appearance.setRegularFontSize,
                onUseMonospaceForAllMessagesChange: appearance.setUseMonospaceForAllMessages,
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
                expandedByDefaultCategories: history.expandedByDefaultCategories,
                onToggleExpandedByDefault: handleToggleExpandedByDefault,
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
        scopeLabel={history.historyExportState.scope === "all_pages" ? "All pages" : "Current page"}
      />
    </main>
  );
}

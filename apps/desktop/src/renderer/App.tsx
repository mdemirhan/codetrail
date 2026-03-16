import { useCallback, useEffect, useRef, useState } from "react";

import type { MessageCategory, Provider, SearchMode } from "@codetrail/core";

import {
  DEFAULT_PREFERRED_REFRESH_STRATEGY,
  type RefreshStrategy,
  SCAN_STRATEGY_TO_INTERVAL_MS,
  type ScanRefreshStrategy,
  WATCH_STRATEGY_TO_DEBOUNCE_MS,
  isScanRefreshStrategy,
  isWatchRefreshStrategy,
} from "./app/autoRefresh";
import { ADVANCED_SYNTAX_ITEMS, COMMON_SYNTAX_ITEMS, SHORTCUT_ITEMS } from "./app/constants";
import type { MainView, PaneStateSnapshot } from "./app/types";
import { ConfirmDialog } from "./components/ConfirmDialog";
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
import { isMissingCodetrailClient, useCodetrailClient } from "./lib/codetrailClient";
import { toErrorMessage, toggleValue } from "./lib/viewUtils";

// Module-level override for tests — keeps the component API clean
let _testStrategyIntervalOverrides: Partial<Record<ScanRefreshStrategy, number>> | null = null;
export function setTestStrategyIntervalOverrides(
  overrides: Partial<Record<ScanRefreshStrategy, number>> | null,
): void {
  _testStrategyIntervalOverrides = overrides;
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
  const [refreshStrategy, setRefreshStrategy] = useState<RefreshStrategy>("off");
  const [watcherPendingPathCount, setWatcherPendingPathCount] = useState(0);
  const [autoRefreshScanInFlight, setAutoRefreshScanInFlight] = useState(false);
  const [searchProviders, setSearchProviders] = useState<Provider[]>(
    initialPaneState?.searchProviders ?? [],
  );

  const isHistoryLayout = mainView === "history" && !focusMode;
  const searchMode: SearchMode = advancedSearchEnabled ? "advanced" : "simple";
  const logError = useCallback((context: string, error: unknown) => {
    console.error(`[codetrail] ${context}: ${toErrorMessage(error)}`);
  }, []);
  const wasIndexingRef = useRef(false);
  const lastCompletedJobsRef = useRef(-1);

  const appearance = useAppearanceController({
    initialPaneState,
    logError,
  });
  const history = useHistoryController({
    initialPaneState,
    isHistoryLayout,
    searchMode,
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
    if (
      search.searchProjectId &&
      !history.sortedProjects.some((project) => project.id === search.searchProjectId)
    ) {
      search.setSearchProjectId("");
    }
  }, [history.sortedProjects, search]);

  const reloadIndexedData = useCallback(async () => {
    await Promise.all([history.handleRefreshAllData(), search.reloadSearch()]);
  }, [history.handleRefreshAllData, search.reloadSearch]);

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
          await reloadIndexedData();
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
        await codetrail.invoke("indexer:refresh", { force });
        await reloadIndexedData();
      } catch (error) {
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
    selectPreviousSession: () => history.selectAdjacentSession("previous"),
    selectNextSession: () => history.selectAdjacentSession("next"),
    selectPreviousProject: () => history.selectAdjacentProject("previous"),
    selectNextProject: () => history.selectAdjacentProject("next"),
    pageHistoryMessagesUp: history.pageHistoryMessagesUp,
    pageHistoryMessagesDown: history.pageHistoryMessagesDown,
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
        onForceRefresh={() => setShowReindexConfirm(true)}
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
              theme={appearance.theme}
              zoomPercent={appearance.zoomPercent}
              monoFontFamily={appearance.monoFontFamily}
              regularFontFamily={appearance.regularFontFamily}
              monoFontSize={appearance.monoFontSize}
              regularFontSize={appearance.regularFontSize}
              useMonospaceForAllMessages={appearance.useMonospaceForAllMessages}
              onThemeChange={appearance.setTheme}
              onZoomPercentChange={appearance.setZoomPercent}
              onMonoFontFamilyChange={appearance.setMonoFontFamily}
              onRegularFontFamilyChange={appearance.setRegularFontFamily}
              onMonoFontSizeChange={appearance.setMonoFontSize}
              onRegularFontSizeChange={appearance.setRegularFontSize}
              onUseMonospaceForAllMessagesChange={appearance.setUseMonospaceForAllMessages}
              expandedByDefaultCategories={history.expandedByDefaultCategories}
              onToggleExpandedByDefault={(category) =>
                history.setExpandedByDefaultCategories((value) =>
                  toggleValue<MessageCategory>(value, category),
                )
              }
              systemMessageRegexRules={history.systemMessageRegexRules}
              onAddSystemMessageRegexRule={(provider) =>
                history.setSystemMessageRegexRules((value) => ({
                  ...value,
                  [provider]: [...value[provider], ""],
                }))
              }
              onUpdateSystemMessageRegexRule={(provider, index, pattern) =>
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
                })
              }
              onRemoveSystemMessageRegexRule={(provider, index) =>
                history.setSystemMessageRegexRules((value) => {
                  const current = value[provider] ?? [];
                  if (index < 0 || index >= current.length) {
                    return value;
                  }
                  return {
                    ...value,
                    [provider]: current.filter((_, candidateIndex) => candidateIndex !== index),
                  };
                })
              }
            />
          </section>
        )}
      </div>
      <ConfirmDialog
        open={showReindexConfirm}
        title="Force Reindex"
        message="This will re-read and re-index all provider session files from scratch. This may take a while. Continue?"
        confirmLabel="Reindex"
        cancelLabel="Cancel"
        onConfirm={() => {
          setShowReindexConfirm(false);
          void handleForceRefresh();
        }}
        onCancel={() => setShowReindexConfirm(false)}
      />
    </main>
  );
}

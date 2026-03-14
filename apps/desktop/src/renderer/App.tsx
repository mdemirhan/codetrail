import { useCallback, useEffect, useRef, useState } from "react";

import type { MessageCategory, Provider, SearchMode } from "@codetrail/core";

import {
  ADVANCED_SYNTAX_ITEMS,
  COMMON_SYNTAX_ITEMS,
  PROVIDERS,
  SHORTCUT_ITEMS,
} from "./app/constants";
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

export function App({ initialPaneState = null }: { initialPaneState?: PaneStateSnapshot | null }) {
  const codetrail = useCodetrailClient();
  const preloadUnavailable = isMissingCodetrailClient(codetrail);
  const [refreshing, setRefreshing] = useState(false);
  const [indexingInBackground, setIndexingInBackground] = useState(false);
  const [mainView, setMainView] = useState<MainView>("history");
  const [focusMode, setFocusMode] = useState(false);
  const [advancedSearchEnabled, setAdvancedSearchEnabled] = useState(false);
  const [showReindexConfirm, setShowReindexConfirm] = useState(false);
  const [periodicRefreshInterval, setPeriodicRefreshInterval] = useState(0);
  const [preferredPeriodicInterval, setPreferredPeriodicInterval] = useState(
    (initialPaneState?.periodicRefreshInterval ?? 0) || 10_000,
  );
  const [searchProviders, setSearchProviders] = useState<Provider[]>(
    initialPaneState?.searchProviders ?? [],
  );

  const isHistoryLayout = mainView === "history" && !focusMode;
  const searchMode: SearchMode = advancedSearchEnabled ? "advanced" : "simple";
  const logError = useCallback((context: string, error: unknown) => {
    console.error(`[codetrail] ${context}: ${toErrorMessage(error)}`);
  }, []);
  const wasIndexingRef = useRef(false);

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
    periodicRefreshInterval: preferredPeriodicInterval,
    setPeriodicRefreshInterval: setPreferredPeriodicInterval,
  });
  const search = useSearchController({
    searchMode,
    searchProviders,
    setSearchProviders,
    historyCategories: history.historyCategories,
    setHistoryCategories: history.setHistoryCategories,
    logError,
  });

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
        if (wasIndexing && !status.running) {
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

  const focusSessionSearch = useCallback(() => {
    setMainView("history");
    history.focusSessionSearch();
  }, [history]);

  const focusGlobalSearch = useCallback(() => {
    setMainView("search");
    search.focusGlobalSearch();
  }, [search]);

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
    [codetrail, history, logError, search],
  );

  const handleIncrementalRefresh = useCallback(async () => {
    await handleRefresh(false);
  }, [handleRefresh]);

  const handleForceRefresh = useCallback(async () => {
    await handleRefresh(true);
  }, [handleRefresh]);
  const indexing = refreshing || indexingInBackground;

  const refreshingRef = useRef(false);
  useEffect(() => {
    refreshingRef.current = indexing;
  }, [indexing]);

  // Keep a stable ref to handleRefresh so the periodic timer effect doesn't need
  // handleRefresh in its dependency array (handleRefresh has an unstable identity
  // because its deps include the entire history/search objects).
  const handleRefreshRef = useRef(handleRefresh);
  useEffect(() => {
    handleRefreshRef.current = handleRefresh;
  }, [handleRefresh]);

  useEffect(() => {
    if (periodicRefreshInterval <= 0) return;
    const id = window.setInterval(() => {
      if (refreshingRef.current) return;
      void handleRefreshRef.current(false);
    }, periodicRefreshInterval);
    return () => window.clearInterval(id);
  }, [periodicRefreshInterval]);

  useEffect(() => {
    if (periodicRefreshInterval > 0) {
      setPreferredPeriodicInterval(periodicRefreshInterval);
    }
  }, [periodicRefreshInterval]);

  useKeyboardShortcuts({
    mainView,
    hasFocusedHistoryMessage: Boolean(history.visibleFocusedMessageId),
    setMainView,
    clearFocusedHistoryMessage: () => history.setFocusMessageId(""),
    focusGlobalSearch,
    focusSessionSearch,
    toggleFocusMode: () => setFocusMode((value) => !value),
    toggleScopedMessagesExpanded: history.handleToggleScopedMessagesExpanded,
    toggleHistoryCategory: history.handleToggleHistoryCategoryShortcut,
    toggleProjectPaneCollapsed: () => history.setProjectPaneCollapsed((value) => !value),
    toggleSessionPaneCollapsed: () => history.setSessionPaneCollapsed((value) => !value),
    focusPreviousHistoryMessage: () => history.focusAdjacentHistoryMessage("previous"),
    focusNextHistoryMessage: () => history.focusAdjacentHistoryMessage("next"),
    selectPreviousSession: () => history.selectAdjacentSession("previous"),
    selectNextSession: () => history.selectAdjacentSession("next"),
    selectPreviousProject: () => history.selectAdjacentProject("previous"),
    selectNextProject: () => history.selectAdjacentProject("next"),
    goToPreviousHistoryPage: history.goToPreviousHistoryPage,
    goToNextHistoryPage: history.goToNextHistoryPage,
    goToPreviousSearchPage: search.goToPreviousSearchPage,
    goToNextSearchPage: search.goToNextSearchPage,
    applyZoomAction: appearance.applyZoomAction,
    triggerIncrementalRefresh: () => void handleIncrementalRefresh(),
    togglePeriodicRefresh: () =>
      setPeriodicRefreshInterval((v) => (v > 0 ? 0 : preferredPeriodicInterval)),
  });

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
        periodicRefreshInterval={periodicRefreshInterval}
        onPeriodicRefreshIntervalChange={setPeriodicRefreshInterval}
        onToggleFocus={() => setFocusMode((value) => !value)}
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
              logError={logError}
            />
          ) : (
            <section className="pane content-pane">
              <HistoryDetailPane
                history={history}
                advancedSearchEnabled={advancedSearchEnabled}
                setAdvancedSearchEnabled={setAdvancedSearchEnabled}
                zoomPercent={appearance.zoomPercent}
                canZoomIn={appearance.canZoomIn}
                canZoomOut={appearance.canZoomOut}
                applyZoomAction={appearance.applyZoomAction}
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
              monoFontFamily={appearance.monoFontFamily}
              regularFontFamily={appearance.regularFontFamily}
              monoFontSize={appearance.monoFontSize}
              regularFontSize={appearance.regularFontSize}
              useMonospaceForAllMessages={appearance.useMonospaceForAllMessages}
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

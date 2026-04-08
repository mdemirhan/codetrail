import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

import { isWatchRefreshStrategy } from "../app/autoRefresh";
import { resolveStableRefreshSource } from "../lib/projectUpdates";
import type { RefreshContext } from "./historyControllerTypes";
import {
  buildRefreshContext,
  getAutoRefreshTarget,
  getManualRefreshTarget,
  shouldRefreshTreeSessions,
} from "./historyRefreshPlanner";
import { getProjectRefreshFingerprint, getSessionRefreshFingerprint } from "./historyRefreshPolicy";
import type {
  HistoryRefreshCatalogApi,
  HistoryRefreshDetailApi,
  HistoryRefreshDetailState,
  HistoryRefreshSelectionState,
  HistoryRefreshSortState,
  HistoryRefreshTarget,
  HistoryRefreshViewportBindings,
} from "./historyRefreshTypes";
import { useHistoryViewportEffects } from "./useHistoryViewportEffects";

export function useHistoryRefreshController({
  refreshContextRef,
  selection,
  detailState,
  sortState,
  catalog,
  detailApi,
  viewport,
}: {
  refreshContextRef: MutableRefObject<RefreshContext | null>;
  selection: HistoryRefreshSelectionState;
  detailState: HistoryRefreshDetailState;
  sortState: HistoryRefreshSortState;
  catalog: HistoryRefreshCatalogApi;
  detailApi: HistoryRefreshDetailApi;
  viewport: HistoryRefreshViewportBindings;
}) {
  const selectedProjectRefreshFingerprintRef = useRef("");
  const selectedSessionRefreshFingerprintRef = useRef("");
  const refreshIdCounterRef = useRef(0);
  const scrollPreservationRef = useRef<RefreshContext["scrollPreservation"]>(null);
  const pendingAutoScrollRef = useRef(false);
  const prevMessageIdsRef = useRef("");
  const startupWatchResortPendingRef = useRef(
    isWatchRefreshStrategy(catalog.initialAutoRefreshStrategy ?? "off"),
  );

  useEffect(() => {
    selectedProjectRefreshFingerprintRef.current = getProjectRefreshFingerprint(
      detailState.selectedProject,
    );
  }, [detailState.selectedProject]);

  useEffect(() => {
    selectedSessionRefreshFingerprintRef.current = getSessionRefreshFingerprint(
      detailState.selectedSession,
    );
  }, [detailState.selectedSession]);

  useHistoryViewportEffects({
    messageListRef: viewport.messageListRef,
    historyMode: selection.historyMode,
    selectedProjectId: selection.selectedProjectId,
    selectedSessionId: selection.selectedSessionId,
    sessionPage: selection.effectiveHistoryPage,
    setSessionScrollTop: viewport.setSessionScrollTop,
    sessionScrollTopRef: viewport.sessionScrollTopRef,
    pendingRestoredSessionScrollRef: viewport.pendingRestoredSessionScrollRef,
    refreshContextRef,
    pendingAutoScrollRef,
    prevMessageIdsRef,
    activeHistoryMessages: detailState.detailMessages,
    activeMessageSortDirection: sortState.activeMessageSortDirection,
    focusMessageId: viewport.focusMessageId,
    visibleFocusedMessageId: viewport.visibleFocusedMessageId,
    focusedMessagePosition: viewport.focusedMessagePosition,
    focusedMessageRef: viewport.focusedMessageRef,
    pendingMessageAreaFocus: viewport.pendingMessageAreaFocus,
    setPendingMessageAreaFocus: viewport.setPendingMessageAreaFocus,
    pendingMessagePageNavigation: viewport.pendingMessagePageNavigation,
    loadedHistoryPage: viewport.loadedHistoryPage,
    setPendingMessagePageNavigation: viewport.setPendingMessagePageNavigation,
    setFocusMessageId: viewport.setFocusMessageId,
    scrollPreservationRef,
  });

  const handleRefreshAllData = useCallback(
    async (source: "manual" | "auto" = "manual", options: { historyViewActive?: boolean } = {}) => {
      const container = viewport.messageListRef.current;
      const id = ++refreshIdCounterRef.current;
      const historyViewActive = options.historyViewActive ?? true;
      const refreshContext = buildRefreshContext({
        refreshId: id,
        container,
        selection,
        detailState,
        sortState,
      });
      const { updateSource, clearStartupWatchResort } = resolveStableRefreshSource(
        source,
        startupWatchResortPendingRef.current,
      );
      const consumeRefreshContext = async (target: HistoryRefreshTarget) => {
        if (target === null) {
          refreshContextRef.current = null;
          return;
        }
        refreshContextRef.current = refreshContext;
        if (target === "bookmarks") {
          await detailApi.loadBookmarks();
          return;
        }
        if (target === "session") {
          detailApi.requestSessionDetailRefresh();
          return;
        }
        if (target === "turn") {
          detailApi.requestTurnDetailRefresh();
          return;
        }
        detailApi.requestProjectCombinedDetailRefresh();
      };

      if (source === "manual") {
        const sharedLoads: Promise<unknown>[] = [
          catalog.loadProjects(updateSource),
          catalog.loadSessions(updateSource),
          catalog.refreshTreeProjectSessions(updateSource),
        ];
        if (selection.historyMode !== "bookmarks") {
          sharedLoads.push(detailApi.loadBookmarks());
        }
        await Promise.all(sharedLoads);
        if (clearStartupWatchResort) {
          startupWatchResortPendingRef.current = false;
        }
        const refreshTarget = getManualRefreshTarget({
          historyViewActive,
          selection,
        });
        await consumeRefreshContext(refreshTarget);
        return;
      }

      const previousProjectFingerprint = selectedProjectRefreshFingerprintRef.current;
      const previousSessionFingerprint = selectedSessionRefreshFingerprintRef.current;
      const nextProjects = await catalog.loadProjects(updateSource);
      if (clearStartupWatchResort) {
        startupWatchResortPendingRef.current = false;
      }
      const nextSelectedProject =
        nextProjects?.find((project) => project.id === selection.selectedProjectId) ?? null;
      const projectFingerprintChanged =
        previousProjectFingerprint.length > 0 &&
        nextSelectedProject !== null &&
        getProjectRefreshFingerprint(nextSelectedProject) !== previousProjectFingerprint;

      let sessionFingerprintChanged = false;
      if (historyViewActive && selection.selectedProjectId) {
        const nextSessions = await catalog.loadSessions(updateSource);
        const nextSelectedSession =
          nextSessions?.find((session) => session.id === selection.selectedSessionId) ?? null;
        sessionFingerprintChanged =
          previousSessionFingerprint.length > 0 &&
          nextSelectedSession !== null &&
          getSessionRefreshFingerprint(nextSelectedSession) !== previousSessionFingerprint;
      }

      const refreshTarget = getAutoRefreshTarget({
        historyViewActive,
        selection,
        projectFingerprintChanged,
        sessionFingerprintChanged,
      });
      await consumeRefreshContext(refreshTarget);

      if (
        shouldRefreshTreeSessions({
          historyViewActive,
          selection,
          treeProjectSessionsByProjectId: catalog.treeProjectSessionsByProjectIdRef.current,
        })
      ) {
        await catalog.refreshTreeProjectSessions(updateSource);
      }
    },
    [
      catalog,
      detailApi,
      detailState,
      refreshContextRef,
      selection,
      sortState,
      viewport.messageListRef,
    ],
  );

  return {
    handleRefreshAllData,
  };
}

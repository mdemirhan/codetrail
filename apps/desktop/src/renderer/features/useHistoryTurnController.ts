import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { IpcRequestInput, MessageCategory, SearchMode } from "@codetrail/core/browser";

import { CATEGORIES } from "../app/constants";
import { areHistorySelectionsEqual, createHistorySelection } from "../app/historySelection";
import type { HistoryMessage, HistorySelection, SessionTurnDetail } from "../app/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { shouldIgnoreAsyncEffectError } from "../lib/asyncEffectUtils";
import type { CodetrailClient } from "../lib/codetrailClient";
import { getTurnVisualizationSelection } from "./historyVisualization";
import { buildTurnCategoryCounts, buildTurnVisibleMessages } from "./turnViewModel";

function getTurnScopeKey(selection: HistorySelection): string {
  return `${selection.mode}:${selection.projectId}:${"sessionId" in selection ? (selection.sessionId ?? "") : ""}`;
}

function canRequestTurnScope(selection: HistorySelection): boolean {
  if (selection.mode === "session") {
    return selection.sessionId.length > 0;
  }
  return selection.projectId.length > 0;
}

const EMPTY_TURN_CATEGORY_COUNTS = {
  user: 0,
  assistant: 0,
  tool_use: 0,
  tool_edit: 0,
  tool_result: 0,
  thinking: 0,
  system: 0,
} as const;

const EMPTY_TURN_DETAIL: SessionTurnDetail = {
  session: null,
  anchorMessageId: null,
  anchorMessage: null,
  turnNumber: 0,
  totalTurns: 0,
  previousTurnAnchorMessageId: null,
  nextTurnAnchorMessageId: null,
  firstTurnAnchorMessageId: null,
  latestTurnAnchorMessageId: null,
  totalCount: 0,
  categoryCounts: EMPTY_TURN_CATEGORY_COUNTS,
  queryError: null,
  highlightPatterns: [],
  matchedMessageIds: undefined,
  messages: [],
};

function ensureCategoryVisible(
  currentCategories: MessageCategory[],
  targetCategory: MessageCategory,
): MessageCategory[] {
  if (currentCategories.includes(targetCategory)) {
    return currentCategories;
  }
  return CATEGORIES.filter(
    (category) => currentCategories.includes(category) || category === targetCategory,
  );
}

export function useHistoryTurnController({
  codetrail,
  logError,
  searchMode,
  historyDetailMode,
  currentUiHistorySelection,
  selectedProjectId,
  selectedSessionId,
  turnViewSortDirection,
  turnViewCategories,
  setTurnViewCategories,
  setTurnViewCombinedChangesExpandedOverride,
  setHistorySelectionImmediate,
  setHistoryVisualization,
  setFocusMessageId,
}: {
  codetrail: CodetrailClient;
  logError: (context: string, error: unknown) => void;
  searchMode: SearchMode;
  historyDetailMode: "flat" | "turn";
  currentUiHistorySelection: HistorySelection;
  selectedProjectId: string;
  selectedSessionId: string;
  turnViewSortDirection: "asc" | "desc";
  turnViewCategories: MessageCategory[];
  setTurnViewCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setTurnViewCombinedChangesExpandedOverride: Dispatch<SetStateAction<boolean | null>>;
  setHistorySelectionImmediate: Dispatch<SetStateAction<HistorySelection>>;
  setHistoryVisualization: Dispatch<SetStateAction<"messages" | "turns" | "bookmarks">>;
  setFocusMessageId: Dispatch<SetStateAction<string>>;
}) {
  const [turnQueryInput, setTurnQueryInput] = useState("");
  const [turnAnchorMessageId, setTurnAnchorMessageId] = useState("");
  const [turnSourceSessionId, setTurnSourceSessionId] = useState("");
  const [sessionTurnDetail, setSessionTurnDetail] = useState<SessionTurnDetail | null>(null);
  const [turnDetailRefreshNonce, setTurnDetailRefreshNonce] = useState(0);
  const turnScopeKeyRef = useRef("");
  const effectiveTurnQueryDebounced = useDebouncedValue(turnQueryInput, 400);
  const effectiveTurnQuery = turnQueryInput.trim().length === 0 ? "" : effectiveTurnQueryDebounced;

  const turnAnchorMessage = useMemo(() => {
    if (!sessionTurnDetail) {
      return null;
    }
    return (
      sessionTurnDetail.anchorMessage ??
      sessionTurnDetail.messages.find(
        (message) => message.id === sessionTurnDetail.anchorMessageId,
      ) ??
      null
    );
  }, [sessionTurnDetail]);

  const turnVisibleMessages = useMemo(
    () =>
      buildTurnVisibleMessages(
        sessionTurnDetail?.messages ?? [],
        turnAnchorMessage,
        turnViewCategories,
        sessionTurnDetail?.matchedMessageIds,
      ),
    [
      sessionTurnDetail?.matchedMessageIds,
      sessionTurnDetail?.messages,
      turnAnchorMessage,
      turnViewCategories,
    ],
  );

  const turnCategoryCounts = useMemo(
    () =>
      sessionTurnDetail?.categoryCounts ??
      buildTurnCategoryCounts(sessionTurnDetail?.messages ?? [], turnAnchorMessage),
    [sessionTurnDetail?.categoryCounts, sessionTurnDetail?.messages, turnAnchorMessage],
  );

  const turnTotalCount = sessionTurnDetail?.totalTurns ?? 0;
  const turnTotalPages = Math.max(1, turnTotalCount || 1);
  const turnDisplayPage = useMemo(() => {
    if (turnTotalCount === 0) {
      return 0;
    }
    const canonicalTurnNumber = Math.min(
      turnTotalPages,
      Math.max(1, sessionTurnDetail?.turnNumber ?? 1),
    );
    if (turnViewSortDirection === "desc") {
      return Math.max(0, turnTotalPages - canonicalTurnNumber);
    }
    return Math.max(0, canonicalTurnNumber - 1);
  }, [sessionTurnDetail?.turnNumber, turnTotalCount, turnTotalPages, turnViewSortDirection]);

  const turnVisualizationSelection = useMemo(
    () =>
      getTurnVisualizationSelection({
        selection: currentUiHistorySelection,
        selectedProjectId,
      }),
    [currentUiHistorySelection, selectedProjectId],
  );

  const canToggleTurnView =
    historyDetailMode === "turn"
      ? canRequestTurnScope(turnVisualizationSelection)
      : turnVisualizationSelection.mode === "session"
        ? Boolean(
            ("sessionId" in turnVisualizationSelection && turnVisualizationSelection.sessionId) ||
              selectedSessionId,
          )
        : Boolean(turnVisualizationSelection.projectId);

  const currentTurnScopeKey = useMemo(
    () => getTurnScopeKey(turnVisualizationSelection),
    [turnVisualizationSelection],
  );

  const clearTurnViewState = useCallback(() => {
    setTurnAnchorMessageId("");
    setTurnSourceSessionId("");
    setSessionTurnDetail(null);
    setTurnViewCombinedChangesExpandedOverride(null);
    turnScopeKeyRef.current = "";
  }, [setTurnViewCombinedChangesExpandedOverride]);

  const buildTurnScopeRequestBase = useCallback(
    (selectionState: HistorySelection) => ({
      scopeMode: selectionState.mode,
      ...(selectionState.projectId ? { projectId: selectionState.projectId } : {}),
      ...(selectionState.mode === "session" ? { sessionId: selectionState.sessionId } : {}),
    }),
    [],
  );

  const loadTurnDetail = useCallback(
    async (
      request: Pick<
        IpcRequestInput<"sessions:getTurn">,
        "sessionId" | "anchorMessageId" | "turnNumber" | "latest"
      >,
      options: {
        queryOverride?: string;
        scopeSelection?: HistorySelection;
      } = {},
    ) => {
      const scopeSelection = options.scopeSelection ?? turnVisualizationSelection;
      if (!canRequestTurnScope(scopeSelection)) {
        return EMPTY_TURN_DETAIL;
      }
      return codetrail.invoke("sessions:getTurn", {
        ...buildTurnScopeRequestBase(scopeSelection),
        ...request,
        query: options.queryOverride ?? effectiveTurnQuery,
        searchMode,
        sortDirection: turnViewSortDirection,
      });
    },
    [
      buildTurnScopeRequestBase,
      codetrail,
      effectiveTurnQuery,
      searchMode,
      turnViewSortDirection,
      turnVisualizationSelection,
    ],
  );

  const loadResolvedTurnDetail = useCallback(
    async (
      request: Pick<
        IpcRequestInput<"sessions:getTurn">,
        "sessionId" | "anchorMessageId" | "turnNumber" | "latest"
      >,
      options: {
        queryOverride?: string;
        scopeSelection?: HistorySelection;
      } = {},
    ) => {
      const response = await loadTurnDetail(request, options);
      if (response.totalTurns === 0 || response.turnNumber > 0) {
        return response;
      }

      const fallbackRequest =
        turnViewSortDirection === "desc" ? { latest: true } : { turnNumber: 1 as const };
      const requestedTurnNumber =
        typeof request.turnNumber === "number" ? request.turnNumber : null;
      if (
        (fallbackRequest.latest === true && request.latest === true) ||
        (requestedTurnNumber !== null && requestedTurnNumber === fallbackRequest.turnNumber)
      ) {
        return response;
      }
      return loadTurnDetail(fallbackRequest, options);
    },
    [loadTurnDetail, turnViewSortDirection],
  );

  const requestTurnDetailRefresh = useCallback(() => {
    setTurnDetailRefreshNonce((value) => value + 1);
  }, []);

  const ensureTurnCategoryVisible = useCallback(
    (category: MessageCategory) => {
      setTurnViewCategories((currentCategories) =>
        ensureCategoryVisible(currentCategories, category),
      );
    },
    [setTurnViewCategories],
  );

  const navigateToTurn = useCallback(
    async (
      request: Pick<
        IpcRequestInput<"sessions:getTurn">,
        "anchorMessageId" | "turnNumber" | "latest"
      >,
      options: { queryOverride?: string } = {},
    ) => {
      try {
        const response = await loadResolvedTurnDetail(request, options);
        setSessionTurnDetail(response);
        setTurnAnchorMessageId(response.anchorMessageId ?? "");
        setTurnSourceSessionId(response.session?.id ?? "");
        return response;
      } catch (error) {
        logError("Failed loading session turn", error);
        return null;
      }
    },
    [loadResolvedTurnDetail, logError],
  );

  const handleRevealInTurn = useCallback(
    (message: HistoryMessage) => {
      if (!selectedProjectId) {
        return;
      }
      ensureTurnCategoryVisible(message.category);
      const nextSelection =
        turnVisualizationSelection.mode === "session"
          ? createHistorySelection(
              "session",
              turnVisualizationSelection.projectId,
              message.sessionId,
            )
          : createHistorySelection("project_all", turnVisualizationSelection.projectId);
      if (!areHistorySelectionsEqual(currentUiHistorySelection, nextSelection)) {
        setHistorySelectionImmediate(nextSelection);
      }
      setHistoryVisualization("turns");
      setTurnAnchorMessageId(message.id);
      setTurnSourceSessionId(message.sessionId);
      setTurnQueryInput("");
      setSessionTurnDetail(null);
      setFocusMessageId(message.id);
    },
    [
      currentUiHistorySelection,
      ensureTurnCategoryVisible,
      selectedProjectId,
      setFocusMessageId,
      setHistorySelectionImmediate,
      setHistoryVisualization,
      turnVisualizationSelection,
    ],
  );

  const handleSelectMessagesView = useCallback(() => {
    setHistoryVisualization("messages");
  }, [setHistoryVisualization]);

  const handleSelectTurnsView = useCallback(async () => {
    if (historyDetailMode === "turn" || !canToggleTurnView) {
      return;
    }
    if (!areHistorySelectionsEqual(currentUiHistorySelection, turnVisualizationSelection)) {
      setHistorySelectionImmediate(turnVisualizationSelection);
    }
    setHistoryVisualization("turns");
    setFocusMessageId("");
  }, [
    canToggleTurnView,
    currentUiHistorySelection,
    historyDetailMode,
    setFocusMessageId,
    setHistorySelectionImmediate,
    setHistoryVisualization,
    turnVisualizationSelection,
  ]);

  const handleToggleTurnView = useCallback(async () => {
    if (historyDetailMode === "turn") {
      handleSelectMessagesView();
      return;
    }
    await handleSelectTurnsView();
  }, [handleSelectMessagesView, handleSelectTurnsView, historyDetailMode]);

  useEffect(() => {
    if (turnScopeKeyRef.current === "" && historyDetailMode === "turn") {
      turnScopeKeyRef.current = currentTurnScopeKey;
      return;
    }
    if (turnScopeKeyRef.current === "" || turnScopeKeyRef.current === currentTurnScopeKey) {
      return;
    }
    clearTurnViewState();
    setFocusMessageId("");
  }, [clearTurnViewState, currentTurnScopeKey, historyDetailMode, setFocusMessageId]);

  useEffect(() => {
    if (historyDetailMode !== "turn" || !canToggleTurnView) {
      setSessionTurnDetail(null);
      if (!canToggleTurnView) {
        setTurnAnchorMessageId("");
        setTurnSourceSessionId("");
      }
      return;
    }

    void turnDetailRefreshNonce;
    let cancelled = false;
    const request =
      turnAnchorMessageId.length > 0
        ? { anchorMessageId: turnAnchorMessageId }
        : turnViewSortDirection === "desc"
          ? { latest: true }
          : { turnNumber: 1 };
    void loadResolvedTurnDetail(request)
      .then((response) => {
        if (!cancelled) {
          setSessionTurnDetail(response);
          setTurnAnchorMessageId(response.anchorMessageId ?? "");
          setTurnSourceSessionId(response.session?.id ?? "");
        }
      })
      .catch((error: unknown) => {
        if (!shouldIgnoreAsyncEffectError(cancelled, error)) {
          logError("Failed loading session turn", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    canToggleTurnView,
    historyDetailMode,
    loadResolvedTurnDetail,
    logError,
    turnAnchorMessageId,
    turnDetailRefreshNonce,
    turnViewSortDirection,
  ]);

  const goToPreviousTurn = useCallback(async () => {
    const targetAnchorMessageId =
      turnViewSortDirection === "desc"
        ? sessionTurnDetail?.nextTurnAnchorMessageId
        : sessionTurnDetail?.previousTurnAnchorMessageId;
    if (!targetAnchorMessageId) {
      return;
    }
    await navigateToTurn({ anchorMessageId: targetAnchorMessageId });
  }, [
    navigateToTurn,
    sessionTurnDetail?.nextTurnAnchorMessageId,
    sessionTurnDetail?.previousTurnAnchorMessageId,
    turnViewSortDirection,
  ]);

  const goToNextTurn = useCallback(async () => {
    const targetAnchorMessageId =
      turnViewSortDirection === "desc"
        ? sessionTurnDetail?.previousTurnAnchorMessageId
        : sessionTurnDetail?.nextTurnAnchorMessageId;
    if (!targetAnchorMessageId) {
      return;
    }
    await navigateToTurn({ anchorMessageId: targetAnchorMessageId });
  }, [
    navigateToTurn,
    sessionTurnDetail?.nextTurnAnchorMessageId,
    sessionTurnDetail?.previousTurnAnchorMessageId,
    turnViewSortDirection,
  ]);

  const goToFirstTurn = useCallback(async () => {
    const targetAnchorMessageId =
      turnViewSortDirection === "desc"
        ? sessionTurnDetail?.latestTurnAnchorMessageId
        : sessionTurnDetail?.firstTurnAnchorMessageId;
    if (!targetAnchorMessageId) {
      return;
    }
    await navigateToTurn({ anchorMessageId: targetAnchorMessageId });
  }, [
    navigateToTurn,
    sessionTurnDetail?.firstTurnAnchorMessageId,
    sessionTurnDetail?.latestTurnAnchorMessageId,
    turnViewSortDirection,
  ]);

  const goToLatestTurn = useCallback(async () => {
    const targetAnchorMessageId =
      turnViewSortDirection === "desc"
        ? sessionTurnDetail?.firstTurnAnchorMessageId
        : sessionTurnDetail?.latestTurnAnchorMessageId;
    if (!targetAnchorMessageId) {
      return;
    }
    await navigateToTurn({ anchorMessageId: targetAnchorMessageId });
  }, [
    navigateToTurn,
    sessionTurnDetail?.firstTurnAnchorMessageId,
    sessionTurnDetail?.latestTurnAnchorMessageId,
    turnViewSortDirection,
  ]);

  const goToTurnNumber = useCallback(
    async (page: number, goToHistoryPage: (page: number) => void) => {
      if (historyDetailMode !== "turn") {
        goToHistoryPage(page);
        return;
      }
      const displayPageNumber = Math.max(1, Math.min(turnTotalPages, Math.trunc(page) + 1));
      const targetTurnNumber =
        turnViewSortDirection === "desc"
          ? turnTotalPages - displayPageNumber + 1
          : displayPageNumber;
      await navigateToTurn({ turnNumber: targetTurnNumber });
    },
    [historyDetailMode, navigateToTurn, turnTotalPages, turnViewSortDirection],
  );

  return {
    turnQueryInput,
    setTurnQueryInput,
    effectiveTurnQuery,
    turnAnchorMessageId,
    turnSourceSessionId,
    sessionTurnDetail,
    turnAnchorMessage,
    turnVisibleMessages,
    turnCategoryCounts,
    turnDisplayPage,
    turnTotalPages,
    turnVisualizationSelection,
    currentTurnScopeKey,
    canToggleTurnView,
    clearTurnViewState,
    requestTurnDetailRefresh,
    handleRevealInTurn,
    handleSelectMessagesView,
    handleSelectTurnsView,
    handleToggleTurnView,
    goToPreviousTurn,
    goToNextTurn,
    goToFirstTurn,
    goToLatestTurn,
    goToTurnNumber,
  };
}

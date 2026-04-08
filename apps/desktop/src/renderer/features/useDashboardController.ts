import { useCallback, useEffect, useRef, useState } from "react";

import { EMPTY_CATEGORY_COUNTS, EMPTY_PROVIDER_COUNTS } from "../app/constants";
import type { DashboardStatsResponse, MainView } from "../app/types";
import { useCodetrailClient } from "../lib/codetrailClient";
import { toErrorMessage } from "../lib/viewUtils";

const EMPTY_DASHBOARD_STATS: DashboardStatsResponse = {
  summary: {
    projectCount: 0,
    sessionCount: 0,
    messageCount: 0,
    bookmarkCount: 0,
    toolCallCount: 0,
    indexedFileCount: 0,
    indexedBytesTotal: 0,
    tokenInputTotal: 0,
    tokenOutputTotal: 0,
    totalDurationMs: 0,
    averageMessagesPerSession: 0,
    averageSessionDurationMs: 0,
    activeProviderCount: 0,
  },
  categoryCounts: EMPTY_CATEGORY_COUNTS,
  providerCounts: EMPTY_PROVIDER_COUNTS,
  providerStats: [],
  recentActivity: [],
  topProjects: [],
  topModels: [],
  aiCodeStats: {
    summary: {
      writeEventCount: 0,
      measurableWriteEventCount: 0,
      writeSessionCount: 0,
      fileChangeCount: 0,
      distinctFilesTouchedCount: 0,
      linesAdded: 0,
      linesDeleted: 0,
      netLines: 0,
      multiFileWriteCount: 0,
      averageFilesPerWrite: 0,
    },
    changeTypeCounts: {
      add: 0,
      update: 0,
      delete: 0,
      move: 0,
    },
    providerStats: [],
    recentActivity: [],
    topFiles: [],
    topFileTypes: [],
  },
  activityWindowDays: 14,
};

export function useDashboardController({
  mainView,
  logError,
}: {
  mainView: MainView;
  logError: (context: string, error: unknown) => void;
}) {
  const codetrail = useCodetrailClient();
  const dashboardLoadTokenRef = useRef(0);
  const [stats, setStats] = useState<DashboardStatsResponse>(EMPTY_DASHBOARD_STATS);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadStats = useCallback(async () => {
    const requestToken = dashboardLoadTokenRef.current + 1;
    dashboardLoadTokenRef.current = requestToken;
    setLoading(true);
    setError(null);
    try {
      const response = await codetrail.invoke("dashboard:getStats", {});
      if (requestToken !== dashboardLoadTokenRef.current) {
        return;
      }
      setStats(response);
      setLoaded(true);
      setError(null);
    } catch (loadError) {
      if (requestToken !== dashboardLoadTokenRef.current) {
        return;
      }
      logError("Dashboard stats refresh failed", loadError);
      setError(toErrorMessage(loadError));
    } finally {
      if (requestToken === dashboardLoadTokenRef.current) {
        setLoading(false);
      }
    }
  }, [codetrail, logError]);

  useEffect(() => {
    if (mainView !== "dashboard") {
      return;
    }
    void reloadStats();
  }, [mainView, reloadStats]);

  return {
    stats,
    loading,
    loaded,
    error,
    reloadStats,
  };
}

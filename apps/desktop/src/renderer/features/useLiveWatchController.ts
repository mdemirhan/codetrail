import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { isWatchRefreshStrategy } from "../app/autoRefresh";
import type { RefreshStrategy } from "../app/autoRefresh";
import { EMPTY_PROVIDER_COUNTS } from "../app/constants";
import type { MainView, WatchLiveStatusResponse } from "../app/types";
import type { CodetrailClient } from "../lib/codetrailClient";
import { toErrorMessage } from "../lib/viewUtils";

const IS_TEST_ENV =
  typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom");
const LIVE_STATUS_ACTIVE_POLL_MS = IS_TEST_ENV ? 0 : 3_000;
const LIVE_STATUS_IDLE_POLL_MS = IS_TEST_ENV ? 0 : 10_000;
const LIVE_STATUS_HIDDEN_POLL_MS = IS_TEST_ENV ? 0 : 15_000;
export const LIVE_STATUS_PUSH_DEBOUNCE_MS = 200;

export function resolveLiveStatusPollMs(input: {
  documentVisible: boolean;
  mainView: MainView;
}): number {
  if (!input.documentVisible) {
    return LIVE_STATUS_HIDDEN_POLL_MS;
  }
  return input.mainView === "settings" ? LIVE_STATUS_ACTIVE_POLL_MS : LIVE_STATUS_IDLE_POLL_MS;
}

export function useLiveWatchController({
  codetrail,
  mainView,
  refreshStrategy,
  liveWatchEnabled,
  claudeEnabled,
  claudeHooksPrompted,
  logError,
}: {
  codetrail: Pick<CodetrailClient, "invoke" | "onLiveStatusChanged">;
  mainView: MainView;
  refreshStrategy: RefreshStrategy;
  liveWatchEnabled: boolean;
  claudeEnabled: boolean;
  claudeHooksPrompted: boolean;
  logError: (context: string, error: unknown) => void;
}) {
  const [liveStatus, setLiveStatus] = useState<WatchLiveStatusResponse | null>(null);
  const [liveStatusError, setLiveStatusError] = useState<string | null>(null);
  const [claudeHookActionPending, setClaudeHookActionPending] = useState<
    "install" | "remove" | null
  >(null);
  const [showClaudeHooksPrompt, setShowClaudeHooksPrompt] = useState(false);

  const liveWatchActive = isWatchRefreshStrategy(refreshStrategy) && liveWatchEnabled;
  const liveStatusVisible = mainView === "history" || mainView === "settings";
  const settingsViewOpen = mainView === "settings";
  const settingsRefreshKey = `${mainView}:${refreshStrategy}:${liveWatchEnabled ? "1" : "0"}:${
    claudeEnabled ? "1" : "0"
  }`;
  const settingsRefreshTarget = settingsViewOpen && !liveWatchActive ? settingsRefreshKey : null;

  const loadLiveStatus = useCallback(async (): Promise<WatchLiveStatusResponse | null> => {
    try {
      const response = await codetrail.invoke("watcher:getLiveStatus", {});
      setLiveStatus((current) => {
        if (current?.revision === response.revision) {
          return current;
        }
        return response;
      });
      setLiveStatusError(null);
      return response;
    } catch (error) {
      setLiveStatusError(toErrorMessage(error));
      return null;
    }
  }, [codetrail]);

  useEffect(() => {
    if (!liveWatchActive || !liveStatusVisible) {
      return;
    }

    void loadLiveStatus();
    let cancelled = false;
    let timeoutId: number | null = null;

    const getPollMs = () => {
      return resolveLiveStatusPollMs({
        documentVisible:
          typeof document === "undefined" ? true : document.visibilityState === "visible",
        mainView,
      });
    };

    const scheduleNextPoll = () => {
      const pollMs = getPollMs();
      if (cancelled || pollMs <= 0) {
        return;
      }
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        void loadLiveStatus().finally(() => {
          scheduleNextPoll();
        });
      }, pollMs);
    };

    scheduleNextPoll();

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void loadLiveStatus();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [liveStatusVisible, liveWatchActive, loadLiveStatus, mainView]);

  const loadLiveStatusRef = useRef(loadLiveStatus);
  loadLiveStatusRef.current = loadLiveStatus;

  useEffect(() => {
    if (!liveWatchActive || !liveStatusVisible) {
      return;
    }

    const debounceMs = LIVE_STATUS_PUSH_DEBOUNCE_MS;
    let timerId: number | null = null;

    const unsubscribe = codetrail.onLiveStatusChanged(() => {
      if (timerId !== null) {
        return;
      }
      if (debounceMs <= 0) {
        void loadLiveStatusRef.current();
        return;
      }
      timerId = window.setTimeout(() => {
        timerId = null;
        void loadLiveStatusRef.current();
      }, debounceMs);
    });

    return () => {
      unsubscribe();
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [codetrail, liveWatchActive, liveStatusVisible]);

  useEffect(() => {
    if (!settingsRefreshTarget) {
      return;
    }
    void loadLiveStatus();
  }, [loadLiveStatus, settingsRefreshTarget]);

  useEffect(() => {
    if (
      !liveWatchActive ||
      !claudeEnabled ||
      claudeHooksPrompted ||
      !liveStatus ||
      liveStatus.claudeHookState.installed
    ) {
      return;
    }
    setShowClaudeHooksPrompt(true);
  }, [claudeEnabled, claudeHooksPrompted, liveStatus, liveWatchActive]);

  const installClaudeHooks = useCallback(async () => {
    if (claudeHookActionPending) {
      return;
    }
    setClaudeHookActionPending("install");
    try {
      const response = await codetrail.invoke("claudeHooks:install", {});
      updateClaudeHookState(setLiveStatus, response.state);
      setLiveStatusError(null);
    } catch (error) {
      logError("Failed installing Claude hooks", error);
    } finally {
      setClaudeHookActionPending(null);
    }
  }, [claudeHookActionPending, codetrail, logError]);

  const removeClaudeHooks = useCallback(async () => {
    if (claudeHookActionPending) {
      return;
    }
    setClaudeHookActionPending("remove");
    try {
      const response = await codetrail.invoke("claudeHooks:remove", {});
      updateClaudeHookState(setLiveStatus, response.state);
      setLiveStatusError(null);
    } catch (error) {
      logError("Failed removing Claude hooks", error);
    } finally {
      setClaudeHookActionPending(null);
    }
  }, [claudeHookActionPending, codetrail, logError]);

  return {
    liveStatus,
    liveStatusError,
    liveWatchActive,
    refreshLiveStatus: loadLiveStatus,
    claudeHookActionPending,
    showClaudeHooksPrompt,
    setShowClaudeHooksPrompt,
    installClaudeHooks,
    removeClaudeHooks,
  };
}

function updateClaudeHookState(
  setLiveStatus: Dispatch<SetStateAction<WatchLiveStatusResponse | null>>,
  claudeHookState: WatchLiveStatusResponse["claudeHookState"],
): void {
  setLiveStatus((current) => {
    const nextRevision = (current?.revision ?? 0) + 1;
    return {
      enabled: current?.enabled ?? false,
      instrumentationEnabled: current?.instrumentationEnabled ?? false,
      updatedAt: new Date().toISOString(),
      providerCounts: current?.providerCounts ?? EMPTY_PROVIDER_COUNTS,
      sessions: current?.sessions ?? [],
      revision: nextRevision,
      claudeHookState,
    };
  });
}

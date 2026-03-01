import { useEffect, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { MessageCategory, Provider } from "@codetrail/core";

import type {
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ThemeMode,
} from "../../shared/uiPreferences";
import { useCodetrailClient } from "../lib/codetrailClient";
import { clamp } from "../lib/viewUtils";

type RestoredScrollTarget = {
  sessionId: string;
  sessionPage: number;
  scrollTop: number;
};

type HistoryMode = "session" | "bookmarks" | "project_all";
type SystemMessageRegexRules = Record<Provider, string[]>;

export function usePaneStateSync(args: {
  logError: (context: string, error: unknown) => void;
  projectPaneWidth: number;
  sessionPaneWidth: number;
  projectProviders: Provider[];
  historyCategories: MessageCategory[];
  expandedByDefaultCategories: MessageCategory[];
  searchProviders: Provider[];
  theme: ThemeMode;
  monoFontFamily: MonoFontFamily;
  regularFontFamily: RegularFontFamily;
  monoFontSize: MonoFontSize;
  regularFontSize: RegularFontSize;
  useMonospaceForAllMessages: boolean;
  selectedProjectId: string;
  selectedSessionId: string;
  historyMode: HistoryMode;
  sessionPage: number;
  sessionScrollTop: number;
  systemMessageRegexRules: SystemMessageRegexRules;
  setProjectPaneWidth: Dispatch<SetStateAction<number>>;
  setSessionPaneWidth: Dispatch<SetStateAction<number>>;
  setProjectProviders: Dispatch<SetStateAction<Provider[]>>;
  setHistoryCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setExpandedByDefaultCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  setSearchProviders: Dispatch<SetStateAction<Provider[]>>;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  setMonoFontFamily: Dispatch<SetStateAction<MonoFontFamily>>;
  setRegularFontFamily: Dispatch<SetStateAction<RegularFontFamily>>;
  setMonoFontSize: Dispatch<SetStateAction<MonoFontSize>>;
  setRegularFontSize: Dispatch<SetStateAction<RegularFontSize>>;
  setUseMonospaceForAllMessages: Dispatch<SetStateAction<boolean>>;
  setSelectedProjectId: Dispatch<SetStateAction<string>>;
  setSelectedSessionId: Dispatch<SetStateAction<string>>;
  setHistoryMode: Dispatch<SetStateAction<HistoryMode>>;
  setSessionPage: Dispatch<SetStateAction<number>>;
  setSessionScrollTop: Dispatch<SetStateAction<number>>;
  setSystemMessageRegexRules: Dispatch<SetStateAction<SystemMessageRegexRules>>;
  sessionScrollTopRef: MutableRefObject<number>;
  pendingRestoredSessionScrollRef: MutableRefObject<RestoredScrollTarget | null>;
}): { paneStateHydrated: boolean } {
  const {
    logError,
    projectPaneWidth,
    sessionPaneWidth,
    projectProviders,
    historyCategories,
    expandedByDefaultCategories,
    searchProviders,
    theme,
    monoFontFamily,
    regularFontFamily,
    monoFontSize,
    regularFontSize,
    useMonospaceForAllMessages,
    selectedProjectId,
    selectedSessionId,
    historyMode,
    sessionPage,
    sessionScrollTop,
    systemMessageRegexRules,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectProviders,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setSearchProviders,
    setTheme,
    setMonoFontFamily,
    setRegularFontFamily,
    setMonoFontSize,
    setRegularFontSize,
    setUseMonospaceForAllMessages,
    setSelectedProjectId,
    setSelectedSessionId,
    setHistoryMode,
    setSessionPage,
    setSessionScrollTop,
    setSystemMessageRegexRules,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  } = args;
  const codetrail = useCodetrailClient();
  const [paneStateHydrated, setPaneStateHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
        if (response.projectProviders !== null) {
          setProjectProviders(response.projectProviders);
        }
        if (response.historyCategories !== null) {
          setHistoryCategories(response.historyCategories);
        }
        if (response.expandedByDefaultCategories !== null) {
          setExpandedByDefaultCategories(response.expandedByDefaultCategories);
        }
        if (response.searchProviders !== null) {
          setSearchProviders(response.searchProviders);
        }
        if (response.theme !== null) {
          setTheme(response.theme);
        }
        if (response.monoFontFamily !== null) {
          setMonoFontFamily(response.monoFontFamily);
        }
        if (response.regularFontFamily !== null) {
          setRegularFontFamily(response.regularFontFamily);
        }
        if (response.monoFontSize !== null) {
          setMonoFontSize(response.monoFontSize);
        }
        if (response.regularFontSize !== null) {
          setRegularFontSize(response.regularFontSize);
        }
        if (response.useMonospaceForAllMessages !== null) {
          setUseMonospaceForAllMessages(response.useMonospaceForAllMessages);
        }
        if (response.selectedProjectId !== null) {
          setSelectedProjectId(response.selectedProjectId);
        }
        if (response.selectedSessionId !== null) {
          setSelectedSessionId(response.selectedSessionId);
        }
        if (response.historyMode !== null) {
          setHistoryMode(response.historyMode);
        }
        if (response.sessionPage !== null) {
          setSessionPage(response.sessionPage);
        }
        if (response.sessionScrollTop !== null) {
          sessionScrollTopRef.current = response.sessionScrollTop;
          setSessionScrollTop(response.sessionScrollTop);
        }
        if (response.systemMessageRegexRules !== null) {
          setSystemMessageRegexRules(response.systemMessageRegexRules);
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
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading UI state", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPaneStateHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    codetrail,
    logError,
    pendingRestoredSessionScrollRef,
    sessionScrollTopRef,
    setHistoryCategories,
    setProjectPaneWidth,
    setProjectProviders,
    setExpandedByDefaultCategories,
    setSearchProviders,
    setSelectedProjectId,
    setSelectedSessionId,
    setHistoryMode,
    setSessionPage,
    setSessionPaneWidth,
    setSessionScrollTop,
    setSystemMessageRegexRules,
    setTheme,
    setMonoFontFamily,
    setRegularFontFamily,
    setMonoFontSize,
    setRegularFontSize,
    setUseMonospaceForAllMessages,
  ]);

  useEffect(() => {
    if (!paneStateHydrated) {
      return;
    }

    const timer = window.setTimeout(() => {
      void codetrail
        .invoke("ui:setState", {
          projectPaneWidth: Math.round(projectPaneWidth),
          sessionPaneWidth: Math.round(sessionPaneWidth),
          projectProviders,
          historyCategories,
          expandedByDefaultCategories,
          searchProviders,
          theme,
          monoFontFamily,
          regularFontFamily,
          monoFontSize,
          regularFontSize,
          useMonospaceForAllMessages,
          selectedProjectId,
          selectedSessionId,
          historyMode,
          sessionPage,
          sessionScrollTop,
          systemMessageRegexRules,
        })
        .catch((error: unknown) => {
          logError("Failed saving UI state", error);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    codetrail,
    historyCategories,
    logError,
    paneStateHydrated,
    projectPaneWidth,
    projectProviders,
    expandedByDefaultCategories,
    searchProviders,
    monoFontFamily,
    regularFontFamily,
    monoFontSize,
    regularFontSize,
    useMonospaceForAllMessages,
    selectedProjectId,
    selectedSessionId,
    historyMode,
    sessionPage,
    sessionScrollTop,
    systemMessageRegexRules,
    sessionPaneWidth,
    theme,
  ]);

  return { paneStateHydrated };
}

// @vitest-environment jsdom

import { useRef, useState } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MessageCategory, Provider } from "@codetrail/core";

import type {
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ThemeMode,
} from "../../shared/uiPreferences";
import { createMockCodetrailClient } from "../test/mockCodetrailClient";
import { renderWithClient } from "../test/renderWithClient";
import { usePaneStateSync } from "./usePaneStateSync";

function Harness({ logError }: { logError: (context: string, error: unknown) => void }) {
  const [projectPaneWidth, setProjectPaneWidth] = useState(280);
  const [sessionPaneWidth, setSessionPaneWidth] = useState(300);
  const [projectProviders, setProjectProviders] = useState<Provider[]>(["claude"]);
  const [historyCategories, setHistoryCategories] = useState<MessageCategory[]>(["assistant"]);
  const [expandedByDefaultCategories, setExpandedByDefaultCategories] = useState<MessageCategory[]>(
    ["assistant"],
  );
  const [searchProviders, setSearchProviders] = useState<Provider[]>(["claude"]);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [monoFontFamily, setMonoFontFamily] = useState<MonoFontFamily>("droid_sans_mono");
  const [regularFontFamily, setRegularFontFamily] = useState<RegularFontFamily>("current");
  const [monoFontSize, setMonoFontSize] = useState<MonoFontSize>("12px");
  const [regularFontSize, setRegularFontSize] = useState<RegularFontSize>("13.5px");
  const [useMonospaceForAllMessages, setUseMonospaceForAllMessages] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [historyMode, setHistoryMode] = useState<"session" | "bookmarks" | "project_all">(
    "session",
  );
  const [projectSortDirection, setProjectSortDirection] = useState<"asc" | "desc">("desc");
  const [sessionSortDirection, setSessionSortDirection] = useState<"asc" | "desc">("desc");
  const [messageSortDirection, setMessageSortDirection] = useState<"asc" | "desc">("asc");
  const [bookmarkSortDirection, setBookmarkSortDirection] = useState<"asc" | "desc">("asc");
  const [projectAllSortDirection, setProjectAllSortDirection] = useState<"asc" | "desc">("desc");
  const [sessionPage, setSessionPage] = useState(0);
  const [sessionScrollTop, setSessionScrollTop] = useState(0);
  const [systemMessageRegexRules, setSystemMessageRegexRules] = useState<
    Record<Provider, string[]>
  >({
    claude: [],
    codex: [],
    gemini: [],
  });
  const sessionScrollTopRef = useRef(0);
  const pendingRestoredSessionScrollRef = useRef<{
    sessionId: string;
    sessionPage: number;
    scrollTop: number;
  } | null>(null);

  const { paneStateHydrated } = usePaneStateSync({
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
    projectSortDirection,
    sessionSortDirection,
    messageSortDirection,
    bookmarkSortDirection,
    projectAllSortDirection,
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
  });

  return (
    <div>
      <div data-testid="hydrated">{paneStateHydrated ? "yes" : "no"}</div>
      <div data-testid="project-width">{projectPaneWidth}</div>
      <div data-testid="history-mode">{historyMode}</div>
      <div data-testid="scroll">{sessionScrollTop}</div>
    </div>
  );
}

describe("usePaneStateSync", () => {
  it("hydrates state from ui:getState and persists updates via ui:setState", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockImplementation(async (channel) => {
      if (channel === "ui:getState") {
        return {
          projectPaneWidth: 340,
          sessionPaneWidth: 410,
          projectProviders: ["claude", "codex"],
          historyCategories: ["assistant", "user"],
          expandedByDefaultCategories: ["assistant"],
          searchProviders: ["claude"],
          theme: "dark",
          monoFontFamily: "droid_sans_mono",
          regularFontFamily: "inter",
          monoFontSize: "13px",
          regularFontSize: "14px",
          useMonospaceForAllMessages: true,
          selectedProjectId: "project_1",
          selectedSessionId: "session_1",
          historyMode: "bookmarks",
          projectSortDirection: "desc",
          sessionSortDirection: "desc",
          messageSortDirection: "asc",
          bookmarkSortDirection: "asc",
          projectAllSortDirection: "desc",
          sessionPage: 2,
          sessionScrollTop: 222,
          systemMessageRegexRules: {
            claude: ["^<command-name>"],
            codex: ["^<environment_context>"],
            gemini: [],
          },
        };
      }
      return { ok: true };
    });

    const logError = vi.fn();
    renderWithClient(<Harness logError={logError} />, client);

    await waitFor(() => {
      expect(screen.getByTestId("hydrated").textContent).toBe("yes");
    });

    expect(screen.getByTestId("project-width").textContent).toBe("340");
    expect(screen.getByTestId("history-mode").textContent).toBe("bookmarks");
    expect(screen.getByTestId("scroll").textContent).toBe("222");

    await new Promise((resolve) => window.setTimeout(resolve, 220));

    const saveCalls = client.invoke.mock.calls.filter(([channel]) => channel === "ui:setState");
    expect(saveCalls.length).toBeGreaterThan(0);
    const lastSavePayload = saveCalls.at(-1)?.[1];
    expect(lastSavePayload).toMatchObject({
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
      },
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it("logs errors when ui:getState fails", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockImplementation(async (channel) => {
      if (channel === "ui:getState") {
        throw new Error("load failed");
      }
      return { ok: true };
    });

    const logError = vi.fn();
    renderWithClient(<Harness logError={logError} />, client);

    await waitFor(() => {
      expect(screen.getByTestId("hydrated").textContent).toBe("yes");
    });

    expect(logError).toHaveBeenCalledWith("Failed loading UI state", expect.any(Error));
  });
});

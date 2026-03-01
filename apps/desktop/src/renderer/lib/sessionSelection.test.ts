import { describe, expect, it } from "vitest";

import { decideSessionSelectionAfterLoad } from "./sessionSelection";

describe("decideSessionSelectionAfterLoad", () => {
  it("does not override restored selection before pane state hydration", () => {
    const decision = decideSessionSelectionAfterLoad({
      paneStateHydrated: false,
      sessionsLoadedProjectId: "project_1",
      selectedProjectId: "project_1",
      hasPendingSearchNavigation: false,
      selectedSessionId: "session_restored",
      sortedSessions: [{ id: "session_top" }, { id: "session_restored" }],
    });

    expect(decision).toBeNull();
  });

  it("falls back to first session and resets page after hydration when selection is invalid", () => {
    const decision = decideSessionSelectionAfterLoad({
      paneStateHydrated: true,
      sessionsLoadedProjectId: "project_1",
      selectedProjectId: "project_1",
      hasPendingSearchNavigation: false,
      selectedSessionId: "session_missing",
      sortedSessions: [{ id: "session_top" }, { id: "session_other" }],
    });

    expect(decision).toEqual({
      nextSelectedSessionId: "session_top",
      resetPage: true,
    });
  });

  it("clears stale selection when the project has no sessions", () => {
    const decision = decideSessionSelectionAfterLoad({
      paneStateHydrated: true,
      sessionsLoadedProjectId: "project_1",
      selectedProjectId: "project_1",
      hasPendingSearchNavigation: false,
      selectedSessionId: "session_stale",
      sortedSessions: [],
    });

    expect(decision).toEqual({
      nextSelectedSessionId: "",
      resetPage: false,
    });
  });
});

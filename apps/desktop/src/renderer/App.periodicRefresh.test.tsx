// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, setTestStrategyIntervalOverrides } from "./App";
import { createAppClient } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

const FAST_OVERRIDES = { "5s": 100, "10s": 200, "30s": 300, "1min": 400, "5min": 500, watch: 600, off: 0 } as const;

describe("App periodic refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setTestStrategyIntervalOverrides(FAST_OVERRIDES);
  });

  afterEach(() => {
    setTestStrategyIntervalOverrides(null);
    vi.useRealTimers();
  });

  it("fires incremental refresh repeatedly on each interval tick", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    const refreshCallsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    // Select 5s (mapped to 20ms via override)
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("option", { name: "5s" }));

    await vi.advanceTimersByTimeAsync(110);
    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsBefore);
    });

    const refreshCallsAfterFirst = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await vi.advanceTimersByTimeAsync(110);
    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsAfterFirst);
    });
  });

  it("stops periodic refresh when set back to Off", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("option", { name: "5s" }));

    await vi.advanceTimersByTimeAsync(110);

    const refreshCallsBeforeOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("option", { name: "Off" }));

    await vi.advanceTimersByTimeAsync(500);

    const refreshCallsAfterOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;
    expect(refreshCallsAfterOff).toBe(refreshCallsBeforeOff);
  });
});

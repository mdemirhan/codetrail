// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, setTestStrategyIntervalOverrides } from "./App";
import { createAppClient } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

const FAST_OVERRIDES = {
  "scan-5s": 100,
  "scan-10s": 200,
  "scan-30s": 300,
  "scan-1min": 400,
  "scan-5min": 500,
} as const;

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

    // Select 5s scan (mapped to 100ms via override)
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });
    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsBefore);
    });

    const refreshCallsAfterFirst = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });
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
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    const refreshCallsBeforeOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "Off" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const refreshCallsAfterOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;
    expect(refreshCallsAfterOff).toBe(refreshCallsBeforeOff);
  });
});

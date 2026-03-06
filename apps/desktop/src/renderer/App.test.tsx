// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { SEARCH_PLACEHOLDERS } from "./lib/searchPlaceholders";
import { createAppClient, installScrollIntoViewMock } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

describe("App shell", () => {
  it("loads history, supports global search navigation, and opens settings", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Global Search" }));
    expect(screen.getByRole("heading", { name: "Global Search" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");
    await waitFor(() => {
      expect(screen.getByText("markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByText("markdown table rendering"));
    await waitFor(() => {
      expect(screen.getAllByText("Investigate markdown rendering").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByText("Discovery Roots")).toBeInTheDocument();
    });
  });

  it("routes Cmd/Ctrl+Left/Right to history and global search pagination", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Page 1 / 3 (250 messages)")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Page 2 / 3 (250 messages)")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Global Search" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");
    await waitFor(() => {
      expect(screen.getByText("Page 1 / 3 (250 matches)")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Page 2 / 3 (250 matches)")).toBeInTheDocument();
    });

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(([channel]) => channel === "search:query");
      expect(calls.some(([, payload]) => (payload as { offset?: number }).offset === 100)).toBe(
        true,
      );
    });

    fireEvent.keyDown(window, { key: "ArrowLeft", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Page 1 / 3 (250 matches)")).toBeInTheDocument();
    });
  });

  it("shows generic pagination shortcuts in help page", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open help" }));

    expect(screen.getByText("Previous page")).toBeInTheDocument();
    expect(screen.getByText("Next page")).toBeInTheDocument();
  });

  it("passes per-mode message sort direction to detail requests and toggles on click", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sort All Sessions messages ascending" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Sort All Sessions messages ascending" }));

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "projects:getCombinedDetail",
      );
      expect(
        calls.some(
          ([, payload]) => (payload as { sortDirection?: string }).sortDirection === "asc",
        ),
      ).toBe(true);
    });
  });
});

// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import type { PaneStateSnapshot } from "./app/types";
import { SEARCH_PLACEHOLDERS } from "./lib/searchLabels";
import { createAppClient, installScrollIntoViewMock } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

function expectDefined<T>(value: T | null | undefined, message: string): NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
  return value as NonNullable<T>;
}

function expandHistoryPanes(): void {
  const expandProjectsButton = screen.queryByRole("button", { name: "Expand Projects pane" });
  if (expandProjectsButton) {
    fireEvent.click(expandProjectsButton);
  }

  const expandSessionsButton = screen.queryByRole("button", { name: "Expand Sessions pane" });
  if (expandSessionsButton) {
    fireEvent.click(expandSessionsButton);
  }
}

function focusPaneFromHeader(container: HTMLElement, pane: "project" | "session"): void {
  const header = expectDefined(
    container.querySelector<HTMLElement>(`.${pane}-pane .panel-header`),
    `Expected ${pane} pane header`,
  );
  fireEvent.mouseDown(header);
  fireEvent.click(header);
}

function clickToolbarButton(button: HTMLElement): void {
  fireEvent.mouseDown(button);
  fireEvent.click(button);
}

describe("App focus restoration", () => {
  it("restores the last active history pane when global search closes with Escape", async () => {
    installScrollIntoViewMock();
    const client = createAppClient();
    const { container } = renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    expandHistoryPanes();

    focusPaneFromHeader(container, "session");
    await waitFor(() => {
      expect(container.querySelector('[data-pane-active="true"]')).toHaveAttribute(
        "data-history-pane",
        "session",
      );
      expect(document.activeElement).toBe(container.querySelector(".list-scroll.session-list"));
    });

    clickToolbarButton(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages)).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(container.querySelector(".search-view")).toBeNull();
      expect(container.querySelector('[data-pane-active="true"]')).toHaveAttribute(
        "data-history-pane",
        "session",
      );
      expect(document.activeElement).toBe(container.querySelector(".list-scroll.session-list"));
    });
  });

  it("restores the last active history pane when exiting settings", async () => {
    installScrollIntoViewMock();
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    expandHistoryPanes();

    focusPaneFromHeader(container, "project");
    await waitFor(() => {
      expect(container.querySelector('[data-pane-active="true"]')).toHaveAttribute(
        "data-history-pane",
        "project",
      );
      expect(document.activeElement).toBe(container.querySelector(".list-scroll.project-list"));
    });

    clickToolbarButton(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByText("Discovery Roots")).toBeInTheDocument();
      expect(document.activeElement).toBe(container.querySelector(".settings-view"));
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Discovery Roots")).toBeNull();
      expect(container.querySelector('[data-pane-active="true"]')).toHaveAttribute(
        "data-history-pane",
        "project",
      );
      expect(document.activeElement).toBe(container.querySelector(".list-scroll.project-list"));
    });
  });

  it("restores the last active history pane when exiting help with Escape", async () => {
    installScrollIntoViewMock();
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(container.querySelector('[data-pane-active="true"]')).toHaveAttribute(
        "data-history-pane",
        "message",
      );
    });

    clickToolbarButton(screen.getByRole("button", { name: "Open help" }));
    await waitFor(() => {
      expect(container.querySelector(".help-view")).toBeInTheDocument();
      expect(document.activeElement).toBe(container.querySelector(".help-view"));
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(container.querySelector(".help-view")).toBeNull();
      expect(document.activeElement).toBe(container.querySelector(".msg-scroll.message-list"));
    });
  });

  it("restores the last active history pane when exiting help from the toolbar", async () => {
    installScrollIntoViewMock();
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    expandHistoryPanes();

    focusPaneFromHeader(container, "session");
    await waitFor(() => {
      expect(container.querySelector('[data-pane-active="true"]')).toHaveAttribute(
        "data-history-pane",
        "session",
      );
      expect(document.activeElement).toBe(container.querySelector(".list-scroll.session-list"));
    });

    clickToolbarButton(screen.getByRole("button", { name: "Open help" }));
    await waitFor(() => {
      expect(container.querySelector(".help-view")).toBeInTheDocument();
      expect(document.activeElement).toBe(container.querySelector(".help-view"));
    });

    clickToolbarButton(screen.getByRole("button", { name: "Return to history view" }));

    await waitFor(() => {
      expect(container.querySelector(".help-view")).toBeNull();
      expect(document.activeElement).toBe(container.querySelector(".list-scroll.session-list"));
    });
  });

  it("restores the last active history pane when exiting the dashboard with Escape", async () => {
    installScrollIntoViewMock();
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    expandHistoryPanes();

    focusPaneFromHeader(container, "project");
    await waitFor(() => {
      expect(container.querySelector('[data-pane-active="true"]')).toHaveAttribute(
        "data-history-pane",
        "project",
      );
      expect(document.activeElement).toBe(container.querySelector(".list-scroll.project-list"));
    });

    clickToolbarButton(screen.getByRole("button", { name: "Open dashboard" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Activity Dashboard" })).toBeInTheDocument();
      expect(document.activeElement).toBe(container.querySelector(".dashboard-view"));
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Activity Dashboard" })).toBeNull();
      expect(container.querySelector('[data-pane-active="true"]')).toHaveAttribute(
        "data-history-pane",
        "project",
      );
      expect(document.activeElement).toBe(container.querySelector(".list-scroll.project-list"));
    });
  });
});

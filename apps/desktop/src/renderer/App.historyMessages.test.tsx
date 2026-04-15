// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  createAppClient,
  getFocusedHistoryMessageId,
  installScrollIntoViewMock,
} from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

describe("App history messages", () => {
  const dispatchWindowShortcut = async (init: KeyboardEventInit) => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", init));
    });
  };

  const dispatchElementShortcut = async (target: EventTarget, init: KeyboardEventInit) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });
  };

  it("focuses visible messages with Cmd+Up/Down", async () => {
    installScrollIntoViewMock();

    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);
    const messageList = () => container.querySelector<HTMLDivElement>(".msg-scroll.message-list");

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
      expect(messageList()).not.toBeNull();
    });

    messageList()?.focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(messageList());
    });

    await dispatchWindowShortcut({ key: "ArrowDown", metaKey: true });
    await waitFor(() => {
      expect(getFocusedHistoryMessageId(container)).toBe("m1");
      expect(document.activeElement).toBe(messageList());
    });

    await dispatchWindowShortcut({ key: "ArrowDown", metaKey: true });
    await waitFor(() => {
      expect(getFocusedHistoryMessageId(container)).toBe("m2");
      expect(document.activeElement).toBe(messageList());
    });

    await dispatchWindowShortcut({ key: "ArrowUp", metaKey: true });
    await waitFor(() => {
      expect(getFocusedHistoryMessageId(container)).toBe("m1");
      expect(document.activeElement).toBe(messageList());
    });
  });

  it("continues message navigation across history pages", async () => {
    installScrollIntoViewMock();

    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);
    const messageList = () => container.querySelector<HTMLDivElement>(".msg-scroll.message-list");

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
    });
    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await dispatchWindowShortcut({ key: "ArrowDown", metaKey: true });
    await waitFor(() => {
      expect(getFocusedHistoryMessageId(container)).toBe("m1");
    });
    await dispatchWindowShortcut({ key: "ArrowDown", metaKey: true });
    await waitFor(() => {
      expect(getFocusedHistoryMessageId(container)).toBe("m2");
    });
    await dispatchWindowShortcut({ key: "ArrowDown", metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
      expect(getFocusedHistoryMessageId(container)).toBe("m1");
      expect(document.activeElement).toBe(messageList());
    });
  });

  it("top-aligns oversized focused messages in the visible area", async () => {
    installScrollIntoViewMock();
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});

    try {
      const client = createAppClient();
      const { container } = renderWithClient(<App />, client);

      await waitFor(() => {
        expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
      });

      const messageList = container.querySelector<HTMLDivElement>(".msg-scroll.message-list");
      const messageCards = Array.from(
        container.querySelectorAll<HTMLElement>("[data-history-message-id]"),
      );
      const firstMessage = messageCards[0];
      const secondMessage = messageCards[1];

      expect(messageList).not.toBeNull();
      expect(firstMessage).toBeDefined();
      expect(secondMessage).toBeDefined();
      if (!messageList || !firstMessage || !secondMessage) {
        throw new Error("Expected message list and visible messages");
      }

      const scrollTo = vi.fn(({ top }: { top: number }) => {
        messageList.scrollTop = top;
      });

      Object.defineProperty(messageList, "clientHeight", {
        value: 120,
        configurable: true,
      });
      Object.defineProperty(messageList, "scrollTop", {
        value: 40,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(messageList, "scrollTo", {
        value: scrollTo,
        configurable: true,
      });
      Object.defineProperty(messageList, "getBoundingClientRect", {
        value: () => ({
          top: 100,
          bottom: 220,
          left: 0,
          right: 400,
          width: 400,
          height: 120,
          x: 0,
          y: 100,
          toJSON: () => "",
        }),
        configurable: true,
      });
      Object.defineProperty(firstMessage, "getBoundingClientRect", {
        value: () => ({
          top: 140,
          bottom: 420,
          left: 0,
          right: 400,
          width: 400,
          height: 280,
          x: 0,
          y: 140,
          toJSON: () => "",
        }),
        configurable: true,
      });
      Object.defineProperty(secondMessage, "getBoundingClientRect", {
        value: () => ({
          top: 430,
          bottom: 470,
          left: 0,
          right: 400,
          width: 400,
          height: 40,
          x: 0,
          y: 430,
          toJSON: () => "",
        }),
        configurable: true,
      });

      await dispatchWindowShortcut({ key: "ArrowDown", metaKey: true });

      await waitFor(() => {
        expect(getFocusedHistoryMessageId(container)).toBe("m1");
        expect(scrollTo).toHaveBeenCalledWith({ top: 80 });
      });
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });

  it("pages the message view with Ctrl+U and Ctrl+D", async () => {
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    const messageList = container.querySelector<HTMLDivElement>(".msg-scroll.message-list");
    expect(messageList).not.toBeNull();
    if (!messageList) {
      throw new Error("Expected message list");
    }

    const scrollTo = vi.fn(({ top }: { top: number }) => {
      messageList.scrollTop = top;
    });

    messageList.style.paddingTop = "20px";
    messageList.style.paddingBottom = "20px";
    Object.defineProperty(messageList, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(messageList, "scrollTop", {
      value: 40,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(messageList, "scrollTo", {
      value: scrollTo,
      configurable: true,
    });

    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(scrollTo).toHaveBeenCalledWith({ top: 300 });
    expect(document.activeElement).toBe(messageList);

    fireEvent.keyDown(window, { key: "u", ctrlKey: true });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 40 });
    expect(document.activeElement).toBe(messageList);
  });

  it("lets Ctrl+U/Ctrl+D page messages without leaving the search box and Enter/Escape/Tab return focus to messages", async () => {
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    const messageList = container.querySelector<HTMLDivElement>(".msg-scroll.message-list");
    const searchInput = container.querySelector<HTMLInputElement>(".msg-search .search-input");
    expect(messageList).not.toBeNull();
    expect(searchInput).not.toBeNull();
    if (!messageList || !searchInput) {
      throw new Error("Expected message list and history search input");
    }

    const scrollTo = vi.fn(({ top }: { top: number }) => {
      messageList.scrollTop = top;
    });

    messageList.style.paddingTop = "20px";
    messageList.style.paddingBottom = "20px";
    Object.defineProperty(messageList, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(messageList, "scrollTop", {
      value: 40,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(messageList, "scrollTo", {
      value: scrollTo,
      configurable: true,
    });

    searchInput.focus();

    fireEvent.keyDown(searchInput, { key: "d", ctrlKey: true });
    expect(scrollTo).toHaveBeenCalledWith({ top: 300 });
    expect(document.activeElement).toBe(searchInput);

    fireEvent.keyDown(searchInput, { key: "u", ctrlKey: true });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 40 });
    expect(document.activeElement).toBe(searchInput);

    fireEvent.keyDown(searchInput, { key: "Enter" });
    expect(document.activeElement).toBe(messageList);

    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "Escape" });
    expect(document.activeElement).toBe(messageList);

    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: "Tab" });
    expect(document.activeElement).toBe(messageList);
  });

  it("lets Cmd+Up/Cmd+Down from the history search box keep focus in the search box", async () => {
    installScrollIntoViewMock();

    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    const searchInput = container.querySelector<HTMLInputElement>(".msg-search .search-input");
    expect(searchInput).not.toBeNull();
    if (!searchInput) {
      throw new Error("Expected history search input");
    }

    searchInput.focus();
    await dispatchElementShortcut(searchInput, { key: "ArrowDown", metaKey: true });
    await waitFor(() => {
      expect(getFocusedHistoryMessageId(container)).toBe("m1");
      expect(document.activeElement).toBe(searchInput);
    });

    searchInput.focus();
    await dispatchElementShortcut(searchInput, { key: "ArrowUp", metaKey: true });
    await waitFor(() => {
      expect(getFocusedHistoryMessageId(container)).toBe("m1");
      expect(document.activeElement).toBe(searchInput);
    });
  });

  it("keeps the message pane focused after click-based message and pane actions", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);
    const messageList = () => container.querySelector<HTMLDivElement>(".msg-scroll.message-list");

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    const messageListElement = messageList();
    expect(messageListElement).not.toBeNull();
    if (!messageListElement) {
      throw new Error("Expected message list");
    }

    messageListElement.focus();
    await user.click(screen.getAllByRole("button", { name: "Collapse message" })[0]!);
    await waitFor(() => {
      expect(document.activeElement).toBe(messageListElement);
    });

    await user.click(screen.getByRole("button", { name: /shown items/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(messageListElement);
    });

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(messageListElement);
    });
  });

  it("keeps the message pane focused when clicking empty header space", async () => {
    installScrollIntoViewMock();

    const user = userEvent.setup();
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);
    const messageList = () => container.querySelector<HTMLDivElement>(".msg-scroll.message-list");

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    const messageListElement = messageList();
    const header = container.querySelector<HTMLElement>(".msg-header");
    expect(messageListElement).not.toBeNull();
    expect(header).not.toBeNull();
    if (!messageListElement || !header) {
      throw new Error("Expected message list and header");
    }

    messageListElement.focus();
    await user.pointer([
      {
        target: header,
        coords: { clientX: 12, clientY: 12 },
        keys: "[MouseLeft]",
      },
    ]);

    await waitFor(() => {
      expect(document.activeElement).toBe(messageListElement);
    });
  });

  it("keeps the message pane focused when entering and exiting focus mode", async () => {
    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);
    const messageList = () => container.querySelector<HTMLDivElement>(".msg-scroll.message-list");

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Enter focus mode" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(messageList());
      expect(messageList()?.closest(".history-focus-pane")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Exit focus mode" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(messageList());
      expect(messageList()?.closest(".history-focus-pane")).not.toBeNull();
    });
  });
});

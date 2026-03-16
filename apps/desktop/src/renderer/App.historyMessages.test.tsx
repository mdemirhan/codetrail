// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  createAppClient,
  getFocusedHistoryMessageId,
  installScrollIntoViewMock,
} from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

describe("App history messages", () => {
  it("focuses visible messages with Cmd+Up/Down", async () => {
    installScrollIntoViewMock();

    const client = createAppClient();
    const { container } = renderWithClient(<App />, client);
    const messageList = () => container.querySelector<HTMLDivElement>(".msg-scroll.message-list");

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowDown", metaKey: true });
    await waitFor(() => {
      expect(getFocusedHistoryMessageId(container)).toBe("m1");
      expect(document.activeElement).toBe(messageList());
    });

    fireEvent.keyDown(window, { key: "ArrowDown", metaKey: true });
    await waitFor(() => {
      expect(getFocusedHistoryMessageId(container)).toBe("m2");
      expect(document.activeElement).toBe(messageList());
    });

    fireEvent.keyDown(window, { key: "ArrowUp", metaKey: true });
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
      expect(screen.getByText("Page 1 / 3 (250 messages)")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowDown", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowDown", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowDown", metaKey: true });

    await waitFor(() => {
      expect(screen.getByText("Page 2 / 3 (250 messages)")).toBeInTheDocument();
      expect(getFocusedHistoryMessageId(container)).toBe("m1");
      expect(document.activeElement).toBe(messageList());
    });
  });

  it("top-aligns oversized focused messages in the visible area", async () => {
    installScrollIntoViewMock();

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

    fireEvent.keyDown(window, { key: "ArrowDown", metaKey: true });

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 80 });
    });
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

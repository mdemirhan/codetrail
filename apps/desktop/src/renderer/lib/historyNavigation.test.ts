// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { getAdjacentItemId, getEdgeItemId, getFirstVisibleMessageId } from "./historyNavigation";

describe("historyNavigation", () => {
  it("falls back to the first item when there is no current selection", () => {
    expect(
      getAdjacentItemId(
        [{ id: "first" }, { id: "second" }],
        "",
        "next",
      ),
    ).toBe("first");
  });

  it("returns the adjacent item in the requested direction", () => {
    expect(
      getAdjacentItemId(
        [{ id: "first" }, { id: "second" }, { id: "third" }],
        "second",
        "next",
      ),
    ).toBe("third");
    expect(
      getAdjacentItemId(
        [{ id: "first" }, { id: "second" }, { id: "third" }],
        "second",
        "previous",
      ),
    ).toBe("first");
  });

  it("returns null when moving past the ends", () => {
    expect(getAdjacentItemId([{ id: "first" }], "first", "previous")).toBeNull();
    expect(getAdjacentItemId([{ id: "first" }], "first", "next")).toBeNull();
  });

  it("returns the requested edge item", () => {
    expect(getEdgeItemId([{ id: "first" }, { id: "second" }], "next")).toBe("first");
    expect(getEdgeItemId([{ id: "first" }, { id: "second" }], "previous")).toBe("second");
  });

  it("prefers the first visible message element", () => {
    const container = document.createElement("div");
    const first = document.createElement("article");
    first.dataset.historyMessageId = "m1";
    const second = document.createElement("article");
    second.dataset.historyMessageId = "m2";
    const third = document.createElement("article");
    third.dataset.historyMessageId = "m3";
    container.append(first, second, third);

    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ top: 100, bottom: 200 }),
      configurable: true,
    });
    Object.defineProperty(first, "getBoundingClientRect", {
      value: () => ({ top: 20, bottom: 80 }),
      configurable: true,
    });
    Object.defineProperty(second, "getBoundingClientRect", {
      value: () => ({ top: 110, bottom: 150 }),
      configurable: true,
    });
    Object.defineProperty(third, "getBoundingClientRect", {
      value: () => ({ top: 210, bottom: 260 }),
      configurable: true,
    });

    expect(getFirstVisibleMessageId(container)).toBe("m2");
  });

  it("falls back to the first message when layout information is unavailable", () => {
    const container = document.createElement("div");
    const first = document.createElement("article");
    first.dataset.historyMessageId = "m1";
    const second = document.createElement("article");
    second.dataset.historyMessageId = "m2";
    container.append(first, second);

    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 0 }),
      configurable: true,
    });

    expect(getFirstVisibleMessageId(container)).toBe("m1");
  });
});

import { describe, expect, it, vi } from "vitest";

import { scheduleSelectedSessionScroll } from "./sessionAutoScroll";

describe("scheduleSelectedSessionScroll", () => {
  it("scrolls when the selected element becomes available after startup restore", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const scheduleAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const cancelAnimationFrame = vi.fn();

    const beforeMountCleanup = scheduleSelectedSessionScroll({
      selectedSessionId: "session_restored",
      collapsed: false,
      selectedSessionElement: null,
      scheduleAnimationFrame,
      cancelAnimationFrame,
    });
    expect(beforeMountCleanup).toBeUndefined();
    expect(scheduleAnimationFrame).not.toHaveBeenCalled();

    const selectedSessionElement = {
      scrollIntoView: vi.fn(),
    };
    const afterMountCleanup = scheduleSelectedSessionScroll({
      selectedSessionId: "session_restored",
      collapsed: false,
      selectedSessionElement,
      scheduleAnimationFrame,
      cancelAnimationFrame,
    });
    expect(scheduleAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frameCallbacks).toHaveLength(1);

    frameCallbacks[0]?.(16);
    expect(selectedSessionElement.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    afterMountCleanup?.();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it("does not schedule scroll when sessions pane is collapsed", () => {
    const scheduleAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });

    const cleanup = scheduleSelectedSessionScroll({
      selectedSessionId: "session_restored",
      collapsed: true,
      selectedSessionElement: { scrollIntoView: vi.fn() },
      scheduleAnimationFrame,
      cancelAnimationFrame: vi.fn(),
    });

    expect(cleanup).toBeUndefined();
    expect(scheduleAnimationFrame).not.toHaveBeenCalled();
  });
});

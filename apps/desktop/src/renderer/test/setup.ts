import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

beforeEach(() => {
  if (typeof window === "undefined") {
    return;
  }

  Object.defineProperty(window, "codetrail", {
    configurable: true,
    writable: true,
    value: {
      invoke: vi.fn(async () => {
        throw new Error("window.codetrail.invoke mock not configured for this test.");
      }),
    },
  });
});

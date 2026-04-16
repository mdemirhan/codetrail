import "@testing-library/jest-dom/vitest";
import { closeTrackedDatabasesForTests } from "@codetrail/core";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

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
      onHistoryExportProgress: vi.fn(() => () => undefined),
      onAppCommand: vi.fn(() => () => undefined),
      onLiveStatusChanged: vi.fn(() => () => undefined),
    },
  });
});

afterEach(() => {
  cleanup();
  closeTrackedDatabasesForTests();
});

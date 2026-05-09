import { describe, expect, it } from "vitest";

import { shouldIgnoreAsyncEffectError } from "./asyncEffectUtils";

describe("shouldIgnoreAsyncEffectError", () => {
  it("ignores any error after cancellation", () => {
    expect(shouldIgnoreAsyncEffectError(true, "boom")).toBe(true);
  });

  it("ignores abort and cancellation errors before reporting real failures", () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    expect(shouldIgnoreAsyncEffectError(false, abortError)).toBe(true);
    expect(shouldIgnoreAsyncEffectError(false, new Error("request cancelled"))).toBe(true);
    expect(shouldIgnoreAsyncEffectError(false, new Error("network failed"))).toBe(false);
    expect(shouldIgnoreAsyncEffectError(false, "cancelled")).toBe(false);
  });
});

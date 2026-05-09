import { describe, expect, it } from "vitest";

import { MAX_ZOOM_PERCENT, MIN_ZOOM_PERCENT, clampZoomPercent, parseZoomPercent } from "./zoom";

describe("zoom utilities", () => {
  it("clamps and rounds zoom percentages to the supported range", () => {
    expect(clampZoomPercent(MIN_ZOOM_PERCENT - 10)).toBe(MIN_ZOOM_PERCENT);
    expect(clampZoomPercent(MAX_ZOOM_PERCENT + 10)).toBe(MAX_ZOOM_PERCENT);
    expect(clampZoomPercent(124.6)).toBe(125);
  });

  it("parses user-entered zoom values and rejects empty values", () => {
    expect(parseZoomPercent("125%")).toBe(125);
    expect(parseZoomPercent(" 90.4 ")).toBe(90);
    expect(parseZoomPercent("zoom 500")).toBe(MAX_ZOOM_PERCENT);
    expect(parseZoomPercent("")).toBeNull();
    expect(parseZoomPercent("zoom")).toBeNull();
  });
});

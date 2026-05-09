// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { isEditableTarget } from "./focusTargets";

describe("isEditableTarget", () => {
  it("recognizes standard editable controls", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
  });

  it("recognizes contenteditable elements and rejects non-editable targets", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");

    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

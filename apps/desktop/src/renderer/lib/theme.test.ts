// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { applyDocumentAppearance, applyTheme, resolveThemeCssBase } from "./theme";

describe("theme helpers", () => {
  it("resolves imported variants onto their css bases", () => {
    expect(resolveThemeCssBase("ft-dark")).toBe("dark");
    expect(resolveThemeCssBase("obsidian-blue")).toBe("dark");
    expect(resolveThemeCssBase("midnight")).toBe("dark");
    expect(resolveThemeCssBase("sand")).toBe("light");
    expect(resolveThemeCssBase("tomorrow-night")).toBe("tomorrow-night");
  });

  it("applies theme identity and clears variant overrides when returning to a base theme", () => {
    applyTheme("midnight");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeVariant).toBe("midnight");
    expect(document.documentElement.style.getPropertyValue("--bg-base")).toBe("#0a0d14");

    applyTheme("light");

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeVariant).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--bg-base")).toBe("");
  });

  it("applies obsidian blue overrides", () => {
    applyTheme("obsidian-blue");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeVariant).toBe("obsidian-blue");
    expect(document.documentElement.style.getPropertyValue("--bg-base")).toBe("#0b1018");
    expect(document.documentElement.style.getPropertyValue("--help-hover")).toBe("#0d1420");
  });

  it("applies the shiki theme alongside the document theme", () => {
    applyDocumentAppearance("dark", "vesper");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeVariant).toBe("dark");
    expect(document.documentElement.dataset.shikiTheme).toBe("vesper");

    applyDocumentAppearance("light", null);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeVariant).toBe("light");
    expect(document.documentElement.dataset.shikiTheme).toBeUndefined();
  });
});

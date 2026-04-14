import { describe, expect, it } from "vitest";

import { getChipProviders, getProviderWithChildren, toggleGroupProviders } from "./providerGroups";

describe("getChipProviders", () => {
  it("returns all providers when none are children", () => {
    expect(getChipProviders(["claude", "codex", "gemini"])).toEqual(["claude", "codex", "gemini"]);
  });

  it("hides copilot_cli when copilot is also present", () => {
    expect(getChipProviders(["claude", "copilot", "copilot_cli"])).toEqual(["claude", "copilot"]);
  });

  it("shows copilot_cli as standalone when copilot is absent", () => {
    expect(getChipProviders(["claude", "copilot_cli"])).toEqual(["claude", "copilot_cli"]);
  });

  it("returns empty array for empty input", () => {
    expect(getChipProviders([])).toEqual([]);
  });

  it("shows copilot_cli alone when it is the only provider", () => {
    expect(getChipProviders(["copilot_cli"])).toEqual(["copilot_cli"]);
  });

  it("preserves original ordering", () => {
    expect(getChipProviders(["copilot_cli", "claude", "copilot"])).toEqual(["claude", "copilot"]);
  });
});

describe("getProviderWithChildren", () => {
  it("returns the provider plus its children that are available", () => {
    const result = getProviderWithChildren("copilot", ["claude", "copilot", "copilot_cli"]);
    expect(result).toEqual(["copilot", "copilot_cli"]);
  });

  it("returns only the provider when children are not available", () => {
    const result = getProviderWithChildren("copilot", ["claude", "copilot"]);
    expect(result).toEqual(["copilot"]);
  });

  it("returns only available providers in the group", () => {
    const result = getProviderWithChildren("claude", ["claude", "codex"]);
    expect(result).toEqual(["claude"]);
  });

  it("returns only available children when provider itself is not in allProviders", () => {
    const result = getProviderWithChildren("copilot", ["claude", "copilot_cli"]);
    expect(result).toEqual(["copilot_cli"]);
  });
});

describe("toggleGroupProviders", () => {
  it("adds the provider and its children when none are active", () => {
    const result = toggleGroupProviders(
      "copilot",
      ["claude"],
      ["claude", "copilot", "copilot_cli"],
    );
    expect(result).toContain("copilot");
    expect(result).toContain("copilot_cli");
    expect(result).toContain("claude");
  });

  it("removes the provider and its children when any are active", () => {
    const result = toggleGroupProviders(
      "copilot",
      ["claude", "copilot", "copilot_cli"],
      ["claude", "copilot", "copilot_cli"],
    );
    expect(result).toContain("claude");
    expect(result).not.toContain("copilot");
    expect(result).not.toContain("copilot_cli");
  });

  it("removes the group when only the child is active", () => {
    const result = toggleGroupProviders(
      "copilot",
      ["claude", "copilot_cli"],
      ["claude", "copilot", "copilot_cli"],
    );
    expect(result).not.toContain("copilot");
    expect(result).not.toContain("copilot_cli");
    expect(result).toContain("claude");
  });

  it("does not add duplicates", () => {
    const result = toggleGroupProviders("copilot", [], ["copilot", "copilot_cli"]);
    expect(result.filter((p) => p === "copilot")).toHaveLength(1);
    expect(result.filter((p) => p === "copilot_cli")).toHaveLength(1);
  });

  it("handles a provider with no children gracefully", () => {
    const result = toggleGroupProviders("claude", [], ["claude", "codex"]);
    expect(result).toContain("claude");
    expect(result).not.toContain("codex");
  });
});

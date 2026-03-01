// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { copyTextToClipboard, openPath } = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(async () => true),
  openPath: vi.fn(async () => ({ ok: true, error: null })),
}));

vi.mock("../lib/clipboard", () => ({
  copyTextToClipboard,
}));

vi.mock("../lib/pathActions", () => ({
  openPath,
}));

import { SettingsView } from "./SettingsView";

const info = {
  storage: {
    settingsFile: "/tmp/ui-state.json",
    cacheDir: "/tmp/cache",
    databaseFile: "/tmp/codetrail.sqlite",
    userDataDir: "/tmp",
  },
  discovery: {
    claudeRoot: "/Users/test/.claude/projects",
    codexRoot: "/Users/test/.codex/sessions",
    geminiRoot: "/Users/test/.gemini/tmp",
    geminiHistoryRoot: "/Users/test/.gemini/history",
    geminiProjectsPath: "/Users/test/.gemini/projects.json",
  },
};

describe("SettingsView", () => {
  it("renders loading and error states", () => {
    const { rerender } = render(
      <SettingsView
        info={null}
        loading={true}
        error={null}
        monoFontFamily="droid_sans_mono"
        regularFontFamily="current"
        monoFontSize="12px"
        regularFontSize="13.5px"
        useMonospaceForAllMessages={false}
        onMonoFontFamilyChange={vi.fn()}
        onRegularFontFamilyChange={vi.fn()}
        onMonoFontSizeChange={vi.fn()}
        onRegularFontSizeChange={vi.fn()}
        onUseMonospaceForAllMessagesChange={vi.fn()}
        expandedByDefaultCategories={["assistant"]}
        onToggleExpandedByDefault={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading settings...")).toBeInTheDocument();

    rerender(
      <SettingsView
        info={null}
        loading={false}
        error="boom"
        monoFontFamily="droid_sans_mono"
        regularFontFamily="current"
        monoFontSize="12px"
        regularFontSize="13.5px"
        useMonospaceForAllMessages={false}
        onMonoFontFamilyChange={vi.fn()}
        onRegularFontFamilyChange={vi.fn()}
        onMonoFontSizeChange={vi.fn()}
        onRegularFontSizeChange={vi.fn()}
        onUseMonospaceForAllMessagesChange={vi.fn()}
        expandedByDefaultCategories={["assistant"]}
        onToggleExpandedByDefault={vi.fn()}
      />,
    );

    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders settings details and handles control interactions", async () => {
    const user = userEvent.setup();
    const onMonoFontFamilyChange = vi.fn();
    const onRegularFontFamilyChange = vi.fn();
    const onMonoFontSizeChange = vi.fn();
    const onRegularFontSizeChange = vi.fn();
    const onUseMonospaceForAllMessagesChange = vi.fn();
    const onToggleExpandedByDefault = vi.fn();

    render(
      <SettingsView
        info={info}
        loading={false}
        error={null}
        monoFontFamily="droid_sans_mono"
        regularFontFamily="current"
        monoFontSize="12px"
        regularFontSize="13.5px"
        useMonospaceForAllMessages={false}
        onMonoFontFamilyChange={onMonoFontFamilyChange}
        onRegularFontFamilyChange={onRegularFontFamilyChange}
        onMonoFontSizeChange={onMonoFontSizeChange}
        onRegularFontSizeChange={onRegularFontSizeChange}
        onUseMonospaceForAllMessagesChange={onUseMonospaceForAllMessagesChange}
        expandedByDefaultCategories={["assistant"]}
        onToggleExpandedByDefault={onToggleExpandedByDefault}
      />,
    );

    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Discovery Roots")).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(4);
    await user.selectOptions(selects[0] as HTMLElement, "current");
    await user.selectOptions(selects[1] as HTMLElement, "13px");
    await user.selectOptions(selects[2] as HTMLElement, "inter");
    await user.selectOptions(selects[3] as HTMLElement, "14px");

    await user.click(
      screen.getByRole("checkbox", { name: "Use monospaced fonts for all messages" }),
    );
    await user.click(screen.getByRole("button", { name: "User" }));

    const copyButtons = screen.getAllByRole("button", { name: /Copy /i });
    const openButtons = screen.getAllByRole("button", { name: /Open /i });
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(openButtons.length).toBeGreaterThan(0);
    await user.click(copyButtons[0] as HTMLElement);
    await user.click(openButtons[0] as HTMLElement);

    expect(onMonoFontFamilyChange).toHaveBeenCalledWith("current");
    expect(onMonoFontSizeChange).toHaveBeenCalledWith("13px");
    expect(onRegularFontFamilyChange).toHaveBeenCalledWith("inter");
    expect(onRegularFontSizeChange).toHaveBeenCalledWith("14px");
    expect(onUseMonospaceForAllMessagesChange).toHaveBeenCalledWith(true);
    expect(onToggleExpandedByDefault).toHaveBeenCalledWith("user");
    expect(copyTextToClipboard).toHaveBeenCalled();
    expect(openPath).toHaveBeenCalled();
  });
});

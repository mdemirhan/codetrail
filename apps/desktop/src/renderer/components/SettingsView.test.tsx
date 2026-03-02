// @vitest-environment jsdom

import type { MessageCategory } from "@codetrail/core";
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
    bookmarksDatabaseFile: "/tmp/codetrail.bookmarks.sqlite",
    userDataDir: "/tmp",
  },
  discovery: {
    claudeRoot: "/Users/test/.claude/projects",
    codexRoot: "/Users/test/.codex/sessions",
    geminiRoot: "/Users/test/.gemini/tmp",
    geminiHistoryRoot: "/Users/test/.gemini/history",
    geminiProjectsPath: "/Users/test/.gemini/projects.json",
    cursorRoot: "/Users/test/.cursor/projects",
  },
};

function createBaseProps() {
  return {
    monoFontFamily: "droid_sans_mono" as const,
    regularFontFamily: "current" as const,
    monoFontSize: "12px" as const,
    regularFontSize: "13.5px" as const,
    useMonospaceForAllMessages: false,
    onMonoFontFamilyChange: vi.fn(),
    onRegularFontFamilyChange: vi.fn(),
    onMonoFontSizeChange: vi.fn(),
    onRegularFontSizeChange: vi.fn(),
    onUseMonospaceForAllMessagesChange: vi.fn(),
    expandedByDefaultCategories: ["assistant"] as MessageCategory[],
    onToggleExpandedByDefault: vi.fn(),
    systemMessageRegexRules: {
      claude: ["^<command-name>"],
      codex: ["^<environment_context>"],
      gemini: [],
      cursor: [],
    },
    onAddSystemMessageRegexRule: vi.fn(),
    onUpdateSystemMessageRegexRule: vi.fn(),
    onRemoveSystemMessageRegexRule: vi.fn(),
  };
}

describe("SettingsView", () => {
  it("renders loading and error states", () => {
    const baseProps = createBaseProps();
    const { rerender } = render(
      <SettingsView info={null} loading={true} error={null} {...baseProps} />,
    );

    expect(screen.getByText("Loading settings...")).toBeInTheDocument();

    rerender(<SettingsView info={null} loading={false} error="boom" {...baseProps} />);

    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders settings details and handles control interactions", async () => {
    const user = userEvent.setup();
    const baseProps = createBaseProps();

    render(<SettingsView info={info} loading={false} error={null} {...baseProps} />);

    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Discovery Roots")).toBeInTheDocument();
    expect(screen.getByText("System Message Rules")).toBeInTheDocument();

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
    await user.click(screen.getByRole("button", { name: "Add claude regex rule" }));
    await user.type(screen.getByRole("textbox", { name: "claude regex rule 1" }), "$");
    await user.click(screen.getByRole("button", { name: "Remove claude regex rule 1" }));

    const copyButtons = screen.getAllByRole("button", { name: /Copy /i });
    const openButtons = screen.getAllByRole("button", { name: /Open /i });
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(openButtons.length).toBeGreaterThan(0);
    await user.click(copyButtons[0] as HTMLElement);
    await user.click(openButtons[0] as HTMLElement);

    expect(baseProps.onMonoFontFamilyChange).toHaveBeenCalledWith("current");
    expect(baseProps.onMonoFontSizeChange).toHaveBeenCalledWith("13px");
    expect(baseProps.onRegularFontFamilyChange).toHaveBeenCalledWith("inter");
    expect(baseProps.onRegularFontSizeChange).toHaveBeenCalledWith("14px");
    expect(baseProps.onUseMonospaceForAllMessagesChange).toHaveBeenCalledWith(true);
    expect(baseProps.onToggleExpandedByDefault).toHaveBeenCalledWith("user");
    expect(baseProps.onAddSystemMessageRegexRule).toHaveBeenCalledWith("claude");
    expect(baseProps.onUpdateSystemMessageRegexRule).toHaveBeenCalledWith(
      "claude",
      0,
      "^<command-name>$",
    );
    expect(baseProps.onRemoveSystemMessageRegexRule).toHaveBeenCalledWith("claude", 0);
    expect(copyTextToClipboard).toHaveBeenCalled();
    expect(openPath).toHaveBeenCalled();
  });
});

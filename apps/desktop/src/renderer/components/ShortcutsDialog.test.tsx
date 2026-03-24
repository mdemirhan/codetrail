// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShortcutsDialog } from "./ShortcutsDialog";

describe("ShortcutsDialog", () => {
  it("renders grouped shortcuts and syntax blocks in help view", () => {
    const { container } = render(
      <ShortcutsDialog
        shortcutItems={[
          { group: "Search & Navigation", shortcut: "Cmd+F", description: "Search messages" },
          { group: "System", shortcut: "Esc", description: "Return to history view" },
        ]}
        commonSyntaxItems={[
          { syntax: "term*", description: "Prefix wildcard", note: "Postfix only" },
        ]}
        advancedSyntaxItems={[
          { syntax: "A OR B", description: "Boolean OR", note: "Advanced mode" },
        ]}
      />,
    );

    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Search Syntax")).toBeInTheDocument();
    expect(screen.getByText("Common")).toBeInTheDocument();
    expect(screen.getByText("Advanced Only")).toBeInTheDocument();
    expect(screen.getByText("Search & Navigation")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Cmd")).toBeInTheDocument();
    expect(screen.getByText("Search messages")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
    expect(screen.getByText("Return to history view")).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => (element?.textContent ?? "").trim() === "term*"),
    ).toBeInTheDocument();
    expect(screen.getByText("Prefix wildcard")).toBeInTheDocument();
    expect(screen.getByText("Postfix only")).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => (element?.textContent ?? "").trim() === "A OR B"),
    ).toBeInTheDocument();
    expect(screen.getByText("Boolean OR")).toBeInTheDocument();
    expect(screen.getAllByText("Advanced mode").length).toBeGreaterThan(0);
    expect(container.querySelector(".help-card-icon.success")).toBeInTheDocument();
    expect(container.querySelector(".help-card-title-shortcuts")).toBeInTheDocument();
  });
});

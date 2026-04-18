// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createShortcutRegistry } from "../lib/shortcutRegistry";
import { ShortcutsDialog } from "./ShortcutsDialog";

describe("ShortcutsDialog", () => {
  it("renders the redesigned help layout with syntax and filter sections", () => {
    const { container } = render(
      <ShortcutsDialog
        shortcuts={createShortcutRegistry("darwin")}
        commonSyntaxItems={[{ syntax: "react", description: "Match a word" }]}
        advancedSyntaxItems={[{ syntax: "A OR B", description: "Match either term" }]}
      />,
    );

    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Search Syntax")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Views & Panels")).toBeInTheDocument();
    expect(screen.getByText("Message Filters")).toBeInTheDocument();
    expect(screen.getByText("Scroll current list")).toBeInTheDocument();
    expect(screen.getByText("Scroll message pane")).toBeInTheDocument();
    expect(screen.getAllByText("System").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText((_, element) => (element?.textContent ?? "").trim() === "react").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Match a word")).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) => (element?.textContent ?? "").trim() === "A OR B").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Match either term")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText("Focus (solo)")).toBeInTheDocument();

    const turnsViewRow = screen.getByText("Turns view").closest(".help-shortcut-row");
    expect(turnsViewRow?.textContent).toContain("⌘");
    expect(turnsViewRow?.textContent).toContain("⇧");
    expect(turnsViewRow?.textContent).toContain("T");

    const toggleTurnsRow = screen
      .getByText("Toggle flat / turns view")
      .closest(".help-shortcut-row");
    expect(toggleTurnsRow?.textContent).toContain("⌘");
    expect(toggleTurnsRow?.textContent).toContain("T");
    expect(toggleTurnsRow?.textContent).not.toContain("⇧");

    const diffRow = screen
      .getByText("Expand / collapse combined diffs")
      .closest(".help-shortcut-row");
    expect(diffRow?.textContent).toContain("⌘");
    expect(diffRow?.textContent).toContain("D");
    expect(diffRow?.textContent).toContain("⇧");
    expect(diffRow?.textContent).toContain("or");
  });

  it("renders platform-specific shortcuts from the live registry", () => {
    render(
      <ShortcutsDialog
        shortcuts={createShortcutRegistry("win32")}
        commonSyntaxItems={[]}
        advancedSyntaxItems={[]}
      />,
    );

    const toggleSessionsRow = screen
      .getByText("Toggle Sessions pane")
      .closest(".help-shortcut-row");
    expect(toggleSessionsRow?.textContent).toContain("⌃");
    expect(toggleSessionsRow?.textContent).toContain("⌥");
    expect(toggleSessionsRow?.textContent).toContain("B");

    const keepFocusPageUpRow = screen
      .getByText("Page messages up (keep focus)")
      .closest(".help-shortcut-row");
    expect(keepFocusPageUpRow?.textContent).toContain("⌃");
    expect(keepFocusPageUpRow?.textContent).toContain("U");

    const pageUpRow = screen
      .getByText("Page up in current list")
      .closest(".help-shortcut-row");
    expect(pageUpRow?.textContent).toContain("PgUp");
    expect(pageUpRow?.textContent).toContain("⌃");
  });
});

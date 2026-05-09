// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/codetrailClient", () => ({
  getCodetrailClient: () => ({
    platform: "darwin",
    invoke: vi.fn(async () => ({ ok: true })),
  }),
}));

import { ViewerExternalAppsTestProvider } from "../../test/viewerExternalApps";
import { MessageContent } from "./MessageContent";

function renderWithViewerExternalApps(element: ReactElement) {
  return render(element, { wrapper: ViewerExternalAppsTestProvider });
}

describe("MessageContent", () => {
  beforeEach(() => {
    document.documentElement.dataset.collapseMultiFileToolDiffs = "false";
  });

  it("renders thinking messages as highlighted pre blocks", () => {
    renderWithViewerExternalApps(
      <MessageContent text="thinking text" category="thinking" query="" />,
    );

    expect(screen.getByText("thinking text")).toBeInTheDocument();
    expect(document.querySelector(".thinking-block")).not.toBeNull();
  });

  it("renders tool_use payload with command and arguments", () => {
    renderWithViewerExternalApps(
      <MessageContent
        text={JSON.stringify({
          tool_name: "run_command",
          input: { cmd: "ls -la", file_path: "src/app.ts" },
        })}
        category="tool_use"
        query=""
      />,
    );

    expect(screen.queryByText("Execute Command")).not.toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(document.body.textContent).toContain("ls -la");
  });

  it("renders write-like tool_use payloads through the tool edit view", () => {
    renderWithViewerExternalApps(
      <MessageContent
        text={JSON.stringify({
          tool_name: "write_file",
          input: { path: "src/write.ts", content: "export const value = 1;" },
        })}
        category="tool_use"
        query=""
      />,
    );

    expect(screen.getByText("src/write.ts")).toBeInTheDocument();
    expect(screen.getByText("Written Content")).toBeInTheDocument();
    expect(document.body.textContent).toContain("export const value = 1;");
  });

  it("renders tool_edit diff and written content variants", () => {
    const { rerender } = renderWithViewerExternalApps(
      <MessageContent
        text={JSON.stringify({
          input: {
            path: "src/file.ts",
            old_string: "const a = 1;",
            new_string: "const a = 2;",
          },
        })}
        category="tool_edit"
        query=""
      />,
    );

    expect(screen.getAllByText("src/file.ts")).toHaveLength(1);
    expect(document.body.textContent).toContain("const a = 2;");
    expect(document.querySelector(".tool-edit-view .tool-edit-path")).toBeNull();

    rerender(
      <MessageContent
        text={JSON.stringify({ input: { path: "src/write.ts", content: "new content" } })}
        category="tool_edit"
        query=""
      />,
    );

    expect(screen.getByText("src/write.ts")).toBeInTheDocument();
    expect(document.querySelector(".tool-edit-view .tool-edit-path")).not.toBeNull();
    expect(screen.getByText("Written Content")).toBeInTheDocument();
    expect(document.body.textContent).toContain("new content");
  });

  it("renders multi-file tool edit summaries with collapsible diffs", async () => {
    const user = userEvent.setup();
    document.documentElement.dataset.collapseMultiFileToolDiffs = "true";

    renderWithViewerExternalApps(
      <MessageContent
        text={JSON.stringify({
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Add File: /workspace/src/new.ts",
            "+export const created = true;",
            "*** Update File: /workspace/src/parser.ts",
            "@@",
            "-const value = old();",
            "+const value = next();",
            "*** End Patch",
          ].join("\n"),
        })}
        category="tool_edit"
        query=""
      />,
    );

    const summary = document.querySelector(".tool-edit-summary");
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toBe("1 file added, 1 file changed");
    expect(screen.getByRole("button", { name: "Expand diff for new.ts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("export const created = true;");
    expect(document.body.textContent).not.toContain("const value = next();");
    expect(screen.queryByText("Added")).toBeNull();
    expect(screen.queryByText("Updated")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Expand diff for parser.ts" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Collapse diff for parser.ts" }),
      ).toBeInTheDocument();
      expect(document.body.textContent).toContain("const value = next();");
    });

    await user.click(screen.getByRole("button", { name: "Collapse diff for parser.ts" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("const value = next();");
    });
  });

  it("renders single-file tool-edit diffs as collapsible viewers", async () => {
    const user = userEvent.setup();

    renderWithViewerExternalApps(
      <MessageContent
        text={JSON.stringify({
          input: {
            path: "/workspace/src/file.ts",
            old_string: "const beforeValue = 1;",
            new_string: "const afterValue = 2;",
          },
        })}
        category="tool_edit"
        query=""
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse diff for file.ts" })).toBeInTheDocument();
    expect(document.querySelector(".content-viewer-body")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Collapse diff for file.ts" }));
    expect(screen.getByRole("button", { name: "Expand diff for file.ts" })).toBeInTheDocument();
    expect(document.querySelector(".content-viewer-body")).toBeNull();
  });

  it("toggles collapsible diffs from the filename, diff counts, and empty header area", async () => {
    const user = userEvent.setup();

    renderWithViewerExternalApps(
      <MessageContent
        text={JSON.stringify({
          input: {
            path: "/workspace/src/file.ts",
            old_string: "const beforeValue = 1;",
            new_string: "const afterValue = 2;",
          },
        })}
        category="tool_edit"
        query=""
      />,
    );

    await user.click(screen.getByText("/workspace/src/file.ts"));
    expect(screen.getByRole("button", { name: "Expand diff for file.ts" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand diff for file.ts" }));
    expect(screen.getByRole("button", { name: "Collapse diff for file.ts" })).toBeInTheDocument();

    const diffCounts = document.querySelector<HTMLButtonElement>(".content-viewer-diff-counts");
    expect(diffCounts).not.toBeNull();
    await user.click(diffCounts!);
    expect(screen.getByRole("button", { name: "Expand diff for file.ts" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand diff for file.ts" }));
    expect(screen.getByRole("button", { name: "Collapse diff for file.ts" })).toBeInTheDocument();

    const headerHitArea = document.querySelector<HTMLButtonElement>(
      ".content-viewer-header-hit-area",
    );
    expect(headerHitArea).not.toBeNull();
    await user.click(headerHitArea!);
    expect(screen.getByRole("button", { name: "Expand diff for file.ts" })).toBeInTheDocument();
  });

  it("resets multi-file diff expansion when the collapse setting changes", async () => {
    const user = userEvent.setup();

    const messageProps = {
      text: JSON.stringify({
        name: "apply_patch",
        input: [
          "*** Begin Patch",
          "*** Add File: /workspace/src/new.ts",
          "+export const created = true;",
          "*** Update File: /workspace/src/parser.ts",
          "@@",
          "-const value = old();",
          "+const value = next();",
          "*** End Patch",
        ].join("\n"),
      }),
      category: "tool_edit" as const,
      query: "",
    };

    const { rerender } = renderWithViewerExternalApps(<MessageContent {...messageProps} />);

    expect(screen.getByRole("button", { name: "Collapse diff for parser.ts" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("const value = next();");

    await user.click(screen.getByRole("button", { name: "Collapse diff for parser.ts" }));
    expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("const value = next();");

    document.documentElement.dataset.collapseMultiFileToolDiffs = "true";
    rerender(<MessageContent {...messageProps} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand diff for parser.ts" })).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("const value = next();");
    });

    await user.click(screen.getByRole("button", { name: "Expand diff for parser.ts" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Collapse diff for parser.ts" }),
      ).toBeInTheDocument();
      expect(document.body.textContent).toContain("const value = next();");
    });

    document.documentElement.dataset.collapseMultiFileToolDiffs = "false";
    rerender(<MessageContent {...messageProps} />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Collapse diff for parser.ts" }),
      ).toBeInTheDocument();
      expect(document.body.textContent).toContain("const value = next();");
    });
  });

  it("defaults multi-file diffs to expanded when the collapse setting attribute is absent", () => {
    delete document.documentElement.dataset.collapseMultiFileToolDiffs;

    renderWithViewerExternalApps(
      <MessageContent
        text={JSON.stringify({
          name: "apply_patch",
          input: [
            "*** Begin Patch",
            "*** Update File: /workspace/src/parser.ts",
            "@@",
            "-const value = old();",
            "+const value = next();",
            "*** End Patch",
          ].join("\n"),
        })}
        category="tool_edit"
        query=""
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse diff for parser.ts" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("const value = next();");
  });

  it("renders tool_result metadata and output", () => {
    renderWithViewerExternalApps(
      <MessageContent
        text={JSON.stringify({
          metadata: { code: 0 },
          output: JSON.stringify({ ok: true }),
        })}
        category="tool_result"
        query=""
      />,
    );

    expect(screen.getByText("Metadata")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(document.body.textContent).toContain('"ok": true');
  });

  it("highlights query matches inside tool_result code output", () => {
    renderWithViewerExternalApps(
      <MessageContent
        text={JSON.stringify({
          output: "feat(history): add collapsible side panes",
        })}
        category="tool_result"
        query={'"history add"'}
        highlightPatterns={["history add"]}
      />,
    );

    const marks = Array.from(document.querySelectorAll("mark")).map((node) => node.textContent);
    expect(marks).toContain("history): add");
  });

  it("renders markdown-rich assistant content and generic fallback content", () => {
    const { rerender } = renderWithViewerExternalApps(
      <MessageContent
        text={"## Summary\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"}
        category="assistant"
        query=""
      />,
    );

    expect(document.querySelector(".rich-block table")).not.toBeNull();

    rerender(<MessageContent text="plain system text" category="system" query="" />);
    expect(screen.getByText("plain system text")).toBeInTheDocument();
  });

  it("preserves single-line breaks for plain user/system content", () => {
    renderWithViewerExternalApps(
      <MessageContent text={"line one\nline two\nline three"} category="user" query="" />,
    );

    const paragraphs = document.querySelectorAll(".rich-block .md-p");
    expect(paragraphs).toHaveLength(3);
    expect(screen.getByText("line one")).toBeInTheDocument();
    expect(screen.getByText("line two")).toBeInTheDocument();
    expect(screen.getByText("line three")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  codeToTokensMock,
  copyTextToClipboardMock,
  createHighlighterMock,
  listAvailableEditorsMock,
  paneStateMock,
  openContentInEditorMock,
  openDiffInEditorMock,
  openFileInEditorMock,
  openPathMock,
} = vi.hoisted(() => ({
  codeToTokensMock: vi.fn((code: string, options?: { theme?: string }) => {
    const theme = options?.theme ?? "github-dark-default";
    const themeColorByTheme: Record<string, string> = {
      "github-dark-default": "rgb(96, 165, 250)",
      vesper: "rgb(248, 189, 96)",
      "night-owl": "rgb(129, 230, 217)",
      "github-light-high-contrast": "#8cb4ff",
      "github-light-default": "rgb(9, 105, 218)",
    };
    const color = themeColorByTheme[theme] ?? "rgb(180, 180, 180)";
    return code.split(/\r?\n/).map((line) => {
      if (line.startsWith("const ")) {
        return [{ content: "const", color }, { content: line.slice("const".length) }];
      }
      return [{ content: line, color }];
    });
  }),
  createHighlighterMock: vi.fn(async () => ({
    codeToTokens: codeToTokensMock,
  })),
  copyTextToClipboardMock: vi.fn(async () => {}),
  listAvailableEditorsMock: vi.fn(async () => ({ editors: [], diffTools: [] })),
  paneStateMock: {
    preferredExternalEditor: null,
    preferredExternalDiffTool: null,
    terminalAppCommand: "",
    externalTools: [],
  } as {
    preferredExternalEditor: string | null;
    preferredExternalDiffTool: string | null;
    terminalAppCommand: string;
    externalTools: Array<{
      id: string;
      enabledForEditor?: boolean;
      enabledForDiff?: boolean;
    }>;
  },
  openContentInEditorMock: vi.fn(async () => ({ ok: true, error: null })),
  openDiffInEditorMock: vi.fn(async () => ({ ok: true, error: null })),
  openFileInEditorMock: vi.fn(async () => ({ ok: true, error: null })),
  openPathMock: vi.fn(async () => ({ ok: true, error: null })),
}));

vi.mock("shiki", () => ({
  createHighlighter: createHighlighterMock,
}));

vi.mock("../../lib/pathActions", () => ({
  listAvailableEditors: listAvailableEditorsMock,
  openContentInEditor: openContentInEditorMock,
  openDiffInEditor: openDiffInEditorMock,
  openFileInEditor: openFileInEditorMock,
  openPath: openPathMock,
}));

vi.mock("../../lib/clipboard", () => ({
  copyTextToClipboard: copyTextToClipboardMock,
}));

vi.mock("../../lib/codetrailClient", () => ({
  getCodetrailClient: () => ({
    platform: "darwin",
    invoke: vi.fn(async (channel: string) => {
      if (channel === "ui:getPaneState") {
        return paneStateMock;
      }
      return { ok: true };
    }),
  }),
}));

vi.mock("./toolParsing", () => ({
  tryParseJsonRecord(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  },
}));

import { PANE_STATE_UPDATED_EVENT } from "../../lib/paneStateEvents";
import { ViewerExternalAppsProvider } from "../../lib/viewerExternalAppsContext";
import {
  CodeBlock,
  DiffBlock,
  buildHighlightedTextNodes,
  detectLanguageFromContent,
  detectLanguageFromFilePath,
  escapeRegExp,
  isLikelyDiff,
  looksLikeLogContent,
  looksLikeMarkdown,
  normalizeTokenColorForContrast,
  renderMarkedSnippet,
  renderPlainText,
  renderRichText,
  resetContentViewerCachesForTests,
  tryFormatJson,
} from "./textRendering";

function renderNode(node: ReactNode): string {
  const rootHtml = renderToStaticMarkup(<div data-render-root="1">{node}</div>);
  return rootHtml.replace(/^<div data-render-root="1">/, "").replace(/<\/div>$/, "");
}

function renderNodes(nodes: ReactNode[]): string {
  const rootHtml = renderToStaticMarkup(<div data-render-root="1">{nodes}</div>);
  return rootHtml.replace(/^<div data-render-root="1">/, "").replace(/<\/div>$/, "");
}

describe("renderRichText", () => {
  it("renders GFM tables with header and body cells", () => {
    const markdown = [
      "| Directory | dux | du | Match |",
      "| --- | --- | --- | --- |",
      "| `/Users/acme/repo/src` | 325.9 MB | 326M | Yes |",
      "| `/Users/acme/repo/.venv` | 322.1 MB | 322M | Yes |",
    ].join("\n");

    const html = renderNodes(renderRichText(markdown, "", "table", ["/Users/acme/repo"]));

    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<th>Directory</th>");
    expect(html).toContain("<th>Match</th>");
    expect(html).toContain("<td>325.9 MB</td>");
    expect(html).toContain('class="md-link-local"');
    expect(html).toContain(">src<");
  });

  it("renders local markdown links as local path buttons when in project roots", () => {
    const markdown = "[Open docs](/Users/acme/repo/docs/guide.md)";

    const html = renderNodes(renderRichText(markdown, "", "local-link", ["/Users/acme/repo"]));

    expect(html).toContain("<button");
    expect(html).toContain('class="md-link-local"');
    expect(html).toContain(">Open docs<");
  });

  it("preserves lower-level markdown heading semantics", () => {
    const markdown = ["#### Four", "##### Five", "###### Six"].join("\n\n");

    const html = renderNodes(renderRichText(markdown, "", "headings"));

    expect(html).toContain("<h6");
    expect(html).toContain(">Four<");
    expect(html).toContain(">Five<");
    expect(html).toContain(">Six<");
    expect(html).not.toContain('<h5 class="md-h3">Four</h5>');
  });

  it("normalizes links with whitespace between bracket and parenthesis", () => {
    const markdown = "[Open docs] (/Users/acme/repo/docs/guide.md)";

    const html = renderNodes(renderRichText(markdown, "", "normalized-link", ["/Users/acme/repo"]));

    expect(html).toContain('class="md-link-local"');
    expect(html).toContain(">Open docs<");
  });

  it("renders external links with md-link styling", () => {
    const markdown = "[Project](https://example.com/repo)";

    const html = renderNodes(renderRichText(markdown, "", "external-link"));

    expect(html).toMatch(/<a[^>]*class="md-link"[^>]*href="https:\/\/example\.com\/repo"/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("highlights inline code matches that span punctuation-separated tokens", () => {
    const markdown = "`feat(history): add collapsible side panes`";

    const html = renderNodes(
      renderRichText(markdown, '"history add"', "inline-code-highlight", [], ["history add"]),
    );

    expect(html).toContain("<code><span>feat(</span><mark>history): add</mark>");
  });

  it("highlights external link labels without rewriting them into path links", () => {
    const markdown = "[history add](https://example.com/repo)";

    const html = renderNodes(
      renderRichText(markdown, '"history add"', "external-link-highlight", [], ["history add"]),
    );

    expect(html).toMatch(/<a[^>]*class="md-link"[^>]*>/);
    expect(html).toContain("<mark>history add</mark>");
    expect(html).not.toContain('class="md-link-local"');
  });

  it("highlights local link labels inside markdown buttons", () => {
    const markdown = "[history add](/Users/acme/repo/docs/guide.md)";

    const html = renderNodes(
      renderRichText(
        markdown,
        '"history add"',
        "local-link-highlight",
        ["/Users/acme/repo"],
        ["history add"],
      ),
    );

    expect(html).toContain('class="md-link-local"');
    expect(html).toContain("<mark>history add</mark>");
  });

  it("drops unsafe javascript links and keeps text", () => {
    const markdown = "[Unsafe](javascript:alert(1))";

    const html = renderNodes(renderRichText(markdown, "", "unsafe-link"));

    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("<span>Unsafe</span>");
  });

  it("escapes raw html tags in markdown input", () => {
    const markdown = "<script>alert(1)</script>";

    const html = renderNodes(renderRichText(markdown, "", "html-escape"));

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("script");
  });

  it("renders fenced code blocks with syntax classes", () => {
    const markdown = ["```ts", "const answer = 42", "```"].join("\n");

    const html = renderNodes(renderRichText(markdown, "", "code-block"));

    expect(html).toContain('class="code-block content-viewer');
    expect(html).toContain('class="code-meta content-viewer-header"');
    expect(html).toContain(">ts<");
    expect(html).toContain('class="tok-keyword">const</span>');
    expect(html).toContain('class="tok-number">42</span>');
  });

  it("renders source-reference fence headers as file path plus start line", () => {
    const markdown = [
      "```190:209:/Users/acme/repo/packages/core/src/search/searchMessages.ts",
      "function normalizeProviders(values: string[]): Provider[] {",
      "  return [];",
      "}",
      "```",
    ].join("\n");

    const html = renderNodes(renderRichText(markdown, "", "source-ref", ["/Users/acme/repo"]));

    expect(html).toContain('class="content-viewer-path"');
    expect(html).toContain(">packages/core/src/search/searchMessages.ts:190<");
    expect(html).toContain('class="tok-keyword">function</span>');
  });

  it("renders fenced diffs using diff table rows", () => {
    const markdown = [
      "```diff",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-const value = 1",
      "+const value = 2",
      "```",
    ].join("\n");

    const html = renderNodes(renderRichText(markdown, "", "diff-block"));

    expect(html).toContain('class="code-block diff-block content-viewer');
    expect(html).toContain('class="diff-table"');
    expect(html).toContain('class="diff-row diff-remove"');
    expect(html).toContain('class="diff-row diff-add"');
    expect(html).toContain('class="diff-word-remove"');
    expect(html).toContain('class="diff-word-add"');
    expect(html).toContain(">+1<");
    expect(html).toContain(">-1<");
    expect(html).not.toContain("diff --git a/a.ts b/a.ts");
    expect(html).not.toContain("--- a/a.ts");
    expect(html).not.toContain("+++ b/a.ts");
    expect(html).not.toContain("@@ -1,1 +1,1 @@");
    expect(html).not.toContain('class="diff-row diff-meta"');
  });

  it("trims project root prefix from diff file path in the diff header", () => {
    const html = renderNode(
      <DiffBlock
        codeValue={["-old", "+new"].join("\n")}
        filePath="/Users/acme/repo/src/module/file.ts"
        pathRoots={["/Users/acme/repo"]}
      />,
    );

    expect(html).toContain(">src/module/file.ts<");
  });
});

describe("renderPlainText", () => {
  it("renders empty lines and highlights query text", () => {
    const text = "first line\n\nsecond line";

    const html = renderNodes(renderPlainText(text, "second", "plain", []));

    expect(html).toContain('class="md-p">');
    expect(html).toContain('class="md-empty"');
    expect(html).toContain("<mark>second</mark>");
  });

  it("turns in-root absolute paths into local path buttons", () => {
    const text = "Open /Users/acme/repo/src/main.ts please.";

    const html = renderNodes(renderPlainText(text, "", "path", ["/Users/acme/repo"]));

    expect(html).toContain('class="md-link-local"');
    expect(html).toContain(">src/main.ts<");
  });

  it("keeps out-of-root absolute paths as plain text", () => {
    const text = "Ignored path: /Users/other/secret.txt";

    const html = renderNodes(renderPlainText(text, "", "path", ["/Users/acme/repo"]));

    expect(html).not.toContain('class="md-link-local"');
    expect(html).toContain("/Users/other/secret.txt");
  });
});

describe("theme-aware Shiki rendering", () => {
  beforeEach(() => {
    resetContentViewerCachesForTests();
  });

  it("preserves italic styling when Shiki emits bold+italic bitmasks", async () => {
    codeToTokensMock.mockImplementationOnce(() => [
      [{ content: "const", color: "rgb(96, 165, 250)", fontStyle: 3 }],
    ]);

    render(<CodeBlock language="ts" codeValue="const value = 1" />);

    await waitFor(() => {
      const style = screen.getByText("const").getAttribute("style") ?? "";
      expect(style).toContain("font-style: italic");
      expect(style).toContain("font-weight: 650");
    });
  });

  it("keeps the active dark viewer theme across dark app themes and switches on family change", async () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.themeVariant = "dark";
    delete document.documentElement.dataset.shikiTheme;

    render(<CodeBlock language="ts" codeValue="const value = 1" />);

    await waitFor(() => {
      expect(screen.getByText("const").getAttribute("style")).toContain("rgb(96, 165, 250)");
    });

    await act(async () => {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.dataset.themeVariant = "ft-dark";
    });
    await waitFor(() => {
      expect(screen.getByText("const").getAttribute("style")).toContain("rgb(96, 165, 250)");
    });

    await act(async () => {
      document.documentElement.dataset.theme = "light";
      document.documentElement.dataset.themeVariant = "light";
    });
    await waitFor(() => {
      expect(screen.getByText("const").getAttribute("style")).toContain("rgb(9, 105, 218)");
    });
  });

  it("uses the explicit Shiki override instead of the paired app theme", async () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.themeVariant = "dark";
    document.documentElement.dataset.shikiTheme = "night-owl";

    render(<CodeBlock language="ts" codeValue="const value = 1" />);

    await waitFor(() => {
      expect(screen.getByText("const").getAttribute("style")).toContain("rgb(129, 230, 217)");
    });

    await act(async () => {
      document.documentElement.dataset.shikiTheme = "vesper";
    });

    await waitFor(() => {
      expect(screen.getByText("const").getAttribute("style")).toContain("rgb(248, 189, 96)");
    });
  });

  it("falls back to the paired Shiki theme when the selected theme is unavailable", async () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.themeVariant = "dark";
    document.documentElement.dataset.shikiTheme = "missing-theme";

    render(<CodeBlock language="ts" codeValue="const value = 1" />);

    await waitFor(() => {
      expect(screen.getByText("const").getAttribute("style")).toContain("rgb(96, 165, 250)");
    });
  });

  it("defers split diff tokenization until the user toggles views", async () => {
    codeToTokensMock.mockClear();
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.themeVariant = "dark";
    document.documentElement.dataset.defaultDiffViewMode = "unified";

    const { container } = render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    await waitFor(() => {
      expect(codeToTokensMock.mock.calls.length).toBeGreaterThan(0);
    });
    const initialCallCount = codeToTokensMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Unified" }));

    await waitFor(() => {
      expect(codeToTokensMock.mock.calls.length).toBe(initialCallCount + 2);
    });
  });

  it("uses configured default wrap and diff view settings", async () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.themeVariant = "dark";
    document.documentElement.dataset.defaultViewerWrapMode = "wrap";
    document.documentElement.dataset.defaultDiffViewMode = "split";
    resetContentViewerCachesForTests();

    const { container } = render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Wrap" })).toBeInTheDocument();
    });
  });

  it("switches the rendered layout when toggling between unified and split diff views", async () => {
    document.documentElement.dataset.defaultDiffViewMode = "unified";
    resetContentViewerCachesForTests();

    const { container } = render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unified" })).toBeInTheDocument();
    });
    expect(document.querySelectorAll(".diff-row").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".diff-split-row")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Unified" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
      expect(document.querySelectorAll(".diff-split-row").length).toBeGreaterThan(0);
    });
    expect(document.querySelectorAll(".diff-row")).toHaveLength(0);
  });

  it("resets a rerendered diff viewer back to the configured default view mode", async () => {
    document.documentElement.dataset.defaultDiffViewMode = "unified";
    resetContentViewerCachesForTests();

    const { rerender } = render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unified" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Unified" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
      expect(document.querySelectorAll(".diff-split-row").length).toBeGreaterThan(0);
    });

    rerender(
      <DiffBlock
        codeValue={[
          "diff --git a/b.ts b/b.ts",
          "--- a/b.ts",
          "+++ b/b.ts",
          "@@ -1,1 +1,1 @@",
          "-export const beforeValue = 1;",
          "+export const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/b.ts"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unified" })).toBeInTheDocument();
      expect(document.querySelectorAll(".diff-row").length).toBeGreaterThan(0);
    });
    expect(document.querySelectorAll(".diff-split-row")).toHaveLength(0);
  });

  it("renders split diffs with inserted JSX lines as standalone add rows", async () => {
    document.documentElement.dataset.defaultDiffViewMode = "split";
    resetContentViewerCachesForTests();

    const { container } = render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.tsx b/a.tsx",
          "--- a/a.tsx",
          "+++ b/a.tsx",
          "@@ -1,3 +1,5 @@",
          '-<span className="content-viewer-path" title={metaPath ?? undefined}>',
          "-  {displayedMetaPath}",
          "-</span>",
          '+<span className="content-viewer-path">',
          '+  <span className="content-viewer-path-text" title={metaPath ?? undefined}>',
          "+    {displayedMetaPath}",
          "+  </span>",
          "+</span>",
        ].join("\n")}
        filePath="/Users/acme/repo/a.tsx"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
    });

    const rows = Array.from(document.querySelectorAll(".diff-split-row"));
    expect(rows).toHaveLength(5);

    expect(rows[0]?.querySelector(".diff-remove")).not.toBeNull();
    expect(rows[0]?.querySelector(".diff-add")).not.toBeNull();
    expect(rows[1]?.querySelector(".diff-remove")).toBeNull();
    expect(rows[1]?.querySelector(".diff-add")).not.toBeNull();
    expect(rows[1]?.textContent).toContain("content-viewer-path-text");
  });

  it("collapses diff blocks without falling back to raw diff content", async () => {
    render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
        collapsible
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse diff for a.ts" })).toBeInTheDocument();
    expect(document.querySelector(".content-viewer-body")).not.toBeNull();
    expect(document.querySelector(".diff-table")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse diff for a.ts" }));

    expect(screen.getByRole("button", { name: "Expand diff for a.ts" })).toBeInTheDocument();
    expect(document.querySelector(".content-viewer-body")).toBeNull();
    expect(screen.queryByText("diff --git a/a.ts b/a.ts")).toBeNull();
  });

  it("toggles collapsible diffs when the filename is clicked", () => {
    render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
        collapsible
      />,
    );

    fireEvent.click(screen.getByText("/Users/acme/repo/a.ts"));

    expect(screen.getByRole("button", { name: "Expand diff for a.ts" })).toBeInTheDocument();
    expect(document.querySelector(".content-viewer-body")).toBeNull();
  });

  it("renders large expanded diffs with exact layout after Show Rest", async () => {
    const lines = Array.from({ length: 2000 }, (_, index) => `+line ${index + 1}`);
    document.documentElement.dataset.defaultViewerWrapMode = "nowrap";
    document.documentElement.dataset.defaultDiffViewMode = "split";
    render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,2000 +1,2000 @@",
          ...lines,
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    const showRest = screen.getByRole("button", { name: "Show Rest" });
    fireEvent.click(showRest);

    await waitFor(() => {
      const renderedRows = document.querySelectorAll(".diff-split-row");
      expect(renderedRows.length).toBeGreaterThan(1900);
      expect(screen.getByText("line 1")).toBeInTheDocument();
      expect(screen.getByText("line 1500")).toBeInTheDocument();
    });
  });

  it("orders diff actions as Open, Open With, Diff, Diff With", async () => {
    resetContentViewerCachesForTests();
    listAvailableEditorsMock.mockResolvedValue({
      editors: [
        {
          id: "editor:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/local/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
      diffTools: [
        {
          id: "diff:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          detected: true,
          command: "/usr/local/bin/zed",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
    } as never);

    render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    await screen.findByRole("button", { name: "Open With" });
    await screen.findByRole("button", { name: "Diff With" });

    const openButton = screen.getByRole("button", { name: "Open" });
    const openWithButton = screen.getByRole("button", { name: "Open With" });
    const diffButton = screen.getByRole("button", { name: "Diff" });
    const diffWithButton = screen.getByRole("button", { name: "Diff With" });

    expect(openButton.compareDocumentPosition(openWithButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(openWithButton.compareDocumentPosition(diffButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(diffButton.compareDocumentPosition(diffWithButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("does not render a diff kind pill for diff viewers", () => {
    render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-before",
          "+after",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    expect(screen.queryByText("DIFF")).not.toBeInTheDocument();
  });
});

describe("looksLikeMarkdown", () => {
  it("detects markdown headings, lists, links, and emphasis", () => {
    expect(looksLikeMarkdown("# Header")).toBe(true);
    expect(looksLikeMarkdown("- list item")).toBe(true);
    expect(looksLikeMarkdown("[label](https://example.com)")).toBe(true);
    expect(looksLikeMarkdown("this is **bold**")).toBe(true);
  });

  it("detects fenced code blocks", () => {
    expect(looksLikeMarkdown("```ts\nconst x = 1\n```")).toBe(true);
  });

  it("returns false for non-markdown plain text", () => {
    expect(looksLikeMarkdown("just a plain sentence with /some/path")).toBe(false);
    expect(looksLikeMarkdown("")).toBe(false);
    expect(looksLikeMarkdown("   ")).toBe(false);
  });
});

describe("language detection", () => {
  it("detects language from content", () => {
    expect(detectLanguageFromContent("")).toBe("text");
    expect(detectLanguageFromContent('{"a":1}')).toBe("json");
    expect(detectLanguageFromContent("[1,2,3]")).toBe("json");
    expect(detectLanguageFromContent("[not json at all")).toBe("text");
    expect(detectLanguageFromContent("<html><body></body></html>")).toBe("html");
    expect(detectLanguageFromContent("@@ -1,1 +1,1 @@\n-a\n+b")).toBe("diff");
  });

  it("detects log-like multi-line content", () => {
    expect(
      looksLikeLogContent(
        [
          "2026-03-23 10:00:00 INFO starting worker",
          "2026-03-23 10:00:01 WARN retrying connection",
          "2026-03-23 10:00:02 ERROR failed to connect",
        ].join("\n"),
      ),
    ).toBe(true);
    expect(looksLikeLogContent("plain\ntext\nwithout\nmarkers")).toBe(false);
  });

  it("detects language from file path extension", () => {
    expect(detectLanguageFromFilePath("index.ts")).toBe("typescript");
    expect(detectLanguageFromFilePath("index.jsx")).toBe("javascript");
    expect(detectLanguageFromFilePath("script.py")).toBe("python");
    expect(detectLanguageFromFilePath("data.json")).toBe("json");
    expect(detectLanguageFromFilePath("styles.css")).toBe("css");
    expect(detectLanguageFromFilePath("page.html")).toBe("html");
    expect(detectLanguageFromFilePath("query.sql")).toBe("sql");
    expect(detectLanguageFromFilePath("README.md")).toBe("markdown");
    expect(detectLanguageFromFilePath("build.sh")).toBe("shell");
    expect(detectLanguageFromFilePath("README")).toBe("text");
    expect(detectLanguageFromFilePath(null)).toBe("text");
  });
});

describe("diff detection", () => {
  it("identifies likely diff by explicit language marker", () => {
    expect(isLikelyDiff("diff", "const a = 1")).toBe(true);
    expect(isLikelyDiff("patch", "const a = 1")).toBe(true);
  });

  it("identifies likely diff by strong diff markers", () => {
    const value = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@"].join(
      "\n",
    );
    expect(isLikelyDiff("", value)).toBe(true);
  });

  it("identifies likely diff by balanced add/remove/context lines", () => {
    const value = ["-old line", "+new line", " context", " another context"].join("\n");
    expect(isLikelyDiff("", value)).toBe(true);
  });

  it("does not classify plain text as diff", () => {
    expect(isLikelyDiff("", "one\ntwo\nthree")).toBe(false);
  });
});

describe("text helpers", () => {
  it("highlights all case-insensitive query matches", () => {
    const html = renderNodes(buildHighlightedTextNodes("Alpha alpha ALPHA", "alpha", "hl"));
    const markCount = (html.match(/<mark>/g) ?? []).length;

    expect(markCount).toBe(3);
  });

  it("highlights wildcard query matches", () => {
    const html = renderNodes(
      buildHighlightedTextNodes("focus focuses discuss fzzzus", "fo* *cus f*us", "hl-wild"),
    );

    expect(html).toContain("<mark>focus</mark>");
    expect(html).toMatch(/<mark>[^<]*cus[^<]*<\/mark>/);
  });

  it("highlights punctuation-separated query terms as FTS token boundaries", () => {
    const html = renderNodes(
      buildHighlightedTextNodes(
        "we should focus on something concrete",
        "focus+on+something",
        "hl-plus",
      ),
    );

    expect(html).toContain("<mark>focus on something</mark>");
  });

  it("highlights postfix wildcard with punctuation-separated phrase tokens", () => {
    const html = renderNodes(
      buildHighlightedTextNodes("keep focus on somethingElse now", "focus+on+some*", "hl-plus-wc"),
    );

    expect(html).toContain("<mark>focus on somethingElse</mark>");
  });

  it("escapes regex metacharacters in queries", () => {
    expect(escapeRegExp("a+b*c?.[x]")).toBe("a\\+b\\*c\\?\\.\\[x\\]");
  });

  it("renders mark-tag snippets into mark elements", () => {
    const html = renderNode(renderMarkedSnippet("a <mark>hit</mark> b"));

    expect(html).toContain("<mark>hit</mark>");
    expect(html).toContain("<span>a </span>");
    expect(html).toContain("<span> b</span>");
  });

  it("formats valid json and preserves invalid json", () => {
    expect(tryFormatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(tryFormatJson("{oops")).toBe("{oops");
  });

  it("darkens low-contrast token colors against light code backgrounds", () => {
    expect(normalizeTokenColorForContrast("#8cb4ff", "#fafbfe", "#1a1c24")).not.toBe("#8cb4ff");
  });

  it("preserves already-readable token colors", () => {
    expect(normalizeTokenColorForContrast("#0f766e", "#fafbfe", "#1a1c24")).toBe("#0f766e");
  });
});

describe("CodeBlock", () => {
  it("highlights phrase matches inside code lines", () => {
    const html = renderNode(
      <CodeBlock
        language="text"
        codeValue="feat(history): add collapsible side panes"
        query={'"history add"'}
        highlightPatterns={["history add"]}
      />,
    );

    expect(html).toContain("<mark>history): add</mark>");
  });

  it("highlights diff content when a query is active", () => {
    const html = renderNode(
      <CodeBlock
        language="diff"
        codeValue={["-feat(history): remove panes", "+feat(history): add panes"].join("\n")}
        query={'"history add"'}
        highlightPatterns={["history add"]}
      />,
    );

    expect(html).toContain("<mark>history): add</mark>");
  });

  it("opens viewer content from the Open With menu and preserves focus", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.externalTools = [];
    listAvailableEditorsMock.mockResolvedValue({
      editors: [
        {
          id: "editor:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/local/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
        {
          id: "editor:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          detected: true,
          command: "/usr/local/bin/zed",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
      diffTools: [
        {
          id: "diff:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          detected: true,
          command: "/usr/local/bin/zed",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
    } as never);
    openContentInEditorMock.mockClear();

    render(
      <div tabIndex={-1} data-testid="focus-host">
        <CodeBlock language="json" codeValue='{"value": 1}' />
      </div>,
    );

    const focusHost = screen.getByTestId("focus-host");
    focusHost.focus();
    expect(document.activeElement).toBe(focusHost);

    const menuButton = await screen.findByRole("button", { name: "Open With" });
    fireEvent.mouseDown(menuButton);
    fireEvent.click(menuButton);
    expect(screen.queryByText(/Detected/i)).not.toBeInTheDocument();
    fireEvent.mouseDown(await screen.findByRole("menuitem", { name: /Zed/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Zed/i }));

    await waitFor(() => {
      expect(openContentInEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({ editorId: "editor:zed" }),
      );
    });
    expect(document.activeElement).toBe(focusHost);
  });

  it("supports keyboard navigation and menuitem roles in the viewer app menu", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.externalTools = [];
    listAvailableEditorsMock.mockResolvedValue({
      editors: [
        {
          id: "editor:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/local/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
        {
          id: "editor:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          detected: true,
          command: "/usr/local/bin/zed",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
      diffTools: [
        {
          id: "diff:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          detected: true,
          command: "/usr/local/bin/zed",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
    } as never);
    openContentInEditorMock.mockClear();

    render(<CodeBlock language="json" codeValue='{"value": 1}' />);

    const menuButton = await screen.findByRole("button", { name: "Open With" });
    menuButton.focus();
    fireEvent.keyDown(menuButton, { key: "ArrowDown" });

    const menu = await screen.findByRole("menu", { name: "Open With" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    const secondItem = items[1];
    expect(secondItem).toBeDefined();
    fireEvent.click(secondItem!);

    await waitFor(() => {
      expect(openContentInEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({ editorId: "editor:zed" }),
      );
    });
    expect(menuButton).toHaveFocus();
  });

  it("shows the rest of large non-diff viewers with a single Show Rest action", () => {
    const codeValue = Array.from({ length: 850 }, (_, index) => `line ${index + 1}`).join("\n");
    render(<CodeBlock language="text" codeValue={codeValue} />);

    expect(screen.getByText("line 1")).toBeInTheDocument();
    expect(screen.queryByText("line 850")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show Rest" }));
    expect(screen.getByText("line 850")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show Rest" })).toBeNull();
  });

  it("opens viewer content with the default Open action", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.externalTools = [];
    listAvailableEditorsMock.mockResolvedValue({
      editors: [
        {
          id: "editor:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/local/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
      diffTools: [
        {
          id: "diff:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          detected: true,
          command: "/usr/local/bin/zed",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
    } as never);
    openContentInEditorMock.mockClear();

    render(<CodeBlock language="json" codeValue='{"value": 1}' metaLabel="payload.json" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(openContentInEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "payload.json",
          language: "json",
          content: '{"value": 1}',
        }),
      );
    });
  });

  it("opens diffs from the Diff With menu", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.externalTools = [];
    listAvailableEditorsMock.mockResolvedValue({
      editors: [],
      diffTools: [
        {
          id: "diff:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/local/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
        {
          id: "diff:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          detected: true,
          command: "/usr/local/bin/zed",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
    } as never);
    openDiffInEditorMock.mockClear();

    render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    const menuButton = await screen.findByRole("button", { name: "Diff With" });
    fireEvent.mouseDown(menuButton);
    fireEvent.click(menuButton);
    expect(screen.queryByText(/Detected/i)).not.toBeInTheDocument();
    fireEvent.mouseDown(await screen.findByRole("menuitem", { name: /Zed/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Zed/i }));

    await waitFor(() => {
      expect(openDiffInEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({ editorId: "diff:zed" }),
      );
    });
  });

  it("opens diffs with the default Diff action", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.externalTools = [];
    listAvailableEditorsMock.mockResolvedValue({
      editors: [],
      diffTools: [
        {
          id: "diff:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/local/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
    } as never);
    openDiffInEditorMock.mockClear();

    render(
      <DiffBlock
        codeValue={[
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Diff" }));

    await waitFor(() => {
      expect(openDiffInEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "/Users/acme/repo/a.ts",
          filePath: "/Users/acme/repo/a.ts",
        }),
      );
    });
  });

  it("adds explicit edit separators when opening sequenced diffs externally", async () => {
    resetContentViewerCachesForTests();
    openContentInEditorMock.mockClear();
    openDiffInEditorMock.mockClear();
    openFileInEditorMock.mockClear();
    paneStateMock.externalTools = [{ id: "editor:vscode" }, { id: "diff:vscode" }];
    listAvailableEditorsMock.mockResolvedValue({
      editors: [
        {
          id: "editor:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/local/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
      diffTools: [
        {
          id: "diff:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/local/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
    } as never);

    render(
      <DiffBlock
        codeValue={[
          "Edit 1 of 2 | +1 -1 | 12:50:11 PM",
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Diff" }));

    await waitFor(() => {
      expect(openContentInEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "/Users/acme/repo/a.ts",
          language: "diff",
          content: expect.stringContaining(
            "=========== Edit 1 of 2 · +1 -1 · 12:50:11 PM ===========",
          ),
        }),
      );
      expect(openFileInEditorMock).not.toHaveBeenCalled();
      expect(openDiffInEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          leftContent: expect.stringContaining(
            "=========== Edit 1 of 2 · +1 -1 · 12:50:11 PM ===========",
          ),
          rightContent: expect.stringContaining(
            "=========== Edit 1 of 2 · +1 -1 · 12:50:11 PM ===========",
          ),
        }),
      );
    });
  });

  it("copies sequenced diffs using external marker formatting", async () => {
    resetContentViewerCachesForTests();
    copyTextToClipboardMock.mockClear();

    render(
      <DiffBlock
        codeValue={[
          "Edit 1 of 2 | +1 -1 | 12:50:11 PM",
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith(
        [
          "=========== Edit 1 of 2 · +1 -1 · 12:50:11 PM ===========",
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n"),
      );
    });
  });

  it("allows collapsing and expanding individual sequence edit sections", async () => {
    resetContentViewerCachesForTests();

    const { container } = render(
      <DiffBlock
        codeValue={[
          "Edit 1 of 2 | +1 -1 | 12:50:11 PM",
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
          "Edit 2 of 2 | +1 -1 | 12:51:12 PM",
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -2,1 +2,1 @@",
          "-const secondBefore = 1;",
          "+const secondAfter = 2;",
        ].join("\n")}
        filePath="/Users/acme/repo/a.ts"
      />,
    );

    expect(container.textContent).toContain("const beforeValue = 1;");
    expect(container.textContent).toContain("const secondBefore = 1;");

    fireEvent.click(screen.getByRole("button", { name: /collapse edit 1 of 2/i }));

    await waitFor(() => {
      expect(container.textContent).not.toContain("const beforeValue = 1;");
      expect(container.textContent).not.toContain("const afterValue = 2;");
      expect(container.textContent).toContain("const secondBefore = 1;");
    });

    fireEvent.click(screen.getByRole("button", { name: /expand edit 1 of 2/i }));

    await waitFor(() => {
      expect(container.textContent).toContain("const beforeValue = 1;");
      expect(container.textContent).toContain("const afterValue = 2;");
    });
  });

  it("resolves relative diff header paths into actionable viewer controls", async () => {
    resetContentViewerCachesForTests();
    openFileInEditorMock.mockClear();
    openDiffInEditorMock.mockClear();
    openPathMock.mockClear();
    paneStateMock.externalTools = [];
    listAvailableEditorsMock.mockResolvedValue({
      editors: [
        {
          id: "editor:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/local/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
      diffTools: [
        {
          id: "diff:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          detected: true,
          command: "/usr/local/bin/zed",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
    } as never);

    render(
      <DiffBlock
        codeValue={[
          "diff --git a/src/a.ts b/src/a.ts",
          "--- a/src/a.ts",
          "+++ b/src/a.ts",
          "@@ -1,1 +1,1 @@",
          "-const beforeValue = 1;",
          "+const afterValue = 2;",
        ].join("\n")}
        pathRoots={["/Users/acme/repo"]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    });
    await screen.findByRole("button", { name: "Diff" });

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    await waitFor(() => {
      expect(openFileInEditorMock).toHaveBeenCalledWith(
        "/Users/acme/repo/src/a.ts",
        expect.objectContaining({ editorId: "editor:vscode" }),
      );
      expect(openDiffInEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: "/Users/acme/repo/src/a.ts",
          title: "src/a.ts",
        }),
      );
      expect(openPathMock).toHaveBeenCalledWith("/Users/acme/repo/src/a.ts");
    });

    expect(screen.getByRole("button", { name: "Open With" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument();
  });

  it("orders Open With menu items using the saved external tool order", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.externalTools = [
      { id: "editor:zed" },
      { id: "editor:textedit" },
      { id: "editor:nvim" },
    ];
    listAvailableEditorsMock.mockResolvedValue({
      editors: [
        {
          id: "editor:nvim",
          kind: "known",
          label: "Neovim",
          appId: "neovim",
          detected: true,
          command: "/opt/homebrew/bin/nvim",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
        {
          id: "editor:textedit",
          kind: "custom",
          label: "TextEdit",
          appId: null,
          detected: true,
          command: "/System/Applications/TextEdit.app",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: false,
          },
        },
        {
          id: "editor:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          detected: true,
          command: "/usr/local/bin/zed",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
      diffTools: [],
    } as never);

    render(<CodeBlock language="json" codeValue='{"value": 1}' />);

    const menuButton = await screen.findByRole("button", { name: "Open With" });
    fireEvent.mouseDown(menuButton);
    fireEvent.click(menuButton);

    const menu = await screen.findByRole("menu", { name: "Open With" });
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((item: HTMLElement) => item.textContent?.trim());

    expect(labels).toEqual(["Zed", "TextEdit", "Neovim"]);
  });

  it("updates Open With ordering after settings change without restarting", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.preferredExternalEditor = null;
    paneStateMock.preferredExternalDiffTool = null;
    paneStateMock.externalTools = [];
    const allEditors = [
      {
        id: "editor:nvim",
        kind: "known",
        label: "Neovim",
        appId: "neovim",
        detected: true,
        command: "/opt/homebrew/bin/nvim",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: true,
        },
      },
      {
        id: "editor:zed",
        kind: "known",
        label: "Zed",
        appId: "zed",
        detected: true,
        command: "/usr/local/bin/zed",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: true,
        },
      },
      {
        id: "editor:textedit",
        kind: "custom",
        label: "TextEdit",
        appId: null,
        detected: true,
        command: "/System/Applications/TextEdit.app",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: false,
        },
      },
    ];
    listAvailableEditorsMock.mockImplementation(
      async (options?: { externalTools?: Array<{ id: string }> }) => {
        const allowedIds = new Set(options?.externalTools?.map((tool) => tool.id) ?? []);
        return {
          editors: allEditors.filter(
            (editor) => allowedIds.size === 0 || allowedIds.has(editor.id),
          ),
          diffTools: [],
        } as never;
      },
    );

    render(<CodeBlock language="json" codeValue='{"value": 1}' />);
    await screen.findByRole("button", { name: "Open With" });

    paneStateMock.externalTools = [
      { id: "editor:zed" },
      { id: "editor:textedit" },
      { id: "editor:nvim" },
    ];
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PANE_STATE_UPDATED_EVENT, {
          detail: {
            preferredExternalEditor: null,
            preferredExternalDiffTool: null,
            terminalAppCommand: "",
            externalTools: paneStateMock.externalTools,
          },
        }),
      );
    });

    const menuButton = await screen.findByRole("button", { name: "Open With" });
    fireEvent.mouseDown(menuButton);
    fireEvent.click(menuButton);

    const menu = await screen.findByRole("menu", { name: "Open With" });
    await waitFor(() => {
      const labels = within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement) => item.textContent?.trim());
      expect(labels).toEqual(["Zed", "TextEdit", "Neovim"]);
    });
  });

  it("uses saved external tools on the first viewer load", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.preferredExternalEditor = "tool:zed";
    paneStateMock.preferredExternalDiffTool = "tool:zed";
    paneStateMock.terminalAppCommand = "/Applications/kitty.app";
    paneStateMock.externalTools = [
      { id: "tool:vscode", enabledForEditor: false, enabledForDiff: false },
      { id: "tool:cursor", enabledForEditor: false, enabledForDiff: false },
      { id: "tool:zed", enabledForEditor: true, enabledForDiff: true },
      { id: "tool:neovim", enabledForEditor: true, enabledForDiff: true },
      { id: "tool:sublime_text", enabledForEditor: true, enabledForDiff: false },
      { id: "tool:text_edit", enabledForEditor: true, enabledForDiff: false },
      { id: "custom:textedit2", enabledForEditor: true, enabledForDiff: false },
      { id: "custom:ag", enabledForEditor: true, enabledForDiff: true },
      { id: "custom:ag2", enabledForEditor: true, enabledForDiff: false },
    ];
    const allEditors = [
      {
        id: "tool:vscode",
        kind: "known",
        label: "VS Code",
        appId: "vscode",
        detected: true,
        command: "/usr/local/bin/code",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: true,
        },
      },
      {
        id: "tool:cursor",
        kind: "known",
        label: "Cursor",
        appId: "cursor",
        detected: true,
        command: "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: true,
        },
      },
      {
        id: "tool:zed",
        kind: "known",
        label: "Zed",
        appId: "zed",
        detected: true,
        command: "/usr/local/bin/zed",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: true,
        },
      },
      {
        id: "tool:neovim",
        kind: "known",
        label: "Neovim",
        appId: "neovim",
        detected: true,
        command: "/opt/homebrew/bin/nvim",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: true,
        },
      },
      {
        id: "tool:sublime_text",
        kind: "known",
        label: "Sublime Text",
        appId: "sublime_text",
        detected: true,
        command: "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: false,
        },
      },
      {
        id: "tool:text_edit",
        kind: "known",
        label: "Text Edit",
        appId: "text_edit",
        detected: true,
        command: "/System/Applications/TextEdit.app",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: false,
          openContent: true,
          openDiff: false,
        },
      },
      {
        id: "custom:textedit2",
        kind: "custom",
        label: "Text Edit 2",
        appId: null,
        detected: true,
        command: "/System/Applications/TextEdit.app",
        args: ["{file}"],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: false,
        },
      },
      {
        id: "custom:ag",
        kind: "custom",
        label: "AG",
        appId: null,
        detected: true,
        command: "/Applications/Antigravity.app",
        args: ["{file}"],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: false,
        },
      },
      {
        id: "custom:ag2",
        kind: "custom",
        label: "AG 2",
        appId: null,
        detected: true,
        command: "/Applications/Affinity.app",
        args: ["{file}"],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: false,
        },
      },
    ];
    listAvailableEditorsMock.mockImplementation(
      async (options?: {
        externalTools?: Array<{ id: string; enabledForEditor?: boolean; enabledForDiff?: boolean }>;
      }) => {
        const allowedEditorIds = new Set(
          options?.externalTools
            ?.filter((tool) => tool.enabledForEditor !== false)
            .map((tool) => tool.id) ?? [],
        );
        return {
          editors: allEditors.filter((editor) => allowedEditorIds.has(editor.id)),
          diffTools: [],
        } as never;
      },
    );

    render(<CodeBlock language="json" codeValue='{"value": 1}' />);

    const menuButton = await screen.findByRole("button", { name: "Open With" });
    fireEvent.mouseDown(menuButton);
    fireEvent.click(menuButton);

    const menu = await screen.findByRole("menu", { name: "Open With" });
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((item: HTMLElement) => item.textContent?.trim());

    expect(labels).toEqual([
      "Zed",
      "Neovim",
      "Sublime Text",
      "Text Edit",
      "Text Edit 2",
      "AG",
      "AG 2",
    ]);
    expect(listAvailableEditorsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalTools: paneStateMock.externalTools,
      }),
    );
  });

  it("uses the app-provided compare-instance external tools for Open With menus", async () => {
    resetContentViewerCachesForTests();
    listAvailableEditorsMock.mockClear();
    listAvailableEditorsMock.mockImplementation(async () => {
      throw new Error("viewer fallback loader should not run when app state is provided");
    });

    render(
      <ViewerExternalAppsProvider
        value={{
          editors: [
            {
              id: "tool:zed",
              kind: "known",
              label: "Zed",
              appId: "zed",
              detected: true,
              command: "/usr/local/bin/zed",
              args: [],
              capabilities: {
                openFile: true,
                openAtLineColumn: true,
                openContent: true,
                openDiff: true,
              },
            },
            {
              id: "tool:neovim",
              kind: "known",
              label: "Neovim",
              appId: "neovim",
              detected: true,
              command: "/opt/homebrew/bin/nvim",
              args: [],
              capabilities: {
                openFile: true,
                openAtLineColumn: true,
                openContent: true,
                openDiff: true,
              },
            },
            {
              id: "tool:sublime_text",
              kind: "known",
              label: "Sublime Text",
              appId: "sublime_text",
              detected: true,
              command: "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
              args: [],
              capabilities: {
                openFile: true,
                openAtLineColumn: true,
                openContent: true,
                openDiff: false,
              },
            },
            {
              id: "tool:text_edit",
              kind: "known",
              label: "Text Edit",
              appId: "text_edit",
              detected: true,
              command: "/System/Applications/TextEdit.app",
              args: [],
              capabilities: {
                openFile: true,
                openAtLineColumn: false,
                openContent: true,
                openDiff: false,
              },
            },
            {
              id: "custom:mn23v6h7:5adef",
              kind: "custom",
              label: "Text Edit 2",
              appId: null,
              detected: true,
              command: "/System/Applications/TextEdit.app",
              args: ["{file}"],
              capabilities: {
                openFile: true,
                openAtLineColumn: true,
                openContent: true,
                openDiff: false,
              },
            },
            {
              id: "custom:mn27y83n:g6zh5",
              kind: "custom",
              label: "AG",
              appId: null,
              detected: true,
              command: "/Applications/Antigravity.app",
              args: ["{file}"],
              capabilities: {
                openFile: true,
                openAtLineColumn: true,
                openContent: true,
                openDiff: true,
              },
            },
            {
              id: "custom:mn27yqfa:69sjo",
              kind: "custom",
              label: "AG 2",
              appId: null,
              detected: true,
              command: "/Applications/Affinity.app",
              args: ["{file}"],
              capabilities: {
                openFile: true,
                openAtLineColumn: true,
                openContent: true,
                openDiff: false,
              },
            },
          ],
          diffTools: [
            {
              id: "tool:zed",
              kind: "known",
              label: "Zed",
              appId: "zed",
              detected: true,
              command: "/usr/local/bin/zed",
              args: [],
              capabilities: {
                openFile: true,
                openAtLineColumn: true,
                openContent: true,
                openDiff: true,
              },
            },
            {
              id: "tool:neovim",
              kind: "known",
              label: "Neovim",
              appId: "neovim",
              detected: true,
              command: "/opt/homebrew/bin/nvim",
              args: [],
              capabilities: {
                openFile: true,
                openAtLineColumn: true,
                openContent: true,
                openDiff: true,
              },
            },
            {
              id: "custom:mn27y83n:g6zh5",
              kind: "custom",
              label: "AG",
              appId: null,
              detected: true,
              command: "/Applications/Antigravity.app",
              args: ["{left}", "{right}"],
              capabilities: {
                openFile: true,
                openAtLineColumn: true,
                openContent: true,
                openDiff: true,
              },
            },
          ],
          preferences: {
            preferredExternalEditor: "tool:zed",
            preferredExternalDiffTool: "tool:zed",
            terminalAppCommand: "/Applications/kitty.app",
            orderedToolIds: [
              "tool:vscode",
              "tool:cursor",
              "tool:text_edit",
              "tool:zed",
              "tool:neovim",
              "tool:sublime_text",
              "custom:mn23v6h7:5adef",
              "custom:mn27y83n:g6zh5",
              "custom:mn27yqfa:69sjo",
            ],
            externalTools: [
              {
                id: "tool:vscode",
                kind: "known",
                label: "VS Code",
                appId: "vscode",
                command: "",
                editorArgs: [],
                diffArgs: [],
                enabledForEditor: false,
                enabledForDiff: false,
              },
              {
                id: "tool:cursor",
                kind: "known",
                label: "Cursor",
                appId: "cursor",
                command: "",
                editorArgs: [],
                diffArgs: [],
                enabledForEditor: false,
                enabledForDiff: false,
              },
              {
                id: "tool:text_edit",
                kind: "known",
                label: "Text Edit",
                appId: "text_edit",
                command: "",
                editorArgs: [],
                diffArgs: [],
                enabledForEditor: true,
                enabledForDiff: false,
              },
              {
                id: "tool:zed",
                kind: "known",
                label: "Zed",
                appId: "zed",
                command: "",
                editorArgs: [],
                diffArgs: [],
                enabledForEditor: true,
                enabledForDiff: true,
              },
              {
                id: "tool:neovim",
                kind: "known",
                label: "Neovim",
                appId: "neovim",
                command: "",
                editorArgs: [],
                diffArgs: [],
                enabledForEditor: true,
                enabledForDiff: true,
              },
              {
                id: "tool:sublime_text",
                kind: "known",
                label: "Sublime Text",
                appId: "sublime_text",
                command: "",
                editorArgs: [],
                diffArgs: [],
                enabledForEditor: true,
                enabledForDiff: false,
              },
              {
                id: "custom:mn23v6h7:5adef",
                kind: "custom",
                label: "Text Edit 2",
                appId: null,
                command: "/System/Applications/TextEdit.app",
                editorArgs: ["{file}"],
                diffArgs: ["{left}"],
                enabledForEditor: true,
                enabledForDiff: false,
              },
              {
                id: "custom:mn27y83n:g6zh5",
                kind: "custom",
                label: "AG",
                appId: null,
                command: "/Applications/Antigravity.app",
                editorArgs: ["{file}"],
                diffArgs: ["{left}", "{right}"],
                enabledForEditor: true,
                enabledForDiff: true,
              },
              {
                id: "custom:mn27yqfa:69sjo",
                kind: "custom",
                label: "AG 2",
                appId: null,
                command: "/Applications/Affinity.app",
                editorArgs: ["{file}"],
                diffArgs: ["{left}", "{right}"],
                enabledForEditor: true,
                enabledForDiff: false,
              },
            ],
          },
        }}
      >
        <CodeBlock language="json" codeValue='{"value": 1}' />
      </ViewerExternalAppsProvider>,
    );

    const menuButton = await screen.findByRole("button", { name: "Open With" });
    fireEvent.mouseDown(menuButton);
    fireEvent.click(menuButton);

    const menu = await screen.findByRole("menu", { name: "Open With" });
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((item: HTMLElement) => item.textContent?.trim());

    expect(labels).toEqual([
      "Text Edit",
      "Zed",
      "Neovim",
      "Sublime Text",
      "Text Edit 2",
      "AG",
      "AG 2",
    ]);
    expect(listAvailableEditorsMock).not.toHaveBeenCalled();
  });

  it("updates Open With menu items after adding a tool without restarting", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.preferredExternalEditor = null;
    paneStateMock.preferredExternalDiffTool = null;
    paneStateMock.externalTools = [{ id: "editor:zed" }];
    const allEditors = [
      {
        id: "editor:zed",
        kind: "known",
        label: "Zed",
        appId: "zed",
        detected: true,
        command: "/usr/local/bin/zed",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: true,
        },
      },
      {
        id: "editor:textedit",
        kind: "known",
        label: "TextEdit",
        appId: "text_edit",
        detected: true,
        command: "/System/Applications/TextEdit.app",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: false,
          openContent: true,
          openDiff: false,
        },
      },
    ];
    listAvailableEditorsMock.mockImplementation(
      async (options?: { externalTools?: Array<{ id: string }> }) => {
        const allowedIds = new Set(options?.externalTools?.map((tool) => tool.id) ?? []);
        return {
          editors: allEditors.filter(
            (editor) => allowedIds.size === 0 || allowedIds.has(editor.id),
          ),
          diffTools: [],
        } as never;
      },
    );

    render(<CodeBlock language="json" codeValue='{"value": 1}' />);
    expect(screen.queryByRole("button", { name: "Open With" })).not.toBeInTheDocument();

    paneStateMock.externalTools = [{ id: "editor:zed" }, { id: "editor:textedit" }];
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PANE_STATE_UPDATED_EVENT, {
          detail: {
            preferredExternalEditor: null,
            preferredExternalDiffTool: null,
            terminalAppCommand: "",
            externalTools: paneStateMock.externalTools,
          },
        }),
      );
    });

    const menuButton = await screen.findByRole("button", { name: "Open With" });
    fireEvent.mouseDown(menuButton);
    fireEvent.click(menuButton);

    const menu = await screen.findByRole("menu", { name: "Open With" });
    await waitFor(() => {
      const labels = within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement) => item.textContent?.trim());
      expect(labels).toEqual(["Zed", "TextEdit"]);
    });
  });

  it("updates Open With menu items after removing a tool without restarting", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.preferredExternalEditor = null;
    paneStateMock.preferredExternalDiffTool = null;
    paneStateMock.externalTools = [{ id: "editor:zed" }, { id: "editor:textedit" }];
    const allEditors = [
      {
        id: "editor:zed",
        kind: "known",
        label: "Zed",
        appId: "zed",
        detected: true,
        command: "/usr/local/bin/zed",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: true,
          openContent: true,
          openDiff: true,
        },
      },
      {
        id: "editor:textedit",
        kind: "known",
        label: "TextEdit",
        appId: "text_edit",
        detected: true,
        command: "/System/Applications/TextEdit.app",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: false,
          openContent: true,
          openDiff: false,
        },
      },
    ];
    listAvailableEditorsMock.mockImplementation(
      async (options?: { externalTools?: Array<{ id: string }> }) => {
        const allowedIds = new Set(options?.externalTools?.map((tool) => tool.id) ?? []);
        return {
          editors: allEditors.filter(
            (editor) => allowedIds.size === 0 || allowedIds.has(editor.id),
          ),
          diffTools: [],
        } as never;
      },
    );

    render(<CodeBlock language="json" codeValue='{"value": 1}' />);
    await screen.findByRole("button", { name: "Open With" });

    paneStateMock.externalTools = [{ id: "editor:zed" }];
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PANE_STATE_UPDATED_EVENT, {
          detail: {
            preferredExternalEditor: null,
            preferredExternalDiffTool: null,
            terminalAppCommand: "",
            externalTools: paneStateMock.externalTools,
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Open With" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    });
  });

  it("uses live external tool preferences when opening viewer content", async () => {
    resetContentViewerCachesForTests();
    paneStateMock.preferredExternalEditor = "editor:textedit";
    paneStateMock.preferredExternalDiffTool = null;
    paneStateMock.terminalAppCommand = "/Applications/kitty.app";
    paneStateMock.externalTools = [{ id: "editor:textedit" }];
    listAvailableEditorsMock.mockResolvedValue({
      editors: [
        {
          id: "editor:textedit",
          kind: "known",
          label: "TextEdit",
          appId: "text_edit",
          detected: true,
          command: "/System/Applications/TextEdit.app",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: false,
            openContent: true,
            openDiff: false,
          },
        },
      ],
      diffTools: [],
    } as never);
    openContentInEditorMock.mockClear();

    render(<CodeBlock language="json" codeValue='{"value": 1}' metaLabel="payload.json" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(openContentInEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "payload.json",
          content: '{"value": 1}',
        }),
      );
    });
  });
});

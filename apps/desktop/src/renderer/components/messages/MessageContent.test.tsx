// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageContent } from "./MessageContent";

describe("MessageContent", () => {
  it("renders thinking messages as highlighted pre blocks", () => {
    render(<MessageContent text="thinking text" category="thinking" query="" />);

    expect(screen.getByText("thinking text")).toBeInTheDocument();
    expect(document.querySelector(".thinking-block")).not.toBeNull();
  });

  it("renders tool_use payload with command and arguments", () => {
    render(
      <MessageContent
        text={JSON.stringify({
          tool_name: "run_command",
          input: { cmd: "ls -la", file_path: "src/app.ts" },
        })}
        category="tool_use"
        query=""
      />,
    );

    expect(screen.getByText("Execute Command")).toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(document.body.textContent).toContain("ls -la");
  });

  it("renders tool_edit diff and written content variants", () => {
    const { rerender } = render(
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

    expect(screen.getByText("src/file.ts")).toBeInTheDocument();
    expect(document.body.textContent).toContain("const a = 2;");

    rerender(
      <MessageContent
        text={JSON.stringify({ input: { path: "src/write.ts", content: "new content" } })}
        category="tool_edit"
        query=""
      />,
    );

    expect(screen.getByText("src/write.ts")).toBeInTheDocument();
    expect(screen.getByText("Written Content")).toBeInTheDocument();
    expect(document.body.textContent).toContain("new content");
  });

  it("renders tool_result metadata and output", () => {
    render(
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

  it("renders markdown-rich assistant content and generic fallback content", () => {
    const { rerender } = render(
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
});

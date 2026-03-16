import { describe, expect, it } from "vitest";

import type { ParserDiagnostic } from "./contracts";
import { parseProviderPayload } from "./providerParsers";

const baseEvent = {
  type: "user",
  created_at: "2024-01-01T00:00:00Z",
};

describe("parseProviderPayload (Gemini attachment normalization)", () => {
  it("summarizes large referenced file dumps", () => {
    const payload = {
      messages: [
        {
          ...baseEvent,
          parts: [
            {
              text: [
                "Do the task described below.",
                "--- Content from referenced files ---",
                "Content from @src/README.md:",
                "# Project",
                "Content from @src/checkpoints/model-1.bin:",
                "Cannot display content of binary file: model-1.bin",
                "Content from @src/checkpoints/model-2.bin:",
                "Cannot display content of binary file: model-2.bin",
                "Content from @src/checkpoints/model-3.bin:",
                "Cannot display content of binary file: model-3.bin",
                "Content from @src/checkpoints/model-4.bin:",
                "Cannot display content of binary file: model-4.bin",
                "Content from @src/checkpoints/model-5.bin:",
                "Cannot display content of binary file: model-5.bin",
                "Content from @src/checkpoints/model-6.bin:",
                "Cannot display content of binary file: model-6.bin",
                "Content from @src/checkpoints/model-7.bin:",
                "Cannot display content of binary file: model-7.bin",
              ].join("\n"),
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "gemini",
      sessionId: "sess-1",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.category).toBe("user");
    expect(messages[0]?.content).toContain("Do the task described below.");
    expect(messages[1]?.category).toBe("system");
    expect(messages[1]?.content).toContain("Gemini attachment dump truncated");
    expect(messages[1]?.content).toContain("@src/README.md");
    expect(messages.map((msg) => msg.content).join("\n")).not.toContain(
      "Cannot display content of binary file",
    );
  });

  it("leaves small attachment blocks untouched", () => {
    const payload = {
      messages: [
        {
          ...baseEvent,
          parts: [
            {
              text: [
                "Task details",
                "--- Content from referenced files ---",
                "Content from @src/small.txt:",
                "Just a short snippet",
              ].join("\n"),
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "gemini",
      sessionId: "sess-2",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("user");
    expect(messages[0]?.content).toContain("Content from @src/small.txt:");
  });
});

describe("parseProviderPayload (Copilot)", () => {
  it("parses user messages and markdown responses", () => {
    const payload = {
      requests: [
        {
          requestId: "req-1",
          timestamp: 1741615200000,
          message: { text: "Hello Copilot" },
          response: [
            { kind: "markdownContent", value: "Hello! How can I help?" },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.category).toBe("user");
    expect(messages[0]?.content).toBe("Hello Copilot");
    expect(messages[1]?.category).toBe("assistant");
    expect(messages[1]?.content).toBe("Hello! How can I help?");
  });

  it("extracts tool invocations as tool_use", () => {
    const payload = {
      requests: [
        {
          requestId: "req-2",
          timestamp: 1741615200000,
          message: { text: "Open the file" },
          response: [
            {
              kind: "toolInvocationSerialized",
              toolId: "vscode.open",
              toolSpecificData: { commandLine: "code test.ts" },
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.category).toBe("tool_use");
    expect(messages[1]?.content).toContain("vscode.open");
  });

  it("maps elicitation to system messages", () => {
    const payload = {
      requests: [
        {
          requestId: "req-3",
          timestamp: 1741615200000,
          message: { text: "Do it" },
          response: [
            {
              kind: "elicitation",
              title: "Confirm",
              message: "Are you sure?",
            },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.category).toBe("system");
    expect(messages[1]?.content).toBe("Confirm: Are you sure?");
  });

  it("skips progressMessage and progressTask response items", () => {
    const payload = {
      requests: [
        {
          requestId: "req-4",
          timestamp: 1741615200000,
          message: { text: "Run task" },
          response: [
            { kind: "progressMessage", value: "Working..." },
            { kind: "progressTask", value: "Step 1" },
            { kind: "markdownContent", value: "Done!" },
          ],
        },
      ],
    };
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload,
      diagnostics,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.category).toBe("user");
    expect(messages[1]?.category).toBe("assistant");
    expect(messages[1]?.content).toBe("Done!");
  });

  it("returns empty array for payload without requests", () => {
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "copilot",
      sessionId: "copilot-test",
      payload: { version: 3 },
      diagnostics,
    });

    expect(messages).toHaveLength(0);
  });
});

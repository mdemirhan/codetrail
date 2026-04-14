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
          response: [{ kind: "markdownContent", value: "Hello! How can I help?" }],
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

describe("parseProviderPayload (Codex tool classification)", () => {
  it("keeps write_stdin as tool_use", () => {
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "codex",
      sessionId: "codex-test",
      payload: [
        {
          type: "response_item",
          timestamp: "2026-03-21T19:48:31.960Z",
          payload: {
            id: "call-write-stdin",
            type: "custom_tool_call",
            call_id: "call-write-stdin",
            name: "write_stdin",
            input: {
              session_id: 123,
              chars: "",
              yield_time_ms: 1000,
            },
          },
        },
      ],
      diagnostics,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("tool_use");
    expect(messages[0]?.content).toContain("write_stdin");
  });

  it("still classifies apply_patch as tool_edit", () => {
    const diagnostics: ParserDiagnostic[] = [];

    const messages = parseProviderPayload({
      provider: "codex",
      sessionId: "codex-test",
      payload: [
        {
          type: "response_item",
          timestamp: "2026-03-21T19:47:10.130Z",
          payload: {
            id: "call-apply-patch",
            type: "custom_tool_call",
            call_id: "call-apply-patch",
            name: "apply_patch",
            input: "*** Begin Patch\n*** End Patch\n",
          },
        },
      ],
      diagnostics,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("tool_edit");
    expect(messages[0]?.content).toContain("apply_patch");
  });
});

describe("parseCopilotCliEvent", () => {
  const sessionId = "test-session-id";

  function parse(events: unknown[]) {
    const diagnostics: ParserDiagnostic[] = [];
    return parseProviderPayload({
      provider: "copilot_cli",
      sessionId,
      payload: events,
      diagnostics,
    });
  }

  it("parses a user.message event", () => {
    const messages = parse([
      {
        type: "user.message",
        data: { interactionId: "ia-001", content: "Hello, world!" },
        timestamp: "2024-01-15T10:00:05.000Z",
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("user");
    expect(messages[0]?.content).toBe("Hello, world!");
    expect(messages[0]?.id).toBe("ia-001");
    expect(messages[0]?.createdAt).toBe("2024-01-15T10:00:05.000Z");
  });

  it("skips user.message events with empty content", () => {
    const messages = parse([
      {
        type: "user.message",
        data: { interactionId: "ia-001", content: "" },
        timestamp: "2024-01-15T10:00:05.000Z",
      },
    ]);
    expect(messages).toHaveLength(0);
  });

  it("uses fallback id for user.message when interactionId is absent", () => {
    const messages = parse([
      { type: "user.message", data: { content: "Hi" }, timestamp: "2024-01-15T10:00:05.000Z" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(`${sessionId}:msg:0`);
  });

  it("parses an assistant.message event with token count", () => {
    const messages = parse([
      {
        type: "assistant.message",
        data: {
          messageId: "msg-001",
          content: "Sure, I can help.",
          outputTokens: 42,
          toolRequests: [],
        },
        timestamp: "2024-01-15T10:00:10.000Z",
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("assistant");
    expect(messages[0]?.content).toBe("Sure, I can help.");
    expect(messages[0]?.id).toBe("msg-001");
    expect(messages[0]?.tokenOutput).toBe(42);
  });

  it("sets tokenOutput to null when outputTokens is absent", () => {
    const messages = parse([
      {
        type: "assistant.message",
        data: { messageId: "msg-001", content: "No tokens here.", toolRequests: [] },
        timestamp: "2024-01-15T10:00:10.000Z",
      },
    ]);
    expect(messages[0]?.tokenOutput).toBeNull();
  });

  it("parses assistant.message tool requests as separate tool_use messages", () => {
    const messages = parse([
      {
        type: "assistant.message",
        data: {
          messageId: "msg-001",
          content: "Let me check that file.",
          outputTokens: 10,
          toolRequests: [
            { toolCallId: "tool-001", name: "read_file", arguments: { path: "src/index.ts" } },
          ],
        },
        timestamp: "2024-01-15T10:00:10.000Z",
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.category).toBe("assistant");
    expect(messages[1]?.id).toBe("tool-001");
    expect(messages[1]?.content).toContain('"id":"tool-001"');
    expect(messages[1]?.content).toContain("read_file");
  });

  it("uses a distinct tool_result id when a tool call completes", () => {
    const messages = parse([
      {
        type: "assistant.message",
        data: {
          messageId: "msg-001",
          content: "Let me check that file.",
          toolRequests: [
            { toolCallId: "tool-001", name: "read_file", arguments: { path: "src/index.ts" } },
          ],
        },
        timestamp: "2024-01-15T10:00:10.000Z",
      },
      {
        type: "tool.execution_complete",
        data: { toolCallId: "tool-001", result: { content: "File contents here." } },
        timestamp: "2024-01-15T10:00:11.000Z",
      },
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[1]?.id).toBe("tool-001");
    expect(messages[2]?.id).toBe("tool-001:result");
    expect(messages[1]?.id).not.toBe(messages[2]?.id);
  });

  it("uses fallback id for assistant.message when messageId is absent", () => {
    const messages = parse([
      {
        type: "assistant.message",
        data: { content: "Hello", toolRequests: [] },
        timestamp: "2024-01-15T10:00:10.000Z",
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(`${sessionId}:msg:0`);
  });

  it("parses tool.execution_complete with a result", () => {
    const messages = parse([
      {
        type: "tool.execution_complete",
        data: { toolCallId: "tool-001", result: { content: "File contents here." } },
        timestamp: "2024-01-15T10:00:11.000Z",
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("tool_result");
    expect(messages[0]?.id).toBe("tool-001:result");
    expect(messages[0]?.content).toBe("File contents here.");
  });

  it("skips tool.execution_complete when result is absent (no spurious '{}' row)", () => {
    const messages = parse([
      {
        type: "tool.execution_complete",
        data: { toolCallId: "tool-001" },
        timestamp: "2024-01-15T10:00:11.000Z",
      },
    ]);
    expect(messages).toHaveLength(0);
  });

  it("skips tool.execution_complete when result is an empty object (no spurious '{}' row)", () => {
    const messages = parse([
      {
        type: "tool.execution_complete",
        data: { toolCallId: "tool-001", result: {} },
        timestamp: "2024-01-15T10:00:11.000Z",
      },
    ]);
    expect(messages).toHaveLength(0);
  });

  it("skips tool.execution_complete when result has only an empty content field", () => {
    const messages = parse([
      {
        type: "tool.execution_complete",
        data: { toolCallId: "tool-001", result: { content: "" } },
        timestamp: "2024-01-15T10:00:11.000Z",
      },
    ]);
    expect(messages).toHaveLength(0);
  });

  it("serializes non-content result fields as JSON for tool.execution_complete", () => {
    const messages = parse([
      {
        type: "tool.execution_complete",
        data: { toolCallId: "tool-001", result: { exitCode: 0 } },
        timestamp: "2024-01-15T10:00:11.000Z",
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("tool_result");
    expect(messages[0]?.content).toBe('{"exitCode":0}');
  });

  it("uses fallback id for tool.execution_complete when toolCallId is absent", () => {
    const messages = parse([
      {
        type: "tool.execution_complete",
        data: { result: { content: "ok" } },
        timestamp: "2024-01-15T10:00:11.000Z",
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(`${sessionId}:tool_result:0`);
  });

  it("skips non-content events like session.start", () => {
    const messages = parse([
      {
        type: "session.start",
        data: { sessionId: "abc", version: 1, context: { cwd: "/home/user" } },
        timestamp: "2024-01-15T10:00:00.000Z",
      },
    ]);
    expect(messages).toHaveLength(0);
  });

  it("handles a full conversation sequence correctly", () => {
    const messages = parse([
      {
        type: "session.start",
        data: { sessionId: "s-001", version: 1, context: {} },
        timestamp: "2024-01-15T10:00:00.000Z",
      },
      {
        type: "user.message",
        data: { interactionId: "ia-001", content: "What is 2+2?" },
        timestamp: "2024-01-15T10:00:05.000Z",
      },
      {
        type: "assistant.message",
        data: { messageId: "m-001", content: "4", outputTokens: 5, toolRequests: [] },
        timestamp: "2024-01-15T10:00:06.000Z",
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.category).toBe("user");
    expect(messages[1]?.category).toBe("assistant");
    expect(messages[1]?.tokenOutput).toBe(5);
  });
});

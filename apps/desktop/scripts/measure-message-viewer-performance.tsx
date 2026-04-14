import { performance } from "node:perf_hooks";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@codetrail/core/browser";
import { act, cleanup } from "@testing-library/react";
import { JSDOM } from "jsdom";
import React from "react";

import { MessageCard } from "../src/renderer/components/messages/MessageCard";
import type { SessionMessage } from "../src/renderer/components/messages/types";
import { renderWithPaneFocus } from "../src/renderer/test/renderWithPaneFocus";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

window.codetrail = {
  platform: "darwin",
  invoke: async <C extends IpcChannel>(
    channel: C,
    _payload: IpcRequestInput<C>,
  ): Promise<IpcResponse<C>> => {
    if (channel === "editor:listAvailable") {
      return { editors: [], diffTools: [] } as IpcResponse<C>;
    }
    if (channel === "ui:getPaneState") {
      return {
        preferredExternalEditor: null,
        preferredExternalDiffTool: null,
      } as IpcResponse<C>;
    }
    return { ok: true } as IpcResponse<C>;
  },
  onHistoryExportProgress: () => () => undefined,
  onAppCommand: () => () => undefined,
};

type Sample = {
  name: string;
  message: SessionMessage;
};

const baseMessage: SessionMessage = {
  id: "message_1",
  sourceId: "source_1",
  sessionId: "session_1",
  provider: "codex",
  category: "tool_result",
  content: "",
  createdAt: "2026-03-22T10:00:00.000Z",
  tokenInput: 0,
  tokenOutput: 0,
  operationDurationMs: 1000,
  operationDurationSource: "native",
  operationDurationConfidence: "high",
  turnGroupId: null,
  turnGroupingMode: "heuristic",
  turnAnchorKind: null,
  nativeTurnId: null,
};

function buildJsonLines(lineCount: number): string {
  const record: Record<string, string> = {};
  for (let index = 0; index < lineCount; index += 1) {
    record[`key_${index}`] = `value_${index}`;
  }
  return JSON.stringify(record, null, 2);
}

function buildLogLines(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, index) =>
      `2026-03-22T10:${String(index % 60).padStart(2, "0")}:00.000Z INFO line ${index} /Users/acme/project/file-${index}.ts`,
  ).join("\n");
}

function buildDiffLines(lineCount: number): string {
  const rows = [
    "diff --git a/apps/desktop/src/main/main.ts b/apps/desktop/src/main/main.ts",
    "--- a/apps/desktop/src/main/main.ts",
    "+++ b/apps/desktop/src/main/main.ts",
    "@@ -1,1 +1,1 @@",
  ];
  for (let index = 0; index < lineCount; index += 1) {
    rows.push(`-const beforeValue${index} = ${index};`);
    rows.push(`+const afterValue${index} = ${index + 1};`);
  }
  return rows.join("\n");
}

function buildMarkdownWithCode(lineCount: number): string {
  const code = Array.from(
    { length: lineCount },
    (_, index) => `const value${index} = ${index};`,
  ).join("\n");
  return ["# Benchmark", "", "```ts", code, "```"].join("\n");
}

const samples: Sample[] = [
  {
    name: "tool-use-shell-json",
    message: {
      ...baseMessage,
      category: "tool_use",
      content: JSON.stringify(
        {
          tool_name: "Execute Command",
          input: {
            cmd: "bun run typecheck",
            workdir: "/Users/acme/project",
            yield_time_ms: 1000,
            max_output_tokens: 8000,
          },
        },
        null,
        2,
      ),
    },
  },
  {
    name: "tool-result-json-400",
    message: {
      ...baseMessage,
      content: JSON.stringify({ output: buildJsonLines(400) }),
    },
  },
  {
    name: "tool-result-log-2200",
    message: {
      ...baseMessage,
      content: JSON.stringify({ output: buildLogLines(2200) }),
    },
  },
  {
    name: "tool-edit-diff-600",
    message: {
      ...baseMessage,
      category: "tool_edit",
      content: JSON.stringify({
        file_path: "/Users/acme/project/apps/desktop/src/main/main.ts",
        diff: buildDiffLines(600),
      }),
    },
  },
  {
    name: "assistant-markdown-code-300",
    message: {
      ...baseMessage,
      category: "assistant",
      content: buildMarkdownWithCode(300),
    },
  },
];

function renderCard(message: SessionMessage, isExpanded: boolean) {
  return (
    <MessageCard
      message={message}
      query=""
      highlightPatterns={[]}
      pathRoots={["/Users/acme/project"]}
      isFocused={false}
      isExpanded={isExpanded}
      onToggleExpanded={() => undefined}
    />
  );
}

async function measureExpand(sample: Sample): Promise<number> {
  const view = renderWithPaneFocus(renderCard(sample.message, false));
  const startedAt = performance.now();
  await act(async () => {
    view.rerender(renderCard(sample.message, true));
  });
  const elapsed = performance.now() - startedAt;
  view.unmount();
  cleanup();
  return elapsed;
}

async function main() {
  const iterations = 8;
  const warmupRuns = 2;
  const results: Array<{
    sample: string;
    averageMs: string;
    minMs: string;
    maxMs: string;
  }> = [];

  for (const sample of samples) {
    const measurements: number[] = [];
    for (let run = 0; run < warmupRuns + iterations; run += 1) {
      const elapsed = await measureExpand(sample);
      if (run >= warmupRuns) {
        measurements.push(elapsed);
      }
    }
    const sum = measurements.reduce((total, value) => total + value, 0);
    results.push({
      sample: sample.name,
      averageMs: (sum / measurements.length).toFixed(2),
      minMs: Math.min(...measurements).toFixed(2),
      maxMs: Math.max(...measurements).toFixed(2),
    });
  }

  console.table(results);
}

void main();

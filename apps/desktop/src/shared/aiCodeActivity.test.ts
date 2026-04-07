import { describe, expect, it } from "vitest";

import { summarizeStoredToolEditActivity } from "./aiCodeActivity";

describe("summarizeStoredToolEditActivity", () => {
  it("extracts multi-file apply_patch edits and line counts", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+export const created = true;",
      "+export const version = 1;",
      "*** Update File: src/parser.ts",
      "@@",
      "-const value = old();",
      "+const value = next();",
      "*** End Patch",
    ].join("\n");

    const summary = summarizeStoredToolEditActivity({
      toolName: "apply_patch",
      argsJson: JSON.stringify(patch),
    });

    expect(summary).toEqual({
      files: [
        {
          filePath: "src/new.ts",
          changeType: "add",
          linesAdded: 2,
          linesDeleted: 0,
        },
        {
          filePath: "src/parser.ts",
          changeType: "update",
          linesAdded: 1,
          linesDeleted: 1,
        },
      ],
    });
  });

  it("derives structured write metrics when no diff is present", () => {
    const summary = summarizeStoredToolEditActivity({
      toolName: "str_replace",
      argsJson: JSON.stringify({
        path: "src/app.ts",
        old_string: "const a = 1;\nconst b = 2;\n",
        new_string: "const a = 2;\nconst b = 2;\nconst c = 3;\n",
      }),
    });

    expect(summary).toEqual({
      files: [
        {
          filePath: "src/app.ts",
          changeType: "update",
          linesAdded: 2,
          linesDeleted: 1,
        },
      ],
    });
  });

  it("falls back to text line counts for add and delete writes without a diff", () => {
    expect(
      summarizeStoredToolEditActivity({
        toolName: "write_file",
        argsJson: JSON.stringify({
          path: "src/new.ts",
          content: "line one\nline two\n",
        }),
      }),
    ).toEqual({
      files: [
        {
          filePath: "src/new.ts",
          changeType: "add",
          linesAdded: 2,
          linesDeleted: 0,
        },
      ],
    });

    expect(
      summarizeStoredToolEditActivity({
        toolName: "delete_file",
        argsJson: JSON.stringify({
          path: "src/old.ts",
          old_string: "line one\nline two\nline three\n",
        }),
      }),
    ).toEqual({
      files: [
        {
          filePath: "src/old.ts",
          changeType: "delete",
          linesAdded: 0,
          linesDeleted: 3,
        },
      ],
    });
  });

  it("returns null for unparseable or non-measurable payloads", () => {
    expect(
      summarizeStoredToolEditActivity({
        toolName: "apply_patch",
        argsJson: "{",
      }),
    ).toBeNull();

    expect(
      summarizeStoredToolEditActivity({
        toolName: "unknown",
        argsJson: JSON.stringify({ raw: "*** Begin Patch\n..." }),
      }),
    ).toBeNull();
  });
});

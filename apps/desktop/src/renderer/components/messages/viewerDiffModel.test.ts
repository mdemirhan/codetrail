import { describe, expect, it } from "vitest";

import {
  buildDiffRenderSourceFromRows,
  buildDiffViewModel,
  parseDiffSequenceMarker,
} from "./viewerDiffModel";

describe("viewerDiffModel", () => {
  it("pairs multi-line removed and added blocks in order", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-before A",
      "-before B",
      "+after A",
      "+after B",
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);

    expect(model.rows).toEqual([
      expect.objectContaining({
        kind: "paired",
        leftText: "before A",
        rightText: "after A",
      }),
      expect.objectContaining({
        kind: "paired",
        leftText: "before B",
        rightText: "after B",
      }),
    ]);
  });

  it("keeps inserted lines unpaired when a changed line expands into nested JSX", () => {
    const diff = [
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
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.tsx", ["/Users/acme/repo"]);

    expect(model.rows).toEqual([
      expect.objectContaining({
        kind: "paired",
        leftText: '<span className="content-viewer-path" title={metaPath ?? undefined}>',
        rightText: '<span className="content-viewer-path">',
      }),
      expect.objectContaining({
        kind: "add",
        text: '  <span className="content-viewer-path-text" title={metaPath ?? undefined}>',
      }),
      expect.objectContaining({
        kind: "paired",
        leftText: "  {displayedMetaPath}",
        rightText: "    {displayedMetaPath}",
      }),
      expect.objectContaining({
        kind: "add",
        text: "  </span>",
      }),
      expect.objectContaining({
        kind: "paired",
        leftText: "</span>",
        rightText: "</span>",
      }),
    ]);
  });

  it("does not pair unrelated removals and additions just because they share a block", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -4,2 +4,2 @@",
      "-const removedValue = previousCall();",
      "-return previousValue;",
      "+const insertedNode = createElement();",
      '+return <div className="next-value" />;',
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);

    expect(model.rows).toEqual([
      expect.objectContaining({
        kind: "remove",
        text: "const removedValue = previousCall();",
      }),
      expect.objectContaining({
        kind: "remove",
        text: "return previousValue;",
      }),
      expect.objectContaining({
        kind: "add",
        text: "const insertedNode = createElement();",
      }),
      expect.objectContaining({
        kind: "add",
        text: 'return <div className="next-value" />;',
      }),
    ]);
  });

  it("keeps identical changed lines paired without creating duplicate add/remove rows", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-const same = value;",
      "-return same;",
      "+const same = value;",
      "+return same;",
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);

    expect(model.rows).toEqual([
      expect.objectContaining({
        kind: "paired",
        leftText: "const same = value;",
        rightText: "const same = value;",
      }),
      expect.objectContaining({
        kind: "paired",
        leftText: "return same;",
        rightText: "return same;",
      }),
    ]);
  });

  it("does not parse whitespace-padded marker lines as sequence markers", () => {
    expect(parseDiffSequenceMarker("Edit 2 of 4 | +3 -1 | 12:50:11 PM")).toEqual({
      editNumber: 2,
      totalEdits: 4,
      addedLineCount: 3,
      removedLineCount: 1,
      timeLabel: "12:50:11 PM",
    });
    expect(parseDiffSequenceMarker("  Edit 2 of 4 | +3 -1 | 12:50:11 PM  ")).toBeNull();
  });

  it("leaves blocks unpaired when changed lines share no meaningful similarity", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -10,2 +10,2 @@",
      "-fetchLegacyUserAccount();",
      "-renderLegacySummary();",
      "+const nextThemeColor = '#4f46e5';",
      '+console.warn("render pipeline mismatch");',
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);

    expect(model.rows).toEqual([
      expect.objectContaining({ kind: "remove", text: "fetchLegacyUserAccount();" }),
      expect.objectContaining({ kind: "remove", text: "renderLegacySummary();" }),
      expect.objectContaining({ kind: "add", text: "const nextThemeColor = '#4f46e5';" }),
      expect.objectContaining({ kind: "add", text: 'console.warn("render pipeline mismatch");' }),
    ]);
  });

  it("handles large changed blocks without dropping rows", () => {
    const removedLines = Array.from({ length: 20 }, (_, index) => `-oldValue${index}();`);
    const addedLines = Array.from({ length: 20 }, (_, index) => `+newValue${index}();`);
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,20 +1,20 @@",
      ...removedLines,
      ...addedLines,
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);

    expect(model.rows).toHaveLength(40);
    expect(model.rows.filter((row) => row.kind === "remove")).toHaveLength(20);
    expect(model.rows.filter((row) => row.kind === "add")).toHaveLength(20);
  });

  it("resolves relative diff header paths against the selected project root", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, undefined, ["/Users/acme/repo"]);

    expect(model.displayFilePath).toBe("src/a.ts");
    expect(model.absoluteFilePath).toBe("/Users/acme/repo/src/a.ts");
    expect(model.sourceLanguage).toBe("typescript");
  });

  it("rejects relative diff header paths that traverse above the project root", () => {
    const diff = [
      "diff --git a/../../etc/passwd b/../../etc/passwd",
      "--- a/../../etc/passwd",
      "+++ b/../../etc/passwd",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, undefined, ["/Users/acme/repo"]);

    expect(model.displayFilePath).toBe("../../etc/passwd");
    expect(model.absoluteFilePath).toBeNull();
  });

  it("does not pick an absolute path when multiple project roots match the same relative path", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, undefined, [
      "/Users/acme/repo-one",
      "/Users/acme/repo-two",
    ]);

    expect(model.displayFilePath).toBe("src/a.ts");
    expect(model.absoluteFilePath).toBeNull();
  });

  it("normalizes Windows absolute paths before trimming the selected project root", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, "C:\\Users\\acme\\repo\\src\\a.ts", [
      "C:\\Users\\acme\\repo",
    ]);

    expect(model.displayFilePath).toBe("src/a.ts");
    expect(model.absoluteFilePath).toBe("C:/Users/acme/repo/src/a.ts");
    expect(model.sourceLanguage).toBe("typescript");
  });

  it("normalizes dot segments in relative diff header paths", () => {
    const diff = [
      "diff --git a/src/./nested/../a.ts b/src/./nested/../a.ts",
      "--- a/src/./nested/../a.ts",
      "+++ b/src/./nested/../a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, undefined, ["/Users/acme/repo"]);

    expect(model.displayFilePath).toBe("src/a.ts");
    expect(model.absoluteFilePath).toBe("/Users/acme/repo/src/a.ts");
  });

  it("preserves sequence marker rows inside a unified diff stream", () => {
    const diff = [
      "Edit 1 of 2 | +1 -1 | 12:34:01 PM",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
      "Edit 2 of 2 | +1 -1 | 12:35:02 PM",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -2,1 +2,1 @@",
      "-again",
      "+done",
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);

    expect(model.rows[0]).toEqual({
      kind: "marker",
      text: "Edit 1 of 2 | +1 -1 | 12:34:01 PM",
    });
    expect(model.rows[3]).toEqual({
      kind: "marker",
      text: "Edit 2 of 2 | +1 -1 | 12:35:02 PM",
    });
    expect(model.addedLineCount).toBe(2);
    expect(model.removedLineCount).toBe(2);
  });

  it("resets synthetic line numbering at each sequence marker when a later edit has bare hunks", () => {
    const diff = [
      "Edit 1 of 2 | +1 -1 | 12:34:01 PM",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -42,1 +42,1 @@",
      "-before",
      "+after",
      "Edit 2 of 2 | +1 -1 | 12:35:02 PM",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@",
      "-again",
      "+done",
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);
    const removeRows = model.rows.filter((row) => row.kind === "remove");
    const addRows = model.rows.filter((row) => row.kind === "add");

    expect(removeRows[0]).toEqual(
      expect.objectContaining({
        oldLine: 42,
      }),
    );
    expect(addRows[0]).toEqual(
      expect.objectContaining({
        newLine: 42,
      }),
    );
    expect(removeRows[1]).toEqual(
      expect.objectContaining({
        oldLine: 1,
      }),
    );
    expect(addRows[1]).toEqual(
      expect.objectContaining({
        newLine: 1,
      }),
    );
  });
});

describe("buildDiffRenderSourceFromRows", () => {
  it("produces split sources with the same line count as the row count", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,4 +1,3 @@",
      " const context = true;",
      "-const removed = 1;",
      "+const added = 2;",
      "+const alsoAdded = 3;",
      " const end = false;",
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);
    const source = buildDiffRenderSourceFromRows(model.rows, "split");
    const leftLines = source.splitLeft.split("\n");
    const rightLines = source.splitRight.split("\n");

    expect(leftLines).toHaveLength(model.rows.length);
    expect(rightLines).toHaveLength(model.rows.length);
  });

  it("places remove text only on the left and add text only on the right", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-removed line",
      "+added line",
      " context",
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);
    const source = buildDiffRenderSourceFromRows(model.rows, "split");
    const leftLines = source.splitLeft.split("\n");
    const rightLines = source.splitRight.split("\n");

    const pairedRow = model.rows[0];
    expect(pairedRow?.kind).toBe("paired");
    if (pairedRow?.kind === "paired") {
      expect(leftLines[0]).toBe(pairedRow.leftText);
      expect(rightLines[0]).toBe(pairedRow.rightText);
    }
  });

  it("fills empty strings for the opposite side of standalone adds and removes", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-only removed",
      "+only added",
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);
    const source = buildDiffRenderSourceFromRows(model.rows, "split");
    const leftLines = source.splitLeft.split("\n");
    const rightLines = source.splitRight.split("\n");

    for (let index = 0; index < model.rows.length; index++) {
      const row = model.rows[index]!;
      if (row.kind === "add") {
        expect(leftLines[index]).toBe("");
      }
      if (row.kind === "remove") {
        expect(rightLines[index]).toBe("");
      }
    }
  });

  it("produces matching line counts for diffs with sequence markers", () => {
    const diff = [
      "Edit 1 of 2 | +1 -1 | 12:34:01 PM",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
      "Edit 2 of 2 | +1 -0 | 12:35:02 PM",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -5,0 +5,1 @@",
      "+new line",
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);
    const source = buildDiffRenderSourceFromRows(model.rows, "split");
    const leftLines = source.splitLeft.split("\n");
    const rightLines = source.splitRight.split("\n");

    expect(leftLines).toHaveLength(model.rows.length);
    expect(rightLines).toHaveLength(model.rows.length);
  });
});

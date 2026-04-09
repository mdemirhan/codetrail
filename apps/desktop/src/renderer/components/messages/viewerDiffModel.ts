import {
  isPathWithinRoot,
  joinPathWithinRoot,
  normalizeAbsolutePath,
} from "@codetrail/core/browser";

import { detectLanguageFromFilePath, isAddedDiffLine, isRemovedDiffLine } from "./viewerDetection";

export type DiffDisplayRow =
  | {
      kind: "marker";
      text: string;
    }
  | {
      kind: "context";
      oldLine: number;
      newLine: number;
      text: string;
    }
  | {
      kind: "paired";
      oldLine: number;
      newLine: number;
      leftText: string;
      rightText: string;
      leftParts: Array<{ text: string; changed: boolean }>;
      rightParts: Array<{ text: string; changed: boolean }>;
    }
  | {
      kind: "remove";
      oldLine: number;
      text: string;
    }
  | {
      kind: "add";
      newLine: number;
      text: string;
    };

export type DiffViewModel = {
  rows: DiffDisplayRow[];
  displayFilePath: string;
  absoluteFilePath: string | null;
  sourceLanguage: string;
  addedLineCount: number;
  removedLineCount: number;
};

const INLINE_DIFF_MAX_LINE_LENGTH = 240;
const INLINE_DIFF_MAX_TOKEN_COUNT = 80;
export const DIFF_SEQUENCE_MARKER_PATTERN = /^Edit (\d+) of (\d+) \| \+(\d+) -(\d+) \| (.+)$/;

export type DiffSequenceMarker = {
  editNumber: number;
  totalEdits: number;
  addedLineCount: number;
  removedLineCount: number;
  timeLabel: string;
};

export function buildDiffRenderSourceFromRows(
  rows: DiffDisplayRow[],
  mode: "unified" | "split",
): { unified: string; splitLeft: string; splitRight: string } {
  if (mode === "unified") {
    return {
      unified: rows
        .flatMap((row) => (row.kind === "paired" ? [row.leftText, row.rightText] : [row.text]))
        .join("\n"),
      splitLeft: "",
      splitRight: "",
    };
  }
  return {
    unified: "",
    splitLeft: rows
      .map((row) =>
        row.kind === "marker"
          ? row.text
          : row.kind === "context"
            ? row.text
            : row.kind === "paired"
              ? row.leftText
              : row.kind === "remove"
                ? row.text
                : "",
      )
      .join("\n"),
    splitRight: rows
      .map((row) =>
        row.kind === "marker"
          ? row.text
          : row.kind === "context"
            ? row.text
            : row.kind === "paired"
              ? row.rightText
              : row.kind === "add"
                ? row.text
                : "",
      )
      .join("\n"),
  };
}

export function buildDiffRenderSource(
  diffModel: DiffViewModel | null,
  mode: "unified" | "split",
  maxRows?: number,
): { unified: string; splitLeft: string; splitRight: string } {
  if (!diffModel) {
    return { unified: "", splitLeft: "", splitRight: "" };
  }
  const rows =
    typeof maxRows === "number" ? diffModel.rows.slice(0, Math.max(0, maxRows)) : diffModel.rows;
  return buildDiffRenderSourceFromRows(rows, mode);
}

export function buildDiffViewModel(
  codeValue: string,
  filePath: string | null | undefined,
  pathRoots: string[],
): DiffViewModel {
  const lines = codeValue.split(/\r?\n/);
  const rows: DiffDisplayRow[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;
  let addedLineCount = 0;
  let removedLineCount = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isDiffSequenceMarkerLine(line)) {
      rows.push({
        kind: "marker",
        text: line,
      });
      oldLineNumber = 1;
      newLineNumber = 1;
      index += 1;
      continue;
    }
    if (line.startsWith("@@")) {
      const hunkStart = parseDiffHunkStart(line);
      if (hunkStart) {
        oldLineNumber = hunkStart.oldLine;
        newLineNumber = hunkStart.newLine;
      }
      index += 1;
      continue;
    }
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      index += 1;
      continue;
    }
    if (isRemovedDiffLine(line) || isAddedDiffLine(line)) {
      const block = collectChangedDiffBlock(lines, index);
      const alignedRows = alignChangedDiffBlock(block.removed, block.added);
      for (const alignedRow of alignedRows) {
        if (alignedRow.kind === "paired") {
          const leftText = alignedRow.removed.slice(1);
          const rightText = alignedRow.added.slice(1);
          const inlineDiff = shouldRenderInlineDiff(leftText, rightText)
            ? diffInlineSegments(leftText, rightText)
            : {
                left: [{ text: leftText, changed: true }],
                right: [{ text: rightText, changed: true }],
              };
          rows.push({
            kind: "paired",
            oldLine: oldLineNumber,
            newLine: newLineNumber,
            leftText,
            rightText,
            leftParts: inlineDiff.left,
            rightParts: inlineDiff.right,
          });
          removedLineCount += 1;
          addedLineCount += 1;
          oldLineNumber += 1;
          newLineNumber += 1;
          continue;
        }
        if (alignedRow.kind === "remove") {
          rows.push({ kind: "remove", oldLine: oldLineNumber, text: alignedRow.removed.slice(1) });
          removedLineCount += 1;
          oldLineNumber += 1;
          continue;
        }
        rows.push({ kind: "add", newLine: newLineNumber, text: alignedRow.added.slice(1) });
        addedLineCount += 1;
        newLineNumber += 1;
      }
      index = block.nextIndex;
      continue;
    }
    rows.push({
      kind: "context",
      oldLine: oldLineNumber,
      newLine: newLineNumber,
      text: line.startsWith(" ") ? line.slice(1) : line,
    });
    oldLineNumber += 1;
    newLineNumber += 1;
    index += 1;
  }

  const parsedFilePath = filePath ?? extractDiffFilePath(lines);
  const normalizedFilePath = parsedFilePath ? parsedFilePath : null;
  const absoluteFilePath = resolveAbsoluteDiffFilePath(normalizedFilePath, pathRoots);
  return {
    rows,
    displayFilePath: normalizedFilePath
      ? trimProjectPrefixFromPath(absoluteFilePath ?? normalizedFilePath, pathRoots)
      : "Diff",
    absoluteFilePath,
    sourceLanguage: detectLanguageFromFilePath(absoluteFilePath ?? normalizedFilePath),
    addedLineCount,
    removedLineCount,
  };
}

export function parseDiffSequenceMarker(line: string): DiffSequenceMarker | null {
  const match = DIFF_SEQUENCE_MARKER_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  const [, editNumber, totalEdits, addedLineCount, removedLineCount, timeLabel] = match;
  if (!editNumber || !totalEdits || !addedLineCount || !removedLineCount || !timeLabel) {
    return null;
  }
  return {
    editNumber: Number.parseInt(editNumber, 10),
    totalEdits: Number.parseInt(totalEdits, 10),
    addedLineCount: Number.parseInt(addedLineCount, 10),
    removedLineCount: Number.parseInt(removedLineCount, 10),
    timeLabel,
  };
}

export function isDiffSequenceMarkerLine(line: string): boolean {
  return parseDiffSequenceMarker(line) !== null;
}

function resolveAbsoluteDiffFilePath(filePath: string | null, pathRoots: string[]): string | null {
  if (!filePath) {
    return null;
  }

  const normalizedAbsolutePath = normalizeAbsolutePath(filePath);
  if (normalizedAbsolutePath) {
    return normalizedAbsolutePath;
  }

  const normalizedRelativePath = normalizeRelativePath(filePath);
  if (!normalizedRelativePath) {
    return null;
  }

  const candidates = new Set<string>();
  for (const root of pathRoots) {
    const normalizedRoot = normalizeAbsolutePath(root);
    if (!normalizedRoot) {
      continue;
    }

    const joinedPath = joinPathWithinRoot(normalizedRoot, normalizedRelativePath);
    if (!joinedPath || !isPathWithinRoot(joinedPath, normalizedRoot)) {
      continue;
    }
    candidates.add(joinedPath);
  }

  if (candidates.size !== 1) {
    return null;
  }
  return candidates.values().next().value ?? null;
}

function collectChangedDiffBlock(
  lines: string[],
  startIndex: number,
): { removed: string[]; added: string[]; nextIndex: number } {
  const removed: string[] = [];
  const added: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isRemovedDiffLine(line)) {
      removed.push(line);
      index += 1;
      continue;
    }
    if (isAddedDiffLine(line)) {
      added.push(line);
      index += 1;
      continue;
    }
    break;
  }
  return { removed, added, nextIndex: index };
}

type AlignedChangedRow =
  | { kind: "paired"; removed: string; added: string }
  | { kind: "remove"; removed: string }
  | { kind: "add"; added: string };

const CHANGED_LINE_MATCH_THRESHOLD = 0.5;

function alignChangedDiffBlock(removed: string[], added: string[]): AlignedChangedRow[] {
  if (removed.length === 0) {
    return added.map((line) => ({ kind: "add", added: line }));
  }
  if (added.length === 0) {
    return removed.map((line) => ({ kind: "remove", removed: line }));
  }

  const pairScores = Array.from({ length: removed.length }, (_, removedIndex) =>
    Array.from({ length: added.length }, (_, addedIndex) =>
      scoreChangedLinePair(
        removed[removedIndex]?.slice(1) ?? "",
        added[addedIndex]?.slice(1) ?? "",
      ),
    ),
  );
  const scores: number[][] = Array.from({ length: removed.length + 1 }, () =>
    Array.from({ length: added.length + 1 }, () => 0),
  );

  for (let removedIndex = removed.length - 1; removedIndex >= 0; removedIndex -= 1) {
    for (let addedIndex = added.length - 1; addedIndex >= 0; addedIndex -= 1) {
      const scoreRow = scores[removedIndex];
      if (!scoreRow) {
        continue;
      }
      const skipRemoved = scores[removedIndex + 1]?.[addedIndex] ?? 0;
      const skipAdded = scores[removedIndex]?.[addedIndex + 1] ?? 0;
      const pairScore = pairScores[removedIndex]?.[addedIndex] ?? 0;
      const pairValue =
        pairScore >= CHANGED_LINE_MATCH_THRESHOLD
          ? pairScore + (scores[removedIndex + 1]?.[addedIndex + 1] ?? 0)
          : Number.NEGATIVE_INFINITY;
      scoreRow[addedIndex] = Math.max(skipRemoved, skipAdded, pairValue);
    }
  }

  const alignedRows: AlignedChangedRow[] = [];
  let removedIndex = 0;
  let addedIndex = 0;
  while (removedIndex < removed.length && addedIndex < added.length) {
    const currentScore = scores[removedIndex]?.[addedIndex] ?? 0;
    const pairScore = pairScores[removedIndex]?.[addedIndex] ?? 0;
    const pairValue =
      pairScore >= CHANGED_LINE_MATCH_THRESHOLD
        ? pairScore + (scores[removedIndex + 1]?.[addedIndex + 1] ?? 0)
        : Number.NEGATIVE_INFINITY;
    if (pairValue >= currentScore && pairValue >= (scores[removedIndex + 1]?.[addedIndex] ?? 0)) {
      alignedRows.push({
        kind: "paired",
        removed: removed[removedIndex] ?? "",
        added: added[addedIndex] ?? "",
      });
      removedIndex += 1;
      addedIndex += 1;
      continue;
    }
    if (
      (scores[removedIndex + 1]?.[addedIndex] ?? 0) >= (scores[removedIndex]?.[addedIndex + 1] ?? 0)
    ) {
      alignedRows.push({
        kind: "remove",
        removed: removed[removedIndex] ?? "",
      });
      removedIndex += 1;
      continue;
    }
    alignedRows.push({
      kind: "add",
      added: added[addedIndex] ?? "",
    });
    addedIndex += 1;
  }

  while (removedIndex < removed.length) {
    alignedRows.push({
      kind: "remove",
      removed: removed[removedIndex] ?? "",
    });
    removedIndex += 1;
  }
  while (addedIndex < added.length) {
    alignedRows.push({
      kind: "add",
      added: added[addedIndex] ?? "",
    });
    addedIndex += 1;
  }

  return alignedRows;
}

function scoreChangedLinePair(left: string, right: string): number {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return normalizedLeft === normalizedRight ? 1 : 0;
  }
  const leftIndent = left.length - left.trimStart().length;
  const rightIndent = right.length - right.trimStart().length;
  const indentScore = 1 / (1 + Math.abs(leftIndent - rightIndent) / 2);

  const leftTokens = tokenizeChangedLine(normalizedLeft);
  const rightTokens = tokenizeChangedLine(normalizedRight);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return normalizedLeft === normalizedRight ? indentScore : 0;
  }

  const matrix: number[][] = Array.from({ length: leftTokens.length + 1 }, () =>
    Array.from({ length: rightTokens.length + 1 }, () => 0),
  );

  for (let leftIndex = leftTokens.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightTokens.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const currentRow = matrix[leftIndex];
      if (!currentRow) {
        continue;
      }
      if (leftTokens[leftIndex] === rightTokens[rightIndex]) {
        currentRow[rightIndex] = 1 + (matrix[leftIndex + 1]?.[rightIndex + 1] ?? 0);
      } else {
        currentRow[rightIndex] = Math.max(
          matrix[leftIndex + 1]?.[rightIndex] ?? 0,
          currentRow[rightIndex + 1] ?? 0,
        );
      }
    }
  }

  const sharedLength = matrix[0]?.[0] ?? 0;
  return (sharedLength / Math.max(leftTokens.length, rightTokens.length)) * indentScore;
}

function tokenizeChangedLine(line: string): string[] {
  return line.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
}

function shouldRenderInlineDiff(left: string, right: string): boolean {
  if (left.length > INLINE_DIFF_MAX_LINE_LENGTH || right.length > INLINE_DIFF_MAX_LINE_LENGTH) {
    return false;
  }
  const leftTokenCount = left.split(/(\s+)/).filter((part) => part.length > 0).length;
  const rightTokenCount = right.split(/(\s+)/).filter((part) => part.length > 0).length;
  return (
    leftTokenCount <= INLINE_DIFF_MAX_TOKEN_COUNT && rightTokenCount <= INLINE_DIFF_MAX_TOKEN_COUNT
  );
}

function parseDiffHunkStart(line: string): { oldLine: number; newLine: number } | null {
  const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) {
    return null;
  }
  const oldLine = Number(match[1]);
  const newLine = Number(match[2]);
  if (!Number.isFinite(oldLine) || !Number.isFinite(newLine)) {
    return null;
  }
  return { oldLine, newLine };
}

function extractDiffFilePath(lines: string[]): string | null {
  const headerLine =
    lines.find((line) => line.startsWith("+++ ") && !line.includes("/dev/null")) ??
    lines.find((line) => line.startsWith("--- ") && !line.includes("/dev/null")) ??
    null;
  if (!headerLine) {
    return null;
  }

  const candidate = headerLine.slice(4).trim();
  if (!candidate) {
    return null;
  }

  return candidate.replace(/^["']|["']$/g, "").replace(/^[ab]\//, "");
}

export function trimProjectPrefixFromPath(filePath: string, pathRoots: string[]): string {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const normalizedRoots = pathRoots.map((root) => root.replace(/\\/g, "/").replace(/\/+$/, ""));

  for (const root of normalizedRoots) {
    if (!root) {
      continue;
    }
    if (normalizedFilePath === root) {
      return normalizedFilePath.split("/").pop() ?? normalizedFilePath;
    }
    if (normalizedFilePath.startsWith(`${root}/`)) {
      return normalizedFilePath.slice(root.length + 1);
    }
  }

  return normalizedFilePath;
}

export function getPathBaseName(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  const normalized = path.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop();
  return fileName && fileName.length > 0 ? fileName : normalized;
}

function normalizeRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return null;
  }

  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        return null;
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.length > 0 ? parts.join("/") : null;
}

function diffInlineSegments(
  left: string,
  right: string,
): {
  left: Array<{ text: string; changed: boolean }>;
  right: Array<{ text: string; changed: boolean }>;
} {
  const leftTokens = left.split(/(\s+)/).filter((part) => part.length > 0);
  const rightTokens = right.split(/(\s+)/).filter((part) => part.length > 0);
  const matrix: number[][] = Array.from({ length: leftTokens.length + 1 }, () =>
    Array.from({ length: rightTokens.length + 1 }, () => 0),
  );

  for (let i = leftTokens.length - 1; i >= 0; i -= 1) {
    for (let j = rightTokens.length - 1; j >= 0; j -= 1) {
      const leftToken = leftTokens[i] ?? "";
      const rightToken = rightTokens[j] ?? "";
      const currentRow = matrix[i];
      if (!currentRow) {
        continue;
      }
      if (leftToken === rightToken) {
        currentRow[j] = (matrix[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        currentRow[j] = Math.max(matrix[i + 1]?.[j] ?? 0, currentRow[j + 1] ?? 0);
      }
    }
  }

  const leftParts: Array<{ text: string; changed: boolean }> = [];
  const rightParts: Array<{ text: string; changed: boolean }> = [];
  let i = 0;
  let j = 0;
  while (i < leftTokens.length && j < rightTokens.length) {
    const leftToken = leftTokens[i] ?? "";
    const rightToken = rightTokens[j] ?? "";
    if (leftToken === rightToken) {
      leftParts.push({ text: leftToken, changed: false });
      rightParts.push({ text: rightToken, changed: false });
      i += 1;
      j += 1;
      continue;
    }
    if ((matrix[i + 1]?.[j] ?? 0) >= (matrix[i]?.[j + 1] ?? 0)) {
      leftParts.push({ text: leftToken, changed: true });
      i += 1;
      continue;
    }
    rightParts.push({ text: rightToken, changed: true });
    j += 1;
  }

  while (i < leftTokens.length) {
    leftParts.push({ text: leftTokens[i] ?? "", changed: true });
    i += 1;
  }
  while (j < rightTokens.length) {
    rightParts.push({ text: rightTokens[j] ?? "", changed: true });
    j += 1;
  }

  return { left: leftParts, right: rightParts };
}

import { detectLanguageFromFilePath, isAddedDiffLine, isRemovedDiffLine } from "./viewerDetection";

export type DiffDisplayRow =
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
        row.kind === "context"
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
        row.kind === "context"
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
      for (const removedLine of block.removed) {
        const pairedAddedLine = block.added.shift() ?? null;
        if (pairedAddedLine) {
          const leftText = removedLine.slice(1);
          const rightText = pairedAddedLine.slice(1);
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
        rows.push({ kind: "remove", oldLine: oldLineNumber, text: removedLine.slice(1) });
        removedLineCount += 1;
        oldLineNumber += 1;
      }
      for (const addedLine of block.added) {
        rows.push({ kind: "add", newLine: newLineNumber, text: addedLine.slice(1) });
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

function resolveAbsoluteDiffFilePath(
  filePath: string | null,
  pathRoots: string[],
): string | null {
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

    const joinedPath = normalizeAbsolutePath(
      `${trimTrailingSeparators(normalizedRoot)}/${normalizedRelativePath}`,
    );
    if (!joinedPath || !isPathWithinRoot(joinedPath, normalizedRoot)) {
      continue;
    }
    candidates.add(joinedPath);
  }

  if (candidates.size !== 1) {
    return null;
  }
  return Array.from(candidates)[0] ?? null;
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

function shouldRenderInlineDiff(left: string, right: string): boolean {
  if (left.length > INLINE_DIFF_MAX_LINE_LENGTH || right.length > INLINE_DIFF_MAX_LINE_LENGTH) {
    return false;
  }
  const leftTokenCount = left.split(/(\s+)/).filter((part) => part.length > 0).length;
  const rightTokenCount = right.split(/(\s+)/).filter((part) => part.length > 0).length;
  return (
    leftTokenCount <= INLINE_DIFF_MAX_TOKEN_COUNT &&
    rightTokenCount <= INLINE_DIFF_MAX_TOKEN_COUNT
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

function normalizeAbsolutePath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/");
  const windowsPrefix = /^([A-Za-z]):\//.exec(normalized);

  if (!windowsPrefix && !normalized.startsWith("/")) {
    return null;
  }

  const rootPrefix = windowsPrefix ? `${windowsPrefix[1] ?? ""}:` : "/";
  const suffix = windowsPrefix ? normalized.slice(2) : normalized;
  const parts: string[] = [];

  for (const part of suffix.split("/")) {
    if (part.length === 0 || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  if (windowsPrefix) {
    return parts.length > 0 ? `${rootPrefix}/${parts.join("/")}` : `${rootPrefix}/`;
  }

  return parts.length > 0 ? `/${parts.join("/")}` : "/";
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
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.length > 0 ? parts.join("/") : null;
}

function isPathWithinRoot(path: string, root: string): boolean {
  const normalizedPath = normalizePathForComparison(path);
  const normalizedRoot = normalizePathForComparison(root);
  if (!normalizedPath || !normalizedRoot) {
    return false;
  }

  if (normalizedRoot === "/" || /^[a-z]:\/$/.test(normalizedRoot)) {
    return normalizedPath.startsWith(normalizedRoot);
  }

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function normalizePathForComparison(value: string): string | null {
  const normalizedAbsolute = normalizeAbsolutePath(value);
  if (!normalizedAbsolute) {
    return null;
  }

  const trimmedPath = trimTrailingSeparators(normalizedAbsolute);
  return /^[A-Za-z]:\//.test(trimmedPath) ? trimmedPath.toLowerCase() : trimmedPath;
}

function trimTrailingSeparators(value: string): string {
  if (value === "/" || /^[A-Za-z]:\/$/.test(value)) {
    return value;
  }
  return value.replace(/\/+$/, "");
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

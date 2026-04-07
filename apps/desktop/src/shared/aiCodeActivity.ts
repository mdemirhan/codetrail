import {
  buildUnifiedDiffFromTextPair,
  parseToolEditPayload,
  type ParsedToolEditFile,
} from "./toolParsing";

export type ToolEditActivityFile = {
  filePath: string;
  changeType: ParsedToolEditFile["changeType"];
  linesAdded: number;
  linesDeleted: number;
};

export type ToolEditActivitySummary = {
  files: ToolEditActivityFile[];
};

export function summarizeStoredToolEditActivity(args: {
  toolName: string | null;
  argsJson: string | null;
}): ToolEditActivitySummary | null {
  if (!args.argsJson) {
    return null;
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(args.argsJson) as unknown;
  } catch {
    return null;
  }

  const wrappedPayload =
    parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)
      ? { name: args.toolName ?? "unknown", ...(parsedArgs as Record<string, unknown>) }
      : { name: args.toolName ?? "unknown", input: parsedArgs };

  const parsedEdit = parseToolEditPayload(JSON.stringify(wrappedPayload));
  if (!parsedEdit || parsedEdit.files.length === 0) {
    return null;
  }

  return {
    files: parsedEdit.files
      .map((file) => summarizeParsedToolEditFile(file))
      .filter((file): file is ToolEditActivityFile => file !== null),
  };
}

function summarizeParsedToolEditFile(file: ParsedToolEditFile): ToolEditActivityFile | null {
  const filePath = file.filePath.trim();
  if (filePath.length === 0) {
    return null;
  }

  const lineCounts = countToolEditFileLines(file);
  return {
    filePath,
    changeType: file.changeType,
    linesAdded: lineCounts.linesAdded,
    linesDeleted: lineCounts.linesDeleted,
  };
}

function countToolEditFileLines(file: ParsedToolEditFile): {
  linesAdded: number;
  linesDeleted: number;
} {
  if (file.diff) {
    return countUnifiedDiffLineChanges(file.diff);
  }

  if (file.oldText !== null && file.newText !== null) {
    return countUnifiedDiffLineChanges(
      buildUnifiedDiffFromTextPair({
        oldText: file.oldText,
        newText: file.newText,
        filePath: file.filePath,
      }),
    );
  }

  if (file.changeType === "add" && file.newText !== null) {
    return { linesAdded: countTextLines(file.newText), linesDeleted: 0 };
  }

  if (file.changeType === "delete" && file.oldText !== null) {
    return { linesAdded: 0, linesDeleted: countTextLines(file.oldText) };
  }

  return { linesAdded: 0, linesDeleted: 0 };
}

function countUnifiedDiffLineChanges(diff: string): {
  linesAdded: number;
  linesDeleted: number;
} {
  let linesAdded = 0;
  let linesDeleted = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@")
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      linesAdded += 1;
      continue;
    }
    if (line.startsWith("-")) {
      linesDeleted += 1;
    }
  }

  return { linesAdded, linesDeleted };
}

function countTextLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const normalized = text.replace(/\r\n/g, "\n");
  let lineCount = 1;
  for (const char of normalized) {
    if (char === "\n") {
      lineCount += 1;
    }
  }
  if (normalized.endsWith("\n")) {
    lineCount -= 1;
  }
  return Math.max(lineCount, 0);
}

import { isLikelyEditOperation } from "@codetrail/core";

export function parseToolInvocationPayload(text: string): {
  record: Record<string, unknown>;
  name: string | null;
  prettyName: string | null;
  inputRecord: Record<string, unknown> | null;
  isWrite: boolean;
} | null {
  const record = tryParseJsonRecord(text);
  if (!record) {
    return null;
  }

  const functionCall = asObject(record.functionCall);
  const name =
    asNonEmptyString(record.name) ??
    asNonEmptyString(record.tool_name) ??
    asNonEmptyString(record.tool) ??
    asNonEmptyString(functionCall?.name) ??
    null;
  const inputRecord = asObject(record.input) ?? asObject(record.args) ?? asObject(record.arguments);
  const rawHint = [
    name,
    asNonEmptyString(record.operation),
    asNonEmptyString(inputRecord?.operation),
  ]
    .filter((value) => !!value)
    .join(" ");

  return {
    record,
    name,
    prettyName: name ? prettyToolName(name) : null,
    inputRecord,
    isWrite: isLikelyEditOperation(rawHint),
  };
}

function prettyToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  const mapped: Record<string, string> = {
    exec_command: "Execute Command",
    run_command: "Execute Command",
    command: "Execute Command",
    grep: "Grep",
    search: "Search",
    read: "Read",
    edit: "Edit",
    apply_patch: "Apply Patch",
    write: "Write",
    write_file: "Write File",
    str_replace: "Replace Text",
    multi_edit: "Multi Edit",
  };
  if (mapped[normalized]) {
    return mapped[normalized];
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function parseToolEditPayload(text: string): {
  filePath: string | null;
  oldText: string | null;
  newText: string | null;
  diff: string | null;
} | null {
  const parsed = tryParseJsonRecord(text);
  if (!parsed) {
    return null;
  }

  const input = asObject(parsed.input);
  const args = asObject(parsed.args);
  const payload = input ?? args ?? parsed;
  const filePath =
    asNonEmptyString(payload.file_path) ??
    asNonEmptyString(payload.path) ??
    asNonEmptyString(payload.file) ??
    asNonEmptyString(parsed.file_path) ??
    asNonEmptyString(parsed.path) ??
    null;
  const oldText =
    asString(payload.old_string) ??
    asString(payload.oldText) ??
    asString(payload.before) ??
    asString(parsed.old_string) ??
    null;
  const newText =
    asString(payload.new_string) ??
    asString(payload.newText) ??
    asString(payload.after) ??
    asString(payload.content) ??
    asString(payload.text) ??
    asString(payload.write_content) ??
    asString(payload.new_content) ??
    asString(parsed.new_string) ??
    null;
  const diff =
    asNonEmptyString(payload.diff) ??
    asNonEmptyString(payload.patch) ??
    asNonEmptyString(parsed.diff) ??
    asNonEmptyString(parsed.patch) ??
    null;
  const applyPatchInput =
    asNonEmptyString(parsed.input) ??
    asNonEmptyString(payload.input) ??
    asNonEmptyString(parsed.arguments) ??
    null;
  const normalizedDiff =
    diff ??
    (looksLikeApplyPatchPayload(parsed, payload)
      ? convertApplyPatchToUnifiedDiff(applyPatchInput)
      : null);
  const normalizedFilePath = filePath ?? extractApplyPatchFirstPath(applyPatchInput);

  return { filePath: normalizedFilePath, oldText, newText, diff: normalizedDiff };
}

export function buildUnifiedDiffFromTextPair(args: {
  oldText: string;
  newText: string;
  filePath: string | null;
}): string {
  const oldLines = args.oldText.split(/\r?\n/);
  const newLines = args.newText.split(/\r?\n/);
  const operations = buildLineOperations(oldLines, newLines);
  const hunks = buildDiffHunks(operations, 2);
  const headerFile = args.filePath ?? "file";
  const output: string[] = [`--- a/${headerFile}`, `+++ b/${headerFile}`];
  if (hunks.length === 0) {
    output.push("@@ -1,0 +1,0 @@");
    return output.join("\n");
  }

  for (const hunk of hunks) {
    output.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      ...hunk.lines,
    );
  }
  return output.join("\n");
}

function buildLineOperations(
  oldLines: string[],
  newLines: string[],
): Array<{ type: "equal" | "remove" | "add"; line: string; oldLine: number; newLine: number }> {
  const matrix: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array.from({ length: newLines.length + 1 }, () => 0),
  );

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      const currentRow = matrix[i];
      if (!currentRow) {
        continue;
      }
      if ((oldLines[i] ?? "") === (newLines[j] ?? "")) {
        currentRow[j] = (matrix[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        currentRow[j] = Math.max(matrix[i + 1]?.[j] ?? 0, currentRow[j + 1] ?? 0);
      }
    }
  }

  const operations: Array<{
    type: "equal" | "remove" | "add";
    line: string;
    oldLine: number;
    newLine: number;
  }> = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;

  while (i < oldLines.length && j < newLines.length) {
    const left = oldLines[i] ?? "";
    const right = newLines[j] ?? "";
    if (left === right) {
      operations.push({ type: "equal", line: left, oldLine, newLine });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if ((matrix[i + 1]?.[j] ?? 0) >= (matrix[i]?.[j + 1] ?? 0)) {
      operations.push({ type: "remove", line: left, oldLine, newLine: 0 });
      i += 1;
      oldLine += 1;
    } else {
      operations.push({ type: "add", line: right, oldLine: 0, newLine });
      j += 1;
      newLine += 1;
    }
  }

  while (i < oldLines.length) {
    operations.push({ type: "remove", line: oldLines[i] ?? "", oldLine, newLine: 0 });
    i += 1;
    oldLine += 1;
  }
  while (j < newLines.length) {
    operations.push({ type: "add", line: newLines[j] ?? "", oldLine: 0, newLine });
    j += 1;
    newLine += 1;
  }

  return operations;
}

function buildDiffHunks(
  operations: Array<{
    type: "equal" | "remove" | "add";
    line: string;
    oldLine: number;
    newLine: number;
  }>,
  context: number,
): Array<{
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}> {
  const hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string[];
  }> = [];
  let cursor = 0;
  while (cursor < operations.length) {
    let firstChange = -1;
    for (let index = cursor; index < operations.length; index += 1) {
      if (operations[index]?.type !== "equal") {
        firstChange = index;
        break;
      }
    }
    if (firstChange < 0) {
      break;
    }

    let hunkStart = Math.max(0, firstChange - context);
    let hunkEnd = firstChange;
    let lastChange = firstChange;
    for (let index = firstChange + 1; index < operations.length; index += 1) {
      const op = operations[index];
      if (!op) {
        continue;
      }
      if (op.type !== "equal") {
        lastChange = index;
      }
      if (index - lastChange > context) {
        break;
      }
      hunkEnd = index;
    }

    hunkEnd = Math.min(operations.length - 1, hunkEnd);
    if (lastChange + context > hunkEnd) {
      hunkEnd = Math.min(operations.length - 1, lastChange + context);
    }
    if (hunkStart > hunkEnd) {
      hunkStart = hunkEnd;
    }

    const hunkOps = operations.slice(hunkStart, hunkEnd + 1);
    const oldStartCandidate = hunkOps.find((op) => op.oldLine > 0)?.oldLine ?? 1;
    const newStartCandidate = hunkOps.find((op) => op.newLine > 0)?.newLine ?? 1;
    const oldCount = hunkOps.filter((op) => op.type !== "add").length;
    const newCount = hunkOps.filter((op) => op.type !== "remove").length;
    const lines = hunkOps.map((op) => {
      if (op.type === "remove") {
        return `-${op.line}`;
      }
      if (op.type === "add") {
        return `+${op.line}`;
      }
      return ` ${op.line}`;
    });
    hunks.push({
      oldStart: oldStartCandidate,
      oldCount,
      newStart: newStartCandidate,
      newCount,
      lines,
    });
    cursor = hunkEnd + 1;
  }
  return hunks;
}

export function tryParseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return asObject(parsed);
  } catch {
    return null;
  }
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeApplyPatchPayload(
  parsed: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const normalized = [
    asNonEmptyString(parsed.name),
    asNonEmptyString(parsed.tool),
    asNonEmptyString(parsed.type),
    asNonEmptyString(payload.operation),
    asNonEmptyString(payload.mode),
  ]
    .filter((value) => !!value)
    .join(" ")
    .toLowerCase();
  if (normalized.includes("apply_patch")) {
    return true;
  }
  return (
    asNonEmptyString(parsed.input)?.includes("*** Begin Patch") === true ||
    asNonEmptyString(payload.input)?.includes("*** Begin Patch") === true ||
    asNonEmptyString(parsed.arguments)?.includes("*** Begin Patch") === true
  );
}

function extractApplyPatchFirstPath(patchText: string | null): string | null {
  if (!patchText) {
    return null;
  }
  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith("*** Update File: ")) {
      return line.slice("*** Update File: ".length).trim() || null;
    }
    if (line.startsWith("*** Add File: ")) {
      return line.slice("*** Add File: ".length).trim() || null;
    }
    if (line.startsWith("*** Delete File: ")) {
      return line.slice("*** Delete File: ".length).trim() || null;
    }
  }
  return null;
}

function convertApplyPatchToUnifiedDiff(patchText: string | null): string | null {
  if (!patchText) {
    return null;
  }

  const lines = patchText.split(/\r?\n/);
  const output: string[] = [];
  let headerDiffIndex = -1;
  let headerOldIndex = -1;
  let headerNewIndex = -1;
  let oldPath = "";
  let newPath = "";
  let hasDiffRows = false;

  const startFile = (mode: "update" | "add" | "delete", path: string) => {
    const normalized = path.trim();
    if (!normalized) {
      return;
    }

    oldPath = mode === "add" ? "/dev/null" : `a/${normalized}`;
    newPath = mode === "delete" ? "/dev/null" : `b/${normalized}`;
    headerDiffIndex = output.length;
    output.push(`diff --git ${oldPath} ${newPath}`);
    headerOldIndex = output.length;
    output.push(`--- ${oldPath}`);
    headerNewIndex = output.length;
    output.push(`+++ ${newPath}`);
  };

  for (const line of lines) {
    if (line === "*** Begin Patch" || line === "*** End Patch" || line === "*** End of File") {
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      startFile("update", line.slice("*** Update File: ".length));
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      startFile("add", line.slice("*** Add File: ".length));
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      startFile("delete", line.slice("*** Delete File: ".length));
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      const destination = line.slice("*** Move to: ".length).trim();
      if (!destination) {
        continue;
      }
      newPath = `b/${destination}`;
      if (headerDiffIndex >= 0) {
        output[headerDiffIndex] = `diff --git ${oldPath} ${newPath}`;
      }
      if (headerNewIndex >= 0) {
        output[headerNewIndex] = `+++ ${newPath}`;
      }
      continue;
    }

    if (
      line.startsWith("@@") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ")
    ) {
      output.push(line);
      hasDiffRows = true;
    }
  }

  return hasDiffRows && output.length > 0 ? output.join("\n") : null;
}

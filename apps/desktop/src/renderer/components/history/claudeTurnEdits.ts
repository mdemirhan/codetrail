import { PROVIDER_METADATA } from "@codetrail/core/browser";

import { type ParsedToolEditFile, buildUnifiedDiffFromTextPair } from "../../../shared/toolParsing";
import { parseMessageToolPayload } from "../messages/messageToolPayload";
import {
  type TurnCombinedSourceMessage,
  type TurnSequenceEdit,
  countDiffLines,
  ensureRenderableCombinedDiff,
} from "./turnCombinedModel";

export function collectClaudeTurnEdits(messages: TurnCombinedSourceMessage[]): TurnSequenceEdit[] {
  const edits: TurnSequenceEdit[] = [];

  for (const message of messages) {
    if (PROVIDER_METADATA[message.provider].turnDiffStrategy !== "inline_reconstructed") {
      continue;
    }
    const payload = parseMessageToolPayload(message.category as never, message.content);
    const isWriteMessage =
      message.category === "tool_use" ||
      message.category === "tool_edit" ||
      payload.toolInvocation?.isWrite;
    if (!isWriteMessage) {
      continue;
    }

    if (message.toolEditFiles && message.toolEditFiles.length > 0) {
      for (const [index, file] of message.toolEditFiles.entries()) {
        const fallback = (payload.toolEdit?.files ?? []).find(
          (candidate) =>
            candidate.filePath === file.filePath ||
            candidate.previousFilePath === file.filePath ||
            candidate.filePath === file.previousFilePath,
        );
        const step = mapNormalizedFileToSequenceEdit(message, file, fallback ?? null, index);
        if (step) {
          edits.push(step);
        }
      }
      continue;
    }

    for (const [index, parsedFile] of (payload.toolEdit?.files ?? []).entries()) {
      const step = mapParsedFileToSequenceEdit(message, parsedFile, index);
      if (step) {
        edits.push(step);
      }
    }
  }

  return edits;
}

function mapNormalizedFileToSequenceEdit(
  message: TurnCombinedSourceMessage,
  file: NonNullable<TurnCombinedSourceMessage["toolEditFiles"]>[number],
  fallback: ParsedToolEditFile | null,
  fileIndex: number,
): TurnSequenceEdit | null {
  const fallbackUnifiedDiff =
    fallback?.diff ??
    (fallback && (fallback.oldText !== null || fallback.newText !== null)
      ? buildUnifiedDiffFromTextPair({
          oldText: fallback.oldText ?? "",
          newText: fallback.newText ?? "",
          filePath: fallback.filePath,
        })
      : null);
  const fallbackCounts = countDiffLines(fallbackUnifiedDiff);
  const renderable = ensureRenderableCombinedDiff({
    filePath: file.filePath,
    previousFilePath: file.previousFilePath ?? fallback?.previousFilePath ?? null,
    changeType: file.changeType,
    unifiedDiff: file.unifiedDiff ?? fallbackUnifiedDiff,
    addedLineCount: file.unifiedDiff
      ? file.addedLineCount
      : fallbackCounts.added || file.addedLineCount,
    removedLineCount: file.unifiedDiff
      ? file.removedLineCount
      : fallbackCounts.removed || file.removedLineCount,
    exactness: file.unifiedDiff || !fallback ? file.exactness : "best_effort",
  });
  if (!renderable) {
    return null;
  }
  return {
    key: `${message.id}:${fileIndex}:${renderable.filePath}`,
    messageId: message.id,
    createdAt: message.createdAt,
    provider: message.provider,
    filePath: renderable.filePath,
    previousFilePath: renderable.previousFilePath,
    changeType: renderable.changeType,
    unifiedDiff: renderable.unifiedDiff,
    addedLineCount: renderable.addedLineCount,
    removedLineCount: renderable.removedLineCount,
    exactness: renderable.exactness,
  };
}

function mapParsedFileToSequenceEdit(
  message: TurnCombinedSourceMessage,
  file: ParsedToolEditFile,
  fileIndex: number,
): TurnSequenceEdit | null {
  const unifiedDiff =
    file.diff ??
    (file.oldText !== null || file.newText !== null
      ? buildUnifiedDiffFromTextPair({
          oldText: file.oldText ?? "",
          newText: file.newText ?? "",
          filePath: file.filePath,
        })
      : null);
  const counts = countDiffLines(unifiedDiff);
  const renderable = ensureRenderableCombinedDiff({
    filePath: file.filePath,
    previousFilePath: file.previousFilePath ?? null,
    changeType: file.changeType,
    unifiedDiff,
    addedLineCount: counts.added,
    removedLineCount: counts.removed,
    exactness: unifiedDiff ? "exact" : "best_effort",
  });
  if (!renderable) {
    return null;
  }
  return {
    key: `${message.id}:${fileIndex}:${renderable.filePath}`,
    messageId: message.id,
    createdAt: message.createdAt,
    provider: message.provider,
    filePath: renderable.filePath,
    previousFilePath: renderable.previousFilePath,
    changeType: renderable.changeType,
    unifiedDiff: renderable.unifiedDiff,
    addedLineCount: renderable.addedLineCount,
    removedLineCount: renderable.removedLineCount,
    exactness: renderable.exactness,
  };
}

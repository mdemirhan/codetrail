import type { MessageCategory } from "@codetrail/core/browser";
import { PROVIDER_LIST } from "@codetrail/core/browser";

import { collectClaudeTurnEdits } from "./claudeTurnEdits";
import { collectRawTurnEdits } from "./rawTurnEdits";
import {
  type TurnCombinedFile,
  type TurnCombinedSourceMessage,
  type TurnSequenceEdit,
  countDiffLines,
} from "./turnCombinedModel";

export type TurnCombinedMessage = TurnCombinedSourceMessage & {
  category: MessageCategory;
};

const RAW_TURN_DIFF_PROVIDERS = PROVIDER_LIST.filter(
  (provider) => provider.turnDiffStrategy === "raw_tool_payload",
).map((provider) => provider.id);
const RAW_TURN_DIFF_FALLBACK_PROVIDERS = PROVIDER_LIST.filter(
  (provider) => provider.turnDiffStrategy === "raw_tool_payload_fallback",
).map((provider) => provider.id);

export function aggregateTurnCombinedFiles(messages: TurnCombinedMessage[]): TurnCombinedFile[] {
  const grouped = groupEditsByFile(
    [
      ...collectClaudeTurnEdits(messages),
      ...collectRawTurnEdits(messages, { providers: RAW_TURN_DIFF_PROVIDERS }),
      ...collectRawTurnEdits(messages, {
        providers: RAW_TURN_DIFF_FALLBACK_PROVIDERS,
        allowTouchedFileFallback: true,
      }),
    ].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.messageId.localeCompare(right.messageId) ||
        left.key.localeCompare(right.key),
    ),
  );

  return Array.from(grouped.values())
    .map((steps) => aggregateFileSteps(steps))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function groupEditsByFile(edits: TurnSequenceEdit[]): Map<string, TurnSequenceEdit[]> {
  const groups = new Map<string, TurnSequenceEdit[]>();

  for (const edit of edits) {
    const currentKey = groups.has(edit.filePath)
      ? edit.filePath
      : edit.previousFilePath && groups.has(edit.previousFilePath)
        ? edit.previousFilePath
        : edit.filePath;
    const steps = groups.get(currentKey) ?? [];
    steps.push(edit);
    if (currentKey !== edit.filePath) {
      groups.delete(currentKey);
      groups.set(edit.filePath, steps);
    } else {
      groups.set(currentKey, steps);
    }
  }

  return groups;
}

function aggregateFileSteps(steps: TurnSequenceEdit[]): TurnCombinedFile {
  const first = steps[0];
  if (!first) {
    throw new Error("aggregateFileSteps requires at least one edit step");
  }
  const identity = deriveCombinedFileIdentity(steps);
  const isExactSingleEdit = steps.length === 1 && first.exactness === "exact";
  const displayUnifiedDiff = isExactSingleEdit ? first.unifiedDiff : null;
  const counts = isExactSingleEdit ? countDiffLines(displayUnifiedDiff) : sumSequenceCounts(steps);
  return {
    filePath: identity.filePath,
    previousFilePath: identity.previousFilePath,
    changeType: identity.changeType,
    renderMode: isExactSingleEdit ? "diff" : "sequence",
    displayUnifiedDiff,
    addedLineCount: counts.added,
    removedLineCount: counts.removed,
    sequenceEdits: steps,
  };
}

function deriveCombinedFileIdentity(steps: TurnSequenceEdit[]): {
  filePath: string;
  previousFilePath: string | null;
  changeType: "add" | "update" | "delete" | "move";
} {
  const first = steps[0];
  const last = steps.at(-1);
  if (!first || !last) {
    throw new Error("deriveCombinedFileIdentity requires at least one edit step");
  }

  const initialPath =
    first.changeType === "add" ? null : (first.previousFilePath ?? first.filePath);
  const hasRename = initialPath !== null && initialPath !== last.filePath;
  const changeType =
    last.changeType === "delete"
      ? "delete"
      : initialPath === null
        ? "add"
        : hasRename || steps.some((step) => step.changeType === "move")
          ? "move"
          : "update";

  return {
    filePath: last.filePath,
    previousFilePath: initialPath,
    changeType,
  };
}

function sumSequenceCounts(steps: TurnSequenceEdit[]): { added: number; removed: number } {
  return steps.reduce(
    (totals, step) => {
      totals.added += step.addedLineCount;
      totals.removed += step.removedLineCount;
      return totals;
    },
    { added: 0, removed: 0 },
  );
}

import { useEffect, useMemo, useState } from "react";

import type { useHistoryController } from "../../features/useHistoryController";
import { copyTextToClipboard } from "../../lib/clipboard";
import { usePaneFocus } from "../../lib/paneFocusController";
import { ToolbarIcon } from "../ToolbarIcon";
import { MessageCard } from "../messages/MessageCard";
import {
  CodeBlock,
  DiffBlock,
  useDocumentCollapseMultiFileToolDiffs,
} from "../messages/textRendering";
import { formatToolEditFileSummary } from "../messages/toolEditUtils";
import { trimProjectPrefixFromPath } from "../messages/viewerDiffModel";
import { aggregateTurnCombinedFiles } from "./turnCombinedDiff";
import type { TurnCombinedFile, TurnSequenceEdit } from "./turnCombinedModel";

type HistoryController = ReturnType<typeof useHistoryController>;
type TurnMessage = NonNullable<HistoryController["sessionTurnDetail"]>["messages"][number];

export function TurnView({ history }: { history: HistoryController }) {
  const detail = history.sessionTurnDetail;
  const orderedMessages = history.turnVisibleMessages;
  const combinedSourceMessages = useMemo(
    () =>
      [...(detail?.messages ?? [])]
        .filter((message) => message.category !== "user")
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        ),
    [detail?.messages],
  );
  const combinedFiles = useMemo(
    () => aggregateTurnCombinedFiles(combinedSourceMessages),
    [combinedSourceMessages],
  );

  if (!detail) {
    return <p className="empty-state">No turn messages found.</p>;
  }

  const firstMessage = orderedMessages[0] ?? null;
  const renderAnchorFirst =
    firstMessage !== null &&
    firstMessage.id === detail.anchorMessageId &&
    firstMessage.category === "user";
  const remainingMessages = renderAnchorFirst ? orderedMessages.slice(1) : orderedMessages;

  return (
    <>
      {renderAnchorFirst && firstMessage ? (
        <TurnMessageCard
          history={history}
          message={firstMessage}
          cardRef={
            history.focusMessageId === firstMessage.id ? history.refs.focusedMessageRef : null
          }
        />
      ) : null}
      <CombinedChangesCard
        key={detail.anchorMessageId}
        expanded={history.effectiveTurnCombinedChangesExpanded}
        onExpandedChange={(value) => {
          const nextExpanded =
            typeof value === "function"
              ? value(history.effectiveTurnCombinedChangesExpanded)
              : value;
          history.setTurnViewCombinedChangesExpanded(nextExpanded);
          history.setTurnViewCombinedChangesExpandedOverride(null);
        }}
        files={combinedFiles}
        query={history.effectiveTurnQuery}
        highlightPatterns={detail.highlightPatterns ?? []}
        pathRoots={history.messagePathRoots}
      />
      {remainingMessages.map((message) => (
        <TurnMessageCard
          key={message.id}
          history={history}
          message={message}
          cardRef={history.focusMessageId === message.id ? history.refs.focusedMessageRef : null}
        />
      ))}
    </>
  );
}

function TurnMessageCard({
  history,
  message,
  cardRef,
}: {
  history: HistoryController;
  message: TurnMessage;
  cardRef: HistoryController["refs"]["focusedMessageRef"] | null;
}) {
  return (
    <MessageCard
      message={message}
      query={history.effectiveTurnQuery}
      highlightPatterns={history.sessionTurnDetail?.highlightPatterns ?? []}
      pathRoots={history.messagePathRoots}
      isFocused={message.id === history.focusMessageId}
      isBookmarked={history.bookmarkedMessageIds.has(message.id)}
      isExpanded={
        history.messageExpansionOverrides[message.id] ??
        history.turnViewExpandedByDefaultCategories.includes(message.category)
      }
      onToggleExpanded={history.handleToggleMessageExpandedInTurn}
      onToggleCategoryExpanded={history.handleToggleVisibleCategoryMessagesExpandedInTurn}
      onToggleBookmark={history.handleToggleBookmark}
      cardRef={cardRef}
      onRevealInSession={history.handleRevealInSessionWithTurnExit}
      onRevealInProject={history.handleRevealInProjectWithTurnExit}
      {...(history.bookmarkedMessageIds.has(message.id)
        ? { onRevealInBookmarks: history.handleRevealInBookmarksWithTurnExit }
        : {})}
    />
  );
}

function CombinedChangesCard({
  expanded,
  onExpandedChange,
  files,
  query,
  highlightPatterns,
  pathRoots,
}: {
  expanded: boolean;
  onExpandedChange: (value: boolean | ((current: boolean) => boolean)) => void;
  files: TurnCombinedFile[];
  query: string;
  highlightPatterns: string[];
  pathRoots: string[];
}) {
  const paneFocus = usePaneFocus();
  const preserveMessagePaneFocusProps = paneFocus.getPreservePaneFocusProps("message");
  const collapseMultiFileToolDiffs = useDocumentCollapseMultiFileToolDiffs();
  const defaultDiffExpanded = !collapseMultiFileToolDiffs;
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>(() =>
    buildCombinedDiffExpansionState(files, defaultDiffExpanded),
  );
  const preview =
    files.length === 0
      ? "No file changes in this turn"
      : formatToolEditFileSummary(
          files.map((file) => ({
            filePath: file.filePath,
            changeType: file.changeType === "move" ? "update" : file.changeType,
            oldText: null,
            newText: null,
            diff: file.displayUnifiedDiff,
          })),
        );
  const isEmpty = files.length === 0;
  const allFilesExpanded =
    files.length > 0 &&
    files.every((file) => expandedFiles[buildCombinedFileKey(file)] ?? defaultDiffExpanded);

  useEffect(() => {
    setExpandedFiles((current) =>
      reconcileCombinedDiffExpansionState(current, files, defaultDiffExpanded),
    );
  }, [defaultDiffExpanded, files]);

  const handleCopy = () => {
    const text =
      files.length === 0
        ? "No file changes in this turn."
        : buildCombinedCopyValue(files, pathRoots);
    void copyTextToClipboard(text);
    paneFocus.focusHistoryPane("message");
  };

  return (
    <article
      className={`message category-tool_edit turn-combined-card${expanded ? " expanded" : " collapsed"}${isEmpty ? " is-empty" : ""}`}
    >
      <header className="message-header">
        <button
          type="button"
          className="message-toggle-button"
          {...preserveMessagePaneFocusProps}
          onClick={() => {
            onExpandedChange((value) => !value);
            paneFocus.focusHistoryPane("message");
          }}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse combined changes" : "Expand combined changes"}
          title="Toggle combined changes details"
        >
          <svg className="msg-chevron" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className="msg-role category-tool_edit">Combined Changes</span>
          {!expanded ? <span className="message-preview">{preview}</span> : null}
        </button>
        <div className="message-header-actions">
          {files.length > 0 ? (
            <button
              type="button"
              className="message-action-button message-icon-button"
              {...preserveMessagePaneFocusProps}
              onClick={() => {
                const nextExpanded = !allFilesExpanded;
                setExpandedFiles(buildCombinedDiffExpansionState(files, nextExpanded));
                paneFocus.focusHistoryPane("message");
              }}
              aria-label={allFilesExpanded ? "Collapse Diffs" : "Expand Diffs"}
              title={allFilesExpanded ? "Collapse Diffs" : "Expand Diffs"}
            >
              <ToolbarIcon name={allFilesExpanded ? "collapseAll" : "expandAll"} />
            </button>
          ) : null}
          <button
            type="button"
            className="message-action-button message-icon-button"
            {...preserveMessagePaneFocusProps}
            onClick={handleCopy}
            aria-label="Copy combined changes"
            title="Copy combined changes"
          >
            <ToolbarIcon name="copy" />
          </button>
        </div>
      </header>
      {expanded ? (
        files.length === 0 ? (
          <div className="message-body turn-combined-empty-body">
            <p className="empty-state turn-combined-empty-state">No file changes in this turn.</p>
          </div>
        ) : (
          <div className="message-body">
            <div className="message-content">
              <div className="tool-edit-view turn-combined-body">
                <div className="tool-edit-summary">{preview}</div>
                {files.map((file) => {
                  const fileExpanded =
                    expandedFiles[buildCombinedFileKey(file)] ?? defaultDiffExpanded;
                  return (
                    <div key={buildCombinedFileKey(file)} className="turn-combined-file">
                      <TurnCombinedFileView
                        file={file}
                        expanded={fileExpanded}
                        defaultExpanded={defaultDiffExpanded}
                        onExpandedChange={(nextExpanded) => {
                          setExpandedFiles((current) => ({
                            ...current,
                            [buildCombinedFileKey(file)]: nextExpanded,
                          }));
                        }}
                        pathRoots={pathRoots}
                        query={query}
                        highlightPatterns={highlightPatterns}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      ) : null}
    </article>
  );
}

function buildCombinedFileKey(file: TurnCombinedFile): string {
  return `${file.previousFilePath ?? ""}->${file.filePath}`;
}

function buildCombinedFileLabel(file: TurnCombinedFile, pathRoots: string[]): string {
  const currentPath = trimProjectPrefixFromPath(file.filePath, pathRoots);
  if (file.previousFilePath && file.previousFilePath !== file.filePath) {
    return `${trimProjectPrefixFromPath(file.previousFilePath, pathRoots)} -> ${currentPath}`;
  }
  return currentPath;
}

function buildCombinedDiffExpansionState(
  files: TurnCombinedFile[],
  expanded: boolean,
): Record<string, boolean> {
  return Object.fromEntries(files.map((file) => [buildCombinedFileKey(file), expanded]));
}

function reconcileCombinedDiffExpansionState(
  current: Record<string, boolean>,
  files: TurnCombinedFile[],
  defaultExpanded: boolean,
): Record<string, boolean> {
  const nextEntries = files.map((file) => {
    const key = buildCombinedFileKey(file);
    return [key, current[key] ?? defaultExpanded] as const;
  });
  return Object.fromEntries(nextEntries);
}

function buildCombinedFileBadges(
  file: TurnCombinedFile,
): Array<{ label: string; title?: string; onClick?: () => void }> {
  const badges: Array<{ label: string; title?: string; onClick?: () => void }> = [];
  if (file.changeType === "delete") {
    badges.push({
      label: "Deleted",
      title: "Deleted in this turn",
    });
  } else if (file.changeType === "add") {
    badges.push({
      label: "New File",
      title: "Created in this turn",
    });
  }
  if (file.previousFilePath && file.previousFilePath !== file.filePath) {
    badges.push({
      label: "Renamed",
      title: `Renamed from ${file.previousFilePath}`,
    });
  }
  return badges;
}

function TurnCombinedFileView({
  file,
  expanded,
  defaultExpanded,
  onExpandedChange,
  pathRoots,
  query,
  highlightPatterns,
}: {
  file: TurnCombinedFile;
  expanded: boolean;
  defaultExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  pathRoots: string[];
  query: string;
  highlightPatterns: string[];
}) {
  if (file.renderMode === "diff" && file.displayUnifiedDiff) {
    return (
      <DiffBlock
        codeValue={file.displayUnifiedDiff}
        filePath={file.filePath}
        pathRoots={pathRoots}
        query={query}
        highlightPatterns={highlightPatterns}
        metaBadges={buildCombinedFileBadges(file)}
        collapsible
        defaultExpanded={defaultExpanded}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
      />
    );
  }

  return (
    <CodeBlock
      language="diff"
      codeValue={buildSequenceDisplayDiff(file.sequenceEdits)}
      metaLabel={trimProjectPrefixFromPath(file.filePath, pathRoots)}
      filePath={file.filePath}
      pathRoots={pathRoots}
      query={query}
      highlightPatterns={highlightPatterns}
      metaBadges={buildCombinedFileBadges(file)}
      collapsible
      defaultExpanded={defaultExpanded}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  );
}

function buildCombinedCopyValue(files: TurnCombinedFile[], pathRoots: string[]): string {
  return files
    .map((file) => {
      if (file.renderMode === "diff" && file.displayUnifiedDiff) {
        return file.displayUnifiedDiff;
      }
      return [
        `${buildCombinedFileLabel(file, pathRoots)}`,
        buildSequenceCopyValue(file.sequenceEdits),
      ].join("\n");
    })
    .join("\n\n");
}

function buildSequenceCopyValue(sequenceEdits: TurnSequenceEdit[]): string {
  return buildSequenceText(sequenceEdits, "\n\n");
}

function buildSequenceDisplayDiff(sequenceEdits: TurnSequenceEdit[]): string {
  return buildSequenceText(sequenceEdits, "\n");
}

function buildSequenceText(sequenceEdits: TurnSequenceEdit[], separator: string): string {
  if (sequenceEdits.length <= 1) {
    return sequenceEdits[0]?.unifiedDiff.trimEnd() ?? "";
  }
  return sequenceEdits
    .map((edit, index) =>
      [
        formatSequenceMarkerLabel(index + 1, sequenceEdits.length, edit),
        edit.unifiedDiff.trimEnd(),
      ].join("\n"),
    )
    .join(separator);
}

function formatSequenceMarkerLabel(
  editNumber: number,
  totalEdits: number,
  edit: TurnSequenceEdit,
): string {
  return `Edit ${editNumber} of ${totalEdits} | +${edit.addedLineCount} -${edit.removedLineCount} | ${formatSequenceTimeLabel(edit.createdAt)}`;
}

function formatSequenceTimeLabel(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

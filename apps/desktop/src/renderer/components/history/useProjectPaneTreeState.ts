import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ProjectSortField,
  ProjectSummary,
  ProjectViewMode,
  TreeAutoRevealSessionRequest,
} from "../../app/types";
import { buildProjectFolderGroups } from "../../lib/projectTree";
import { mergeStableOrder } from "../../lib/projectUpdates";
import type { ProjectPaneHistoryMode, ProjectPaneTreeFocusedRow } from "./ProjectPane.types";

type UseProjectPaneTreeStateArgs = {
  sortedProjects: ProjectSummary[];
  selectedProjectId: string;
  selectedSessionId: string;
  sortField: ProjectSortField;
  sortDirection: "asc" | "desc";
  viewMode: ProjectViewMode;
  updateSource: "auto" | "resort";
  historyMode: ProjectPaneHistoryMode;
  projectProvidersKey: string;
  projectQueryInput: string;
  onEnsureTreeProjectSessionsLoaded: (projectId: string) => void;
  autoRevealSessionRequest: TreeAutoRevealSessionRequest | null;
  onConsumeAutoRevealSessionRequest: () => void;
};

export function useProjectPaneTreeState({
  sortedProjects,
  selectedProjectId,
  selectedSessionId,
  sortField,
  sortDirection,
  viewMode,
  updateSource,
  historyMode,
  projectProvidersKey,
  projectQueryInput,
  onEnsureTreeProjectSessionsLoaded,
  autoRevealSessionRequest,
  onConsumeAutoRevealSessionRequest,
}: UseProjectPaneTreeStateArgs) {
  const folderOrderControlKeyRef = useRef("");
  const expandedFoldersSeedKeyRef = useRef("");
  const [folderOrderIds, setFolderOrderIds] = useState<string[]>([]);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [treeFocusedRow, setTreeFocusedRow] = useState<ProjectPaneTreeFocusedRow | null>(null);

  const folderOrderControlKey = useMemo(
    () => [sortField, sortDirection, projectProvidersKey, projectQueryInput].join("\u0000"),
    [projectProvidersKey, projectQueryInput, sortDirection, sortField],
  );
  const naturalFolderGroups = useMemo(
    () => buildProjectFolderGroups(sortedProjects, sortField, sortDirection),
    [sortedProjects, sortDirection, sortField],
  );

  useEffect(() => {
    if (viewMode !== "tree") {
      setTreeFocusedRow(null);
      return;
    }
    setTreeFocusedRow((current) => {
      if (current) {
        return current;
      }
      if (
        historyMode === "session" &&
        selectedProjectId &&
        selectedSessionId &&
        expandedProjectIds.includes(selectedProjectId)
      ) {
        return { kind: "session", id: selectedSessionId, projectId: selectedProjectId };
      }
      if (!selectedProjectId) {
        return current;
      }
      return { kind: "project", id: selectedProjectId };
    });
  }, [expandedProjectIds, historyMode, selectedProjectId, selectedSessionId, viewMode]);

  useEffect(() => {
    if (viewMode !== "tree") {
      expandedFoldersSeedKeyRef.current = "";
      setExpandedFolderIds([]);
      setExpandedProjectIds([]);
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "tree" || !autoRevealSessionRequest) {
      return;
    }

    onEnsureTreeProjectSessionsLoaded(autoRevealSessionRequest.projectId);
    setExpandedProjectIds((current) =>
      current.includes(autoRevealSessionRequest.projectId)
        ? current
        : [...current, autoRevealSessionRequest.projectId],
    );
  }, [autoRevealSessionRequest, onEnsureTreeProjectSessionsLoaded, viewMode]);

  useEffect(() => {
    if (
      viewMode !== "tree" ||
      !autoRevealSessionRequest ||
      !expandedProjectIds.includes(autoRevealSessionRequest.projectId)
    ) {
      return;
    }

    onEnsureTreeProjectSessionsLoaded(autoRevealSessionRequest.projectId);
    const sessionRow = document.querySelector<HTMLElement>(
      `[data-project-nav-kind="session"][data-session-id="${CSS.escape(autoRevealSessionRequest.sessionId)}"]`,
    );
    if (!sessionRow) {
      return;
    }

    setTreeFocusedRow({
      kind: "session",
      id: autoRevealSessionRequest.sessionId,
      projectId: autoRevealSessionRequest.projectId,
    });
    sessionRow.scrollIntoView?.({ block: "nearest" });
    onConsumeAutoRevealSessionRequest();
  }, [
    autoRevealSessionRequest,
    expandedProjectIds,
    onConsumeAutoRevealSessionRequest,
    onEnsureTreeProjectSessionsLoaded,
    viewMode,
  ]);

  useEffect(() => {
    if (
      viewMode !== "tree" ||
      historyMode !== "session" ||
      !selectedProjectId ||
      !selectedSessionId ||
      !expandedProjectIds.includes(selectedProjectId)
    ) {
      return;
    }
    onEnsureTreeProjectSessionsLoaded(selectedProjectId);
    const selectedSessionRow = document.querySelector<HTMLElement>(
      `[data-project-nav-kind="session"][data-session-id="${CSS.escape(selectedSessionId)}"]`,
    );
    selectedSessionRow?.scrollIntoView?.({ block: "nearest" });
  }, [
    expandedProjectIds,
    historyMode,
    onEnsureTreeProjectSessionsLoaded,
    selectedProjectId,
    selectedSessionId,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== "tree") {
      return;
    }

    const nextIds = naturalFolderGroups.map((group) => group.id);
    const didControlsChange = folderOrderControlKeyRef.current !== folderOrderControlKey;
    folderOrderControlKeyRef.current = folderOrderControlKey;

    setFolderOrderIds((current) => {
      if (didControlsChange || updateSource !== "auto" || current.length === 0) {
        return nextIds;
      }
      return mergeStableOrder(current, nextIds);
    });
  }, [folderOrderControlKey, naturalFolderGroups, updateSource, viewMode]);

  const folderGroups = useMemo(() => {
    if (viewMode !== "tree" || folderOrderIds.length === 0) {
      return naturalFolderGroups;
    }
    const groupsById = new Map(naturalFolderGroups.map((group) => [group.id, group] as const));
    return folderOrderIds
      .map((groupId) => groupsById.get(groupId) ?? null)
      .filter((group): group is (typeof naturalFolderGroups)[number] => group !== null);
  }, [folderOrderIds, naturalFolderGroups, viewMode]);

  useEffect(() => {
    if (viewMode !== "tree") {
      return;
    }

    setExpandedFolderIds((current) => {
      const nextVisibleFolderIds = folderGroups.map((group) => group.id);
      const visibleFolderIds = new Set(nextVisibleFolderIds);
      const initialExpandedFolderIds = folderGroups
        .filter(
          (group) =>
            projectQueryInput.trim().length > 0 ||
            group.projects.some((project) => project.id === selectedProjectId),
        )
        .map((group) => group.id);
      const expandedFoldersSeedKey = `${folderOrderControlKey}\u0000${nextVisibleFolderIds.join("\u0001")}`;
      const shouldResetForVisibleFolders =
        nextVisibleFolderIds.length > 0 &&
        expandedFoldersSeedKeyRef.current !== expandedFoldersSeedKey;
      if (shouldResetForVisibleFolders) {
        expandedFoldersSeedKeyRef.current = expandedFoldersSeedKey;
        return initialExpandedFolderIds;
      }
      const next = current.filter((groupId) => visibleFolderIds.has(groupId));
      return next.length === current.length ? current : next;
    });
  }, [folderGroups, folderOrderControlKey, projectQueryInput, selectedProjectId, viewMode]);

  const expandedFolderIdSet = useMemo(() => new Set(expandedFolderIds), [expandedFolderIds]);
  const allVisibleFoldersExpanded =
    folderGroups.length > 0 && folderGroups.every((group) => expandedFolderIdSet.has(group.id));

  const handleToggleFolder = (folderId: string) => {
    setExpandedFolderIds((current) =>
      current.includes(folderId)
        ? current.filter((value) => value !== folderId)
        : [...current, folderId],
    );
  };

  const handleToggleAllFolders = () => {
    setExpandedFolderIds(allVisibleFoldersExpanded ? [] : folderGroups.map((group) => group.id));
  };

  const handleToggleProjectExpansion = (projectId: string) => {
    const nextExpanded = !expandedProjectIds.includes(projectId);
    if (nextExpanded) {
      onEnsureTreeProjectSessionsLoaded(projectId);
    }
    setExpandedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((value) => value !== projectId)
        : [...current, projectId],
    );
  };

  return {
    folderGroups,
    expandedFolderIdSet,
    expandedProjectIds,
    allVisibleFoldersExpanded,
    treeFocusedRow,
    setTreeFocusedRow,
    handleToggleFolder,
    handleToggleAllFolders,
    handleToggleProjectExpansion,
  };
}

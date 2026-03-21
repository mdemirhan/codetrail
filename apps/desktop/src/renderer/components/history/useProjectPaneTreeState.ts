import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectSortField, ProjectSummary, ProjectViewMode } from "../../app/types";
import { buildProjectFolderGroups } from "../../lib/projectTree";
import { mergeStableProjectOrder } from "../../lib/projectUpdates";
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
}: UseProjectPaneTreeStateArgs) {
  const folderOrderControlKeyRef = useRef("");
  const folderExpansionResetKeyRef = useRef<string | null>(null);
  const seenFolderIdsRef = useRef<Set<string>>(new Set());
  const [folderOrderIds, setFolderOrderIds] = useState<string[]>([]);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [treeFocusedRow, setTreeFocusedRow] = useState<ProjectPaneTreeFocusedRow | null>(null);

  const folderExpansionResetKey = useMemo(
    () => [sortField, sortDirection, projectProvidersKey, projectQueryInput].join("\u0000"),
    [projectProvidersKey, projectQueryInput, sortDirection, sortField],
  );
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
    if (
      historyMode === "session" &&
      selectedProjectId &&
      selectedSessionId &&
      expandedProjectIds.includes(selectedProjectId)
    ) {
      setTreeFocusedRow({ kind: "session", id: selectedSessionId, projectId: selectedProjectId });
      return;
    }
    if (!selectedProjectId) {
      return;
    }
    setTreeFocusedRow({ kind: "project", id: selectedProjectId });
  }, [expandedProjectIds, historyMode, selectedProjectId, selectedSessionId, viewMode]);

  useEffect(() => {
    if (viewMode !== "tree") {
      folderExpansionResetKeyRef.current = null;
      seenFolderIdsRef.current.clear();
      setExpandedFolderIds([]);
      setExpandedProjectIds([]);
      return;
    }
    if (folderExpansionResetKeyRef.current === folderExpansionResetKey) {
      return;
    }
    folderExpansionResetKeyRef.current = folderExpansionResetKey;
    seenFolderIdsRef.current.clear();
  }, [folderExpansionResetKey, viewMode]);

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
      return mergeStableProjectOrder(current, nextIds);
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
      const visibleFolderIds = new Set(folderGroups.map((group) => group.id));
      const next = current.filter((groupId) => visibleFolderIds.has(groupId));
      const nextSet = new Set(next);
      let changed = next.length !== current.length;

      for (const group of folderGroups) {
        const isNewFolder = !seenFolderIdsRef.current.has(group.id);
        seenFolderIdsRef.current.add(group.id);
        const shouldForceOpen =
          projectQueryInput.trim().length > 0 ||
          group.projects.some((project) => project.id === selectedProjectId);
        if ((isNewFolder || shouldForceOpen) && !nextSet.has(group.id)) {
          next.push(group.id);
          nextSet.add(group.id);
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [folderGroups, projectQueryInput, selectedProjectId, viewMode]);

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

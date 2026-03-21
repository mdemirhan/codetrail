import type { Provider } from "@codetrail/core/browser";
import type { Ref } from "react";

import type {
  ProjectSortField,
  ProjectSummary,
  ProjectViewMode,
  SessionSummary,
} from "../../app/types";

export type ProjectPaneHistoryMode = "session" | "bookmarks" | "project_all";

export type ProjectPaneTreeFocusedRow =
  | { kind: "folder"; id: string }
  | { kind: "project"; id: string }
  | { kind: "session"; id: string; projectId: string };

export type ProjectPaneContextMenuState =
  | {
      kind: "project";
      projectId: string;
      x: number;
      y: number;
    }
  | {
      kind: "session";
      projectId: string;
      sessionId: string;
      x: number;
      y: number;
    }
  | null;

export type ProjectPaneData = {
  sortedProjects: ProjectSummary[];
  selectedProjectId: string;
  selectedSessionId?: string;
  viewMode: ProjectViewMode;
  updateSource: "auto" | "resort";
  historyMode?: ProjectPaneHistoryMode;
  collapsed: boolean;
  projectQueryInput: string;
  projectProviders: Provider[];
  providers: Provider[];
  projectProviderCounts: Record<Provider, number>;
  projectUpdates: Record<string, { messageDelta: number; updatedAt: number }>;
  treeProjectSessionsByProjectId?: Record<string, SessionSummary[]>;
  treeProjectSessionsLoadingByProjectId?: Record<string, boolean>;
  listRef?: Ref<HTMLDivElement>;
};

export type ProjectPaneSorting = {
  sortField: ProjectSortField;
  sortDirection: "asc" | "desc";
  sessionSortDirection?: "asc" | "desc";
};

export type ProjectPanePreferences = {
  singleClickFoldersExpand?: boolean;
  singleClickProjectsExpand?: boolean;
};

export type ProjectPaneCapabilities = {
  canCopyProjectDetails: boolean;
  canOpenProjectLocation: boolean;
  canDeleteProject: boolean;
};

export type ProjectPaneActions = {
  onToggleCollapsed: () => void;
  onProjectQueryChange: (value: string) => void;
  onToggleProvider: (provider: Provider) => void;
  onSetSortField: (value: ProjectSortField) => void;
  onToggleSortDirection: () => void;
  onToggleSessionSortDirection?: () => void;
  onToggleViewMode: () => void;
  onToggleSingleClickFoldersExpand: () => void;
  onToggleSingleClickProjectsExpand: () => void;
  onCopyProjectDetails: (projectId?: string) => void;
  onCopySession: (sessionId?: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectProjectSession?: (projectId: string, sessionId: string) => void;
  onSelectProjectBookmarks?: (projectId: string) => void;
  onEnsureTreeProjectSessionsLoaded?: (projectId: string) => void;
  onOpenProjectLocation: (projectId?: string) => void;
  onOpenSessionLocation: (sessionId?: string) => void;
  onDeleteProject: (projectId?: string) => void;
  onDeleteSession: (sessionId?: string) => void;
};

export type ProjectPaneProps = {
  data: ProjectPaneData;
  sorting: ProjectPaneSorting;
  preferences: ProjectPanePreferences;
  capabilities: ProjectPaneCapabilities;
  actions: ProjectPaneActions;
};

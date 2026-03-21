import type { ProjectSortField, ProjectSummary, SortDirection } from "../app/types";
import { compactPath, compareRecent } from "./viewUtils";

const ROOT_OTHER_LOCATIONS = "__other_locations__";
const PROJECT_FOLDER_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export type ProjectFolderGroup = {
  id: string;
  label: string;
  projects: ProjectSummary[];
  projectCount: number;
  sessionCount: number;
  lastActivity: string | null;
};

function trimTrailingSeparators(path: string, separator: "/" | "\\"): string {
  if (path === separator) {
    return path;
  }
  return path.replace(new RegExp(`${separator === "\\" ? "\\\\" : separator}+$`), "");
}

function normalizeProjectPath(path: string): string | null {
  const value = path.trim();
  if (!value) {
    return null;
  }

  if (value.includes("\\")) {
    return trimTrailingSeparators(value, "\\");
  }

  return trimTrailingSeparators(value, "/");
}

export function getProjectGroupId(project: ProjectSummary): string {
  const projectPath = normalizeProjectPath(project.path);
  if (!projectPath) {
    return ROOT_OTHER_LOCATIONS;
  }
  return projectPath;
}

function getGroupIdAndLabel(project: ProjectSummary): { id: string; label: string } {
  const id = getProjectGroupId(project);
  if (id === ROOT_OTHER_LOCATIONS) {
    return {
      id,
      label: "Other Locations",
    };
  }
  return {
    id,
    label: compactPath(id),
  };
}

function compareFolderGroupsByField(
  left: ProjectFolderGroup,
  right: ProjectFolderGroup,
  sortField: ProjectSortField,
): number {
  if (sortField === "name") {
    return (
      PROJECT_FOLDER_COLLATOR.compare(left.label, right.label) ||
      compareRecent(left.lastActivity, right.lastActivity) ||
      left.id.localeCompare(right.id)
    );
  }

  return (
    compareRecent(left.lastActivity, right.lastActivity) ||
    PROJECT_FOLDER_COLLATOR.compare(left.label, right.label) ||
    left.id.localeCompare(right.id)
  );
}

export function buildProjectFolderGroups(
  projects: ProjectSummary[],
  sortField: ProjectSortField,
  sortDirection: SortDirection,
): ProjectFolderGroup[] {
  const groups = new Map<string, ProjectFolderGroup>();

  for (const project of projects) {
    const { id, label } = getGroupIdAndLabel(project);
    const existing = groups.get(id);
    if (existing) {
      existing.projects.push(project);
      existing.projectCount += 1;
      existing.sessionCount += project.sessionCount;
      if (compareRecent(project.lastActivity, existing.lastActivity) > 0) {
        existing.lastActivity = project.lastActivity;
      }
      continue;
    }

    groups.set(id, {
      id,
      label,
      projects: [project],
      projectCount: 1,
      sessionCount: project.sessionCount,
      lastActivity: project.lastActivity,
    });
  }

  const next = [...groups.values()];
  next.sort((left, right) => {
    if (left.id === ROOT_OTHER_LOCATIONS || right.id === ROOT_OTHER_LOCATIONS) {
      if (left.id === right.id) {
        return 0;
      }
      return left.id === ROOT_OTHER_LOCATIONS ? 1 : -1;
    }
    const naturalOrder = compareFolderGroupsByField(left, right, sortField);
    return sortDirection === "asc" ? naturalOrder : -naturalOrder;
  });
  return next;
}

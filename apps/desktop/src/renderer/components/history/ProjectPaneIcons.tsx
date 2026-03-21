export function ProjectPaneChevron({ open }: { open: boolean }) {
  return (
    <svg className="project-pane-inline-icon" viewBox="0 0 12 12" aria-hidden>
      <title>{open ? "Collapse folder" : "Expand folder"}</title>
      <path
        d={open ? "M3 4.5 6 7.5 9 4.5" : "M4.5 3 7.5 6 4.5 9"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProjectPaneDropdownChevron({ open }: { open: boolean }) {
  return (
    <svg className="project-pane-inline-icon" viewBox="0 0 12 12" aria-hidden>
      <title>{open ? "Close menu" : "Open menu"}</title>
      <path
        d={open ? "M3 7.5 6 4.5 9 7.5" : "M3 4.5 6 7.5 9 4.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProjectPaneSortFieldIcon() {
  return (
    <svg className="project-pane-inline-icon" viewBox="0 0 16 16" aria-hidden>
      <title>Sort field</title>
      <path
        d="M3 4.5h7M3 8h10M3 11.5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M11.5 3.75 13 5.25 14.5 3.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProjectPaneFolderIcon() {
  return (
    <svg className="project-pane-inline-icon" viewBox="0 0 16 16" aria-hidden>
      <title>Folder</title>
      <path
        d="M2.5 4.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H8L6.8 4.2A1 1 0 0 0 6 3.8H3.5a1 1 0 0 0-1 0.7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProjectPaneMenuIcon() {
  return (
    <svg className="project-pane-inline-icon" viewBox="0 0 16 16" aria-hidden>
      <title>More options</title>
      <circle cx="3.25" cy="8" r="1.1" fill="currentColor" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
      <circle cx="12.75" cy="8" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function ProjectPaneListIcon() {
  return (
    <svg className="project-pane-inline-icon" viewBox="0 0 16 16" aria-hidden>
      <title>List view</title>
      <path
        d="M4 4.5h8M4 8h8M4 11.5h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ProjectPaneTreeIcon() {
  return (
    <svg className="project-pane-inline-icon" viewBox="0 0 16 16" aria-hidden>
      <title>By folder view</title>
      <path
        d="M3 4.5h4M3 11.5h4M7 4.5v7M7 8h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";

import type { MessageCategory, Provider } from "@codetrail/core/browser";

import { CATEGORIES, HISTORY_CATEGORY_SHORTCUTS } from "../app/constants";
import type { ProjectSummary } from "../app/types";
import { AdvancedSearchToggleButton } from "../components/AdvancedSearchToggleButton";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { HighlightedText } from "../components/messages/MessagePresentation";
import { useClickOutside } from "../hooks/useClickOutside";
import { formatInteger } from "../lib/numberFormatting";
import {
  SEARCH_PLACEHOLDERS,
  getAdvancedSearchToggleTitle,
  getSearchQueryPlaceholder,
  getSearchQueryTooltip,
} from "../lib/searchLabels";
import { formatTooltip } from "../lib/tooltipText";
import {
  compactPath,
  formatDate,
  prettyCategory,
  prettyProvider,
  toggleValue,
} from "../lib/viewUtils";
import type { useSearchController } from "./useSearchController";

type SearchController = ReturnType<typeof useSearchController>;
type SearchResult = SearchController["searchResponse"]["results"][number];

export function SearchView({
  search,
  enabledProviders,
  projects,
  advancedSearchEnabled,
  setAdvancedSearchEnabled,
  onSelectResult,
}: {
  search: SearchController;
  enabledProviders: Provider[];
  projects: ProjectSummary[];
  advancedSearchEnabled: boolean;
  setAdvancedSearchEnabled: Dispatch<SetStateAction<boolean>>;
  onSelectResult: (result: SearchResult) => void;
}) {
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const queryPlaceholder = getSearchQueryPlaceholder(advancedSearchEnabled);
  const queryTitle = getSearchQueryTooltip(advancedSearchEnabled);
  const sortedProjects = useMemo(
    () => [...projects].sort(compareProjectsByNameThenProvider),
    [projects],
  );
  const selectedProject = useMemo(
    () => sortedProjects.find((project) => project.id === search.searchProjectId) ?? null,
    [search.searchProjectId, sortedProjects],
  );
  const closeProjectMenu = useCallback(() => {
    setProjectMenuOpen(false);
  }, []);
  useClickOutside(projectMenuRef, projectMenuOpen, closeProjectMenu);

  return (
    <section className="pane content-pane">
      <div className="search-view">
        <div className="search-page">
          <div className="search-page-body">
            <div className="search-panel">
              <div className={`search-panel-top${controlsCollapsed ? " is-collapsed" : ""}`}>
                <div className="search-query-row">
                  <div
                    className={`search-query-shell${
                      search.searchResponse.queryError ? " invalid" : ""
                    }`}
                  >
                    <ToolbarIcon name="search" />
                    <input
                      ref={search.globalSearchInputRef}
                      className="search-query-input"
                      value={search.searchQueryInput}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") {
                          return;
                        }
                        event.preventDefault();
                        search.focusSearchResultsPane();
                      }}
                      onChange={(event) => {
                        search.setSearchQueryInput(event.target.value);
                        search.setSearchPage(0);
                      }}
                      placeholder={queryPlaceholder}
                      title={search.searchResponse.queryError ?? queryTitle}
                    />
                  </div>

                  <AdvancedSearchToggleButton
                    buttonRef={search.advancedSearchToggleRef}
                    enabled={advancedSearchEnabled}
                    variant="search"
                    onToggle={() => {
                      setAdvancedSearchEnabled((value) => !value);
                      search.setSearchPage(0);
                    }}
                    title={getAdvancedSearchToggleTitle(advancedSearchEnabled)}
                  />

                  <div
                    className={`search-match-count${
                      search.hasActiveSearchQuery ? " is-active" : ""
                    }`}
                  >
                    {formatResultCount(search.searchResponse.totalCount)}
                  </div>

                  <button
                    ref={search.searchCollapseButtonRef}
                    type="button"
                    className="search-panel-icon-btn search-panel-collapse-btn"
                    aria-expanded={!controlsCollapsed}
                    aria-label={
                      controlsCollapsed ? "Expand search filters" : "Collapse search filters"
                    }
                    title={
                      controlsCollapsed ? "Expand search controls" : "Collapse search controls"
                    }
                    onClick={() => setControlsCollapsed((value) => !value)}
                  >
                    <svg className="search-panel-collapse-glyph" viewBox="0 0 12 12" aria-hidden>
                      <title>
                        {controlsCollapsed ? "Expand search filters" : "Collapse search filters"}
                      </title>
                      <path d={controlsCollapsed ? "M3 4.5 6 7.5 9 4.5" : "M3 7.5 6 4.5 9 7.5"} />
                    </svg>
                  </button>
                </div>

                {!controlsCollapsed && search.searchResponse.queryError ? (
                  <p className="search-error" title={search.searchResponse.queryError}>
                    {search.searchResponse.queryError}
                  </p>
                ) : null}

                {!controlsCollapsed ? (
                  <>
                    <div className="search-secondary-row">
                      <label className="search-filter-input-shell">
                        <span className="search-filter-icon" aria-hidden>
                          <svg viewBox="0 0 16 16">
                            <title>Filter</title>
                            <path d="M3 4h10M5 8h6M7 12h2" />
                          </svg>
                        </span>
                        <input
                          ref={search.searchProjectFilterInputRef}
                          className="search-filter-input"
                          value={search.searchProjectQueryInput}
                          onChange={(event) => {
                            search.setSearchProjectQueryInput(event.target.value);
                            search.setSearchPage(0);
                          }}
                          placeholder={SEARCH_PLACEHOLDERS.globalProjects}
                          title="Filter results by project name"
                        />
                      </label>

                      <div className="search-project-select-wrap" ref={projectMenuRef}>
                        <div className="search-project-select-shell">
                          <span className="search-filter-icon" aria-hidden>
                            <svg viewBox="0 0 16 16">
                              <title>Project</title>
                              <rect x="2" y="3" width="12" height="10" rx="2" />
                              <path d="M5 7h6" />
                            </svg>
                          </span>
                          <button
                            ref={search.searchProjectSelectRef}
                            type="button"
                            className="search-project-select-trigger"
                            aria-haspopup="menu"
                            aria-expanded={projectMenuOpen}
                            title={
                              selectedProject
                                ? `Project: ${getProjectOptionLabel(selectedProject)}`
                                : "Project: All projects"
                            }
                            onClick={() => setProjectMenuOpen((value) => !value)}
                          >
                            <span className="search-project-select-label">
                              {selectedProject
                                ? getProjectOptionLabel(selectedProject)
                                : "All projects"}
                            </span>
                            {selectedProject?.path ? (
                              <span className="search-project-select-path">
                                {compactPath(selectedProject.path)}
                              </span>
                            ) : null}
                          </button>
                          <span className="search-select-chevron" aria-hidden>
                            <svg viewBox="0 0 10 10">
                              <title>Open menu</title>
                              <path d="M2 4l3 3 3-3" />
                            </svg>
                          </span>
                        </div>
                        {projectMenuOpen ? (
                          <div
                            className="search-project-menu tb-dropdown-menu tb-dropdown-menu-scrollable"
                            role="menu"
                            aria-label="Projects"
                          >
                            <button
                              type="button"
                              className={`search-project-menu-item tb-dropdown-item tb-dropdown-item-checkable${
                                search.searchProjectId === "" ? " selected" : ""
                              }`}
                              onClick={() => {
                                search.setSearchProjectId("");
                                search.setSearchPage(0);
                                setProjectMenuOpen(false);
                              }}
                            >
                              <span className="search-project-menu-main">All projects</span>
                              {search.searchProjectId === "" ? (
                                <span className="tb-dropdown-check">✓</span>
                              ) : null}
                            </button>
                            {sortedProjects.map((project) => (
                              <button
                                key={project.id}
                                type="button"
                                className={`search-project-menu-item tb-dropdown-item tb-dropdown-item-checkable${
                                  search.searchProjectId === project.id ? " selected" : ""
                                }`}
                                title={project.path || undefined}
                                onClick={() => {
                                  search.setSearchProjectId(project.id);
                                  search.setSearchPage(0);
                                  setProjectMenuOpen(false);
                                }}
                              >
                                <span className="search-project-menu-main">
                                  {getProjectOptionLabel(project)}
                                </span>
                                <span className="search-project-menu-path">
                                  {project.path ? compactPath(project.path) : "(unknown path)"}
                                </span>
                                {search.searchProjectId === project.id ? (
                                  <span className="tb-dropdown-check">✓</span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <SearchFilterGroup label="Agent">
                      {enabledProviders.map((provider) => (
                        <button
                          key={provider}
                          type="button"
                          tabIndex={-1}
                          className={`msg-filter search-filter-chip search-filter-chip-provider search-filter-chip-provider-${provider}${
                            search.searchProviders.includes(provider) ? " is-active" : ""
                          }`}
                          title={`Show or hide ${prettyProvider(provider)} results`}
                          onClick={() => {
                            search.setSearchProviders((value) => toggleValue(value, provider));
                            search.setSearchPage(0);
                          }}
                        >
                          <span className="filter-label">
                            {prettyProvider(provider)}
                            <span className="filter-count search-filter-chip-count">
                              {search.searchProviderCounts[provider]}
                            </span>
                          </span>
                        </button>
                      ))}
                    </SearchFilterGroup>

                    <SearchFilterGroup label="Role">
                      {CATEGORIES.map((category) => (
                        <button
                          key={category}
                          type="button"
                          tabIndex={-1}
                          className={`msg-filter search-filter-chip search-filter-chip-category search-filter-chip-category-${category}${
                            search.historyCategories.includes(category) ? " is-active" : ""
                          }`}
                          title={getSearchCategoryTooltip(category)}
                          onClick={() => {
                            search.setHistoryCategories((value) => toggleValue(value, category));
                            search.setSearchPage(0);
                          }}
                        >
                          <span className="filter-shortcut" aria-hidden="true">
                            {getSearchCategoryShortcutDigit(category)}
                          </span>
                          <span className="filter-label">
                            {prettyCategory(category)}
                            <span className="filter-count search-filter-chip-count">
                              {search.searchResponse.categoryCounts[category]}
                            </span>
                          </span>
                        </button>
                      ))}
                    </SearchFilterGroup>
                  </>
                ) : null}
              </div>

              <div
                ref={search.searchResultsScrollRef}
                className="search-results-scroll"
                tabIndex={-1}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) {
                    search.setFocusedSearchResultIndex(-1);
                  }
                }}
              >
                {search.searchResponse.results.length === 0 ? (
                  <div className="search-empty-state">
                    {search.hasActiveSearchQuery
                      ? "No search results."
                      : "Type to search all messages."}
                  </div>
                ) : (
                  search.searchResponse.results.map((result, index) => (
                    <button
                      type="button"
                      key={`${result.messageId}-${result.messageSourceId}`}
                      ref={(element) => search.setSearchResultRef(index, element)}
                      tabIndex={-1}
                      className={`search-result-card search-result-card-${result.provider}${
                        search.focusedSearchResultIndex === index ? " is-focused" : ""
                      }`}
                      onFocus={() => search.setFocusedSearchResultIndex(index)}
                      onClick={() => onSelectResult(result)}
                    >
                      <span className="search-result-accent" aria-hidden />
                      <div className="search-result-content">
                        <div className="search-result-meta">
                          <span
                            className={`search-result-provider search-result-provider-${result.provider}`}
                          >
                            {prettyProvider(result.provider)}
                          </span>
                          <span
                            className={`search-result-category search-result-category-${result.category}`}
                          >
                            {prettyCategory(result.category)}
                          </span>
                          <span className="search-result-time">{formatDate(result.createdAt)}</span>
                          <span className="search-result-project">
                            {getSearchResultProjectLabel(result)}
                          </span>
                        </div>
                        <p className="search-result-snippet">
                          <HighlightedText text={result.snippet} query="" allowMarks />
                        </p>
                        <div className="search-result-footer">
                          {getSearchResultProjectMeta(result)}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>

              {search.hasActiveSearchQuery ? (
                <div className="search-footer">
                  <span className="search-footer-page">
                    Page {search.searchPage + 1} of {search.searchTotalPages}
                  </span>
                  <div className="search-footer-actions">
                    <button
                      type="button"
                      className="page-btn"
                      tabIndex={-1}
                      onClick={search.goToPreviousSearchPage}
                      disabled={!search.canGoToPreviousSearchPage}
                      title={formatTooltip("Previous page", "Cmd+Left")}
                      aria-label="Previous search page"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      className="page-btn"
                      tabIndex={-1}
                      onClick={search.goToNextSearchPage}
                      disabled={!search.canGoToNextSearchPage}
                      title={formatTooltip("Next page", "Cmd+Right")}
                      aria-label="Next search page"
                    >
                      Next
                    </button>
                  </div>
                  <span className="search-footer-shortcut">
                    Cmd+Left/Right • Cmd+Up/Down • Ctrl+D/U • Page Up/Down
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SearchFilterGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="search-filter-group">
      <span className="search-filter-group-label">{label}</span>
      <div className="search-filter-group-items">{children}</div>
    </div>
  );
}

function getSearchResultProjectLabel(result: SearchResult): string {
  return result.projectName || compactPath(result.projectPath) || "(unknown project)";
}

function getSearchResultProjectMeta(result: SearchResult): string {
  if (result.projectName && result.projectPath) {
    return compactPath(result.projectPath);
  }
  return result.projectName || compactPath(result.projectPath) || "(unknown project)";
}

function formatResultCount(value: number): string {
  return `${formatInteger(value)} ${value === 1 ? "match" : "matches"}`;
}

function getSearchCategoryShortcutDigit(category: MessageCategory): string {
  const match = HISTORY_CATEGORY_SHORTCUTS[category].match(/\d$/);
  return match?.[0] ?? "";
}

function getSearchCategoryTooltip(category: MessageCategory): string {
  const label = prettyCategory(category);
  return formatTooltip(`Show or hide ${label} results`, HISTORY_CATEGORY_SHORTCUTS[category]);
}

function compareProjectsByNameThenProvider(a: ProjectSummary, b: ProjectSummary): number {
  const nameCompare = getProjectDisplayName(a).localeCompare(getProjectDisplayName(b), undefined, {
    sensitivity: "base",
  });
  if (nameCompare !== 0) {
    return nameCompare;
  }
  return prettyProvider(a.provider).localeCompare(prettyProvider(b.provider), undefined, {
    sensitivity: "base",
  });
}

function getProjectDisplayName(project: ProjectSummary): string {
  return project.name || compactPath(project.path) || "(unknown project)";
}

function getProjectOptionLabel(project: ProjectSummary): string {
  return `${getProjectDisplayName(project)}: ${prettyProvider(project.provider)}`;
}

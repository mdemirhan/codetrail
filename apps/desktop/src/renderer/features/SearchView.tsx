import type { Dispatch, SetStateAction } from "react";

import { CATEGORIES, PROVIDERS } from "../app/constants";
import type { ProjectSummary } from "../app/types";
import { HighlightedText } from "../components/messages/MessagePresentation";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { SEARCH_PLACEHOLDERS } from "../lib/searchPlaceholders";
import { formatDate, prettyCategory, prettyProvider, toggleValue } from "../lib/viewUtils";
import type { useSearchController } from "./useSearchController";

type SearchController = ReturnType<typeof useSearchController>;

export function SearchView({
  search,
  projects,
  advancedSearchEnabled,
  setAdvancedSearchEnabled,
  onSelectResult,
}: {
  search: SearchController;
  projects: ProjectSummary[];
  advancedSearchEnabled: boolean;
  setAdvancedSearchEnabled: Dispatch<SetStateAction<boolean>>;
  onSelectResult: (result: SearchController["searchResponse"]["results"][number]) => void;
}) {
  return (
    <section className="pane content-pane">
      <div className="search-view">
        <div className="content-head">
          <h2>Global Search</h2>
          <p>{search.searchResponse.totalCount} matches</p>
        </div>
        <div className="search-controls">
          <div className={search.searchResponse.queryError ? "search-box invalid" : "search-box"}>
            <div className="search-input-shell">
              <ToolbarIcon name="search" />
              <input
                ref={search.globalSearchInputRef}
                className="search-input"
                value={search.searchQueryInput}
                onChange={(event) => {
                  search.setSearchQueryInput(event.target.value);
                  search.setSearchPage(0);
                }}
                placeholder={SEARCH_PLACEHOLDERS.globalMessages}
                title={search.searchResponse.queryError ?? undefined}
              />
            </div>
            <button
              type="button"
              className={`search-mode-icon-btn${advancedSearchEnabled ? " active" : ""}`}
              onClick={() => {
                setAdvancedSearchEnabled((value) => !value);
                search.setSearchPage(0);
              }}
              aria-pressed={advancedSearchEnabled}
              aria-label={
                advancedSearchEnabled
                  ? "Disable advanced search syntax"
                  : "Enable advanced search syntax"
              }
              title={advancedSearchEnabled ? "Advanced syntax enabled" : "Advanced syntax disabled"}
            >
              <svg
                className="search-mode-glyph"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M8 8l-4 4l4 4M16 8l4 4l-4 4M13 6l-2 12" />
              </svg>
            </button>
          </div>
          {search.searchResponse.queryError ? (
            <p className="search-error" title={search.searchResponse.queryError}>
              {search.searchResponse.queryError}
            </p>
          ) : null}
          <input
            value={search.searchProjectQueryInput}
            onChange={(event) => {
              search.setSearchProjectQueryInput(event.target.value);
              search.setSearchPage(0);
            }}
            placeholder={SEARCH_PLACEHOLDERS.globalProjects}
          />
          <select
            className="search-select"
            value={search.searchProjectId}
            onChange={(event) => {
              search.setSearchProjectId(event.target.value);
              search.setSearchPage(0);
            }}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {prettyProvider(project.provider)}: {project.name || project.path || "(unknown project)"}
              </option>
            ))}
          </select>
          <div className="chip-row">
            {PROVIDERS.map((provider) => (
              <button
                key={provider}
                type="button"
                className={`chip provider-chip provider-${provider}${
                  search.searchProviders.includes(provider) ? " active" : ""
                }`}
                onClick={() => {
                  search.setSearchProviders((value) => toggleValue(value, provider));
                  search.setSearchPage(0);
                }}
              >
                {prettyProvider(provider)} ({search.searchProviderCounts[provider]})
              </button>
            ))}
          </div>
          <div className="chip-row">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={`chip category-chip category-${category}${
                  search.historyCategories.includes(category) ? " active" : ""
                }`}
                onClick={() => {
                  search.setHistoryCategories((value) => toggleValue(value, category));
                  search.setSearchPage(0);
                }}
              >
                {prettyCategory(category)} ({search.searchResponse.categoryCounts[category]})
              </button>
            ))}
          </div>
        </div>

        <div className="search-result-list">
          {search.searchResponse.results.length === 0 ? (
            <p className="empty-state">No search results.</p>
          ) : (
            search.searchResponse.results.map((result) => (
              <button
                type="button"
                key={result.messageId}
                className={`search-result category-${result.category}`}
                onClick={() => onSelectResult(result)}
              >
                <header>
                  <span className={`category-badge category-${result.category}`}>
                    {prettyCategory(result.category)}
                  </span>
                  <small>
                    <span className={`provider-label provider-${result.provider}`}>
                      {prettyProvider(result.provider)}
                    </span>{" "}
                    | {formatDate(result.createdAt)}
                  </small>
                </header>
                <p className="snippet">
                  <HighlightedText text={result.snippet} query="" allowMarks />
                </p>
                <footer>
                  <small>{result.projectName || result.projectPath || "(unknown project)"}</small>
                </footer>
              </button>
            ))
          )}
        </div>

        {search.hasActiveSearchQuery ? (
          <div className="pagination-row">
            <button
              type="button"
              className="page-btn"
              onClick={search.goToPreviousSearchPage}
              disabled={!search.canGoToPreviousSearchPage}
              title="Previous page (Cmd/Ctrl+Left)"
              aria-label="Previous search page"
            >
              Previous
            </button>
            <span className="page-info">
              Page {search.searchPage + 1} / {search.searchTotalPages} (
              {search.searchResponse.totalCount} matches)
            </span>
            <button
              type="button"
              className="page-btn"
              onClick={search.goToNextSearchPage}
              disabled={!search.canGoToNextSearchPage}
              title="Next page (Cmd/Ctrl+Right)"
              aria-label="Next search page"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { MessageCategory, Provider, SearchMode } from "@codetrail/core/browser";

import {
  CATEGORIES,
  EMPTY_CATEGORY_COUNTS,
  EMPTY_PROVIDER_COUNTS,
  SEARCH_PAGE_SIZE,
} from "../app/constants";
import type { SearchQueryResponse } from "../app/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useCodetrailClient } from "../lib/codetrailClient";

const SEARCH_RESULT_PAGE_SCROLL_OVERLAP_PX = 20;

export function useSearchController({
  searchMode,
  searchProviders,
  setSearchProviders,
  historyCategories,
  setHistoryCategories,
  logError,
}: {
  searchMode: SearchMode;
  searchProviders: Provider[];
  setSearchProviders: Dispatch<SetStateAction<Provider[]>>;
  historyCategories: MessageCategory[];
  setHistoryCategories: Dispatch<SetStateAction<MessageCategory[]>>;
  logError: (context: string, error: unknown) => void;
}) {
  const codetrail = useCodetrailClient();
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const advancedSearchToggleRef = useRef<HTMLButtonElement | null>(null);
  const searchCollapseButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchProjectFilterInputRef = useRef<HTMLInputElement | null>(null);
  const searchProjectSelectRef = useRef<HTMLButtonElement | null>(null);
  const searchResultsScrollRef = useRef<HTMLDivElement | null>(null);
  const searchResultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchLoadTokenRef = useRef(0);
  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [searchProjectQueryInput, setSearchProjectQueryInput] = useState("");
  const [searchProjectId, setSearchProjectId] = useState("");
  const [searchPage, setSearchPage] = useState(0);
  const [focusedSearchResultIndex, setFocusedSearchResultIndex] = useState(-1);
  const [searchResponse, setSearchResponse] = useState<SearchQueryResponse>({
    query: "",
    queryError: null,
    highlightPatterns: [],
    totalCount: 0,
    categoryCounts: EMPTY_CATEGORY_COUNTS,
    providerCounts: EMPTY_PROVIDER_COUNTS,
    results: [],
  });

  const searchQuery = useDebouncedValue(searchQueryInput, 500);
  const searchProjectQuery = useDebouncedValue(searchProjectQueryInput, 180);
  const hasActiveSearchQuery = searchQuery.trim().length > 0;

  const loadSearch = useCallback(async () => {
    const requestToken = searchLoadTokenRef.current + 1;
    searchLoadTokenRef.current = requestToken;
    const trimmed = searchQuery.trim();
    if (trimmed.length === 0) {
      if (requestToken !== searchLoadTokenRef.current) {
        return;
      }
      setSearchResponse({
        query: searchQuery,
        totalCount: 0,
        categoryCounts: EMPTY_CATEGORY_COUNTS,
        providerCounts: EMPTY_PROVIDER_COUNTS,
        highlightPatterns: [],
        queryError: null,
        results: [],
      });
      return;
    }

    const response = await codetrail.invoke("search:query", {
      query: searchQuery,
      searchMode,
      categories: historyCategories.length === CATEGORIES.length ? undefined : historyCategories,
      providers: searchProviders,
      projectIds: searchProjectId ? [searchProjectId] : undefined,
      projectQuery: searchProjectQuery,
      limit: SEARCH_PAGE_SIZE,
      offset: searchPage * SEARCH_PAGE_SIZE,
    });
    if (requestToken !== searchLoadTokenRef.current) {
      return;
    }
    setSearchResponse(response);
  }, [
    codetrail,
    historyCategories,
    searchPage,
    searchProjectId,
    searchProjectQuery,
    searchProviders,
    searchQuery,
    searchMode,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadSearch().catch((error: unknown) => {
      if (!cancelled) {
        logError("Search failed", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSearch, logError]);

  const searchTotalPages = useMemo(() => {
    if (searchResponse.totalCount === 0) {
      return 1;
    }
    return Math.ceil(searchResponse.totalCount / SEARCH_PAGE_SIZE);
  }, [searchResponse.totalCount]);

  const searchProviderCounts = useMemo(
    () => searchResponse.providerCounts ?? EMPTY_PROVIDER_COUNTS,
    [searchResponse.providerCounts],
  );

  useEffect(() => {
    setSearchPage((value) => Math.min(value, searchTotalPages - 1));
  }, [searchTotalPages]);

  useEffect(() => {
    searchResultRefs.current = searchResultRefs.current.slice(0, searchResponse.results.length);
    setFocusedSearchResultIndex((value) =>
      value >= 0 && value < searchResponse.results.length ? value : -1,
    );
  }, [searchResponse.results.length]);

  const goToPreviousSearchPage = useCallback(() => {
    setSearchPage((value) => Math.max(0, value - 1));
  }, []);

  const goToNextSearchPage = useCallback(() => {
    setSearchPage((value) => Math.min(searchTotalPages - 1, value + 1));
  }, [searchTotalPages]);

  const focusGlobalSearch = useCallback(() => {
    window.setTimeout(() => {
      globalSearchInputRef.current?.focus();
      globalSearchInputRef.current?.select();
    }, 0);
  }, []);

  const setSearchResultRef = useCallback((index: number, element: HTMLButtonElement | null) => {
    searchResultRefs.current[index] = element;
  }, []);

  const focusSearchResultAtIndex = useCallback((index: number) => {
    const button = searchResultRefs.current[index];
    if (!button) {
      return;
    }
    setFocusedSearchResultIndex(index);
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: "nearest" });
  }, []);

  const focusSearchResultsPane = useCallback(() => {
    window.setTimeout(() => {
      const firstResult = searchResultRefs.current[0];
      if (searchResponse.results.length > 0 && firstResult) {
        setFocusedSearchResultIndex(0);
        firstResult.focus({ preventScroll: true });
        firstResult.scrollIntoView({ block: "nearest" });
        return;
      }
      setFocusedSearchResultIndex(-1);
    }, 0);
  }, [searchResponse.results.length]);

  const resolveFocusedSearchResultIndex = useCallback(() => {
    if (focusedSearchResultIndex >= 0 && focusedSearchResultIndex < searchResponse.results.length) {
      return focusedSearchResultIndex;
    }
    return searchResultRefs.current.findIndex((button) => button === document.activeElement);
  }, [focusedSearchResultIndex, searchResponse.results.length]);

  const focusAdjacentSearchResult = useCallback(
    (direction: "previous" | "next") => {
      const total = searchResponse.results.length;
      if (total === 0) {
        return;
      }
      const currentIndex = resolveFocusedSearchResultIndex();
      const fallbackIndex = direction === "next" ? 0 : total - 1;
      const nextIndex =
        currentIndex < 0
          ? fallbackIndex
          : direction === "next"
            ? Math.min(total - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
      focusSearchResultAtIndex(nextIndex);
    },
    [focusSearchResultAtIndex, resolveFocusedSearchResultIndex, searchResponse.results.length],
  );

  const pageSearchResults = useCallback((direction: "up" | "down") => {
    const container = searchResultsScrollRef.current;
    if (!container) {
      return;
    }

    const styles = window.getComputedStyle(container);
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const visibleContentHeight = container.clientHeight - paddingTop - paddingBottom;
    const pageSize = Math.max(0, visibleContentHeight - SEARCH_RESULT_PAGE_SCROLL_OVERLAP_PX);
    if (pageSize <= 0) {
      return;
    }

    const delta = direction === "down" ? pageSize : -pageSize;
    const nextScrollTop = Math.max(0, container.scrollTop + delta);
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: nextScrollTop });
    } else {
      container.scrollTop = nextScrollTop;
    }
  }, []);

  return {
    globalSearchInputRef,
    advancedSearchToggleRef,
    searchCollapseButtonRef,
    searchProjectFilterInputRef,
    searchProjectSelectRef,
    searchResultsScrollRef,
    searchQueryInput,
    setSearchQueryInput,
    searchProjectQueryInput,
    setSearchProjectQueryInput,
    searchProjectId,
    setSearchProjectId,
    searchPage,
    setSearchPage,
    focusedSearchResultIndex,
    setFocusedSearchResultIndex,
    setSearchResultRef,
    searchResponse,
    searchProviderCounts,
    searchProviders,
    setSearchProviders,
    historyCategories,
    setHistoryCategories,
    hasActiveSearchQuery,
    searchTotalPages,
    canGoToPreviousSearchPage: hasActiveSearchQuery && searchPage > 0,
    canGoToNextSearchPage: hasActiveSearchQuery && searchPage + 1 < searchTotalPages,
    goToPreviousSearchPage,
    goToNextSearchPage,
    focusGlobalSearch,
    focusSearchResultsPane,
    focusAdjacentSearchResult,
    pageSearchResultsUp: () => pageSearchResults("up"),
    pageSearchResultsDown: () => pageSearchResults("down"),
    reloadSearch: loadSearch,
  };
}

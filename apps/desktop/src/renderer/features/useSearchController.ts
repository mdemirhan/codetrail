import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { MessageCategory, Provider, SearchMode } from "@codetrail/core";

import { CATEGORIES, EMPTY_CATEGORY_COUNTS, SEARCH_PAGE_SIZE } from "../app/constants";
import type { SearchQueryResponse } from "../app/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useCodetrailClient } from "../lib/codetrailClient";
import { countProviders } from "../lib/viewUtils";

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
  const searchLoadTokenRef = useRef(0);
  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [searchProjectQueryInput, setSearchProjectQueryInput] = useState("");
  const [searchProjectId, setSearchProjectId] = useState("");
  const [searchPage, setSearchPage] = useState(0);
  const [searchResponse, setSearchResponse] = useState<SearchQueryResponse>({
    query: "",
    queryError: null,
    highlightPatterns: [],
    totalCount: 0,
    categoryCounts: EMPTY_CATEGORY_COUNTS,
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
        highlightPatterns: [],
        queryError: null,
        results: [],
      });
      return;
    }

    const response = await codetrail.invoke("search:query", {
      query: searchQuery,
      searchMode,
      categories:
        historyCategories.length === CATEGORIES.length ? undefined : historyCategories,
      providers: searchProviders.length > 0 ? searchProviders : undefined,
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
    () => countProviders(searchResponse.results.map((result) => result.provider)),
    [searchResponse.results],
  );

  useEffect(() => {
    setSearchPage((value) => Math.min(value, searchTotalPages - 1));
  }, [searchTotalPages]);

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

  return {
    globalSearchInputRef,
    searchQueryInput,
    setSearchQueryInput,
    searchProjectQueryInput,
    setSearchProjectQueryInput,
    searchProjectId,
    setSearchProjectId,
    searchPage,
    setSearchPage,
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
    reloadSearch: loadSearch,
  };
}

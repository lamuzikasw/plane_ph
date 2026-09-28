/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ISearchIssueResponse, TProjectIssuesSearchParams } from "@plane/types";

export const ISSUE_PICKER_PAGE_SIZE = 100;
export type IssuePickerSearch = (params: TProjectIssuesSearchParams) => Promise<ISearchIssueResponse[]>;

export function useIssuePickerSearch(isOpen: boolean, params: TProjectIssuesSearchParams, search: IssuePickerSearch) {
  const [issues, setIssues] = useState<ISearchIssueResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const nextOffset = useRef(0);
  const loadingMoreRef = useRef(false);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    const request = ++generation.current;
    if (!isOpen) return;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setError(false);
    setIssues([]);
    setHasMore(false);
    nextOffset.current = 0;
    const fetchFirstPage = async () => {
      try {
        const requestParams: TProjectIssuesSearchParams = JSON.parse(paramsKey);
        const rows = await search({ ...requestParams, offset: 0, limit: ISSUE_PICKER_PAGE_SIZE });
        if (request !== generation.current) return;
        setIssues(rows);
        nextOffset.current = rows.length;
        setHasMore(rows.length === ISSUE_PICKER_PAGE_SIZE);
      } catch (cause: unknown) {
        if (request !== generation.current) return;
        console.error("Failed to search work items", cause);
        setError(true);
      } finally {
        if (request === generation.current) setLoading(false);
      }
    };
    void fetchFirstPage();
    return () => {
      generation.current = request + 1;
    };
  }, [isOpen, paramsKey, search, retry]);

  const loadMore = useCallback(async () => {
    if (!isOpen || loading || loadingMoreRef.current || !hasMore) return;
    const request = generation.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(false);
    try {
      const requestParams: TProjectIssuesSearchParams = JSON.parse(paramsKey);
      const rows = await search({
        ...requestParams,
        offset: nextOffset.current,
        limit: ISSUE_PICKER_PAGE_SIZE,
      });
      if (request !== generation.current) return;
      setIssues((current) => {
        const ids = new Set(current.map((issue) => issue.id));
        return [...current, ...rows.filter((issue) => !ids.has(issue.id))];
      });
      nextOffset.current += rows.length;
      setHasMore(rows.length === ISSUE_PICKER_PAGE_SIZE);
    } catch (cause: unknown) {
      if (request !== generation.current) return;
      console.error("Failed to load more work items", cause);
      setError(true);
    } finally {
      if (request === generation.current) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [isOpen, loading, hasMore, search, paramsKey]);

  return { issues, loading, loadingMore, hasMore, error, loadMore, retry: () => setRetry((count) => count + 1) };
}

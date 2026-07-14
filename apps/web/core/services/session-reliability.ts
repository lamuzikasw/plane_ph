/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const CURRENT_USER_PATH = "/api/users/me/";

type TSessionCheckResponse = {
  status: number;
};

type TSessionCheck = (input: string, init: RequestInit) => Promise<TSessionCheckResponse>;

export const isCurrentUserRequest = (requestUrl?: string): boolean =>
  Boolean(requestUrl?.split("?")[0]?.endsWith(CURRENT_USER_PATH));

export const getCurrentUserUrl = (baseURL: string): string => {
  const normalizedBaseURL = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
  return `${normalizedBaseURL}${CURRENT_USER_PATH}`;
};

/**
 * A failed business request is not proof that the browser session has expired.
 * Only an explicit 401 from the current-user endpoint is allowed to trigger login.
 * Network failures and 5xx responses are treated as temporary outages.
 */
export const isSessionConfirmedExpired = async (
  checkSession: TSessionCheck,
  currentUserUrl: string
): Promise<boolean> => {
  try {
    const response = await checkSession(currentUserUrl, {
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });
    return response.status === 401;
  } catch {
    return false;
  }
};

export const getLoginRedirectUrl = (pathname: string, search = ""): string => {
  const currentPath = `${pathname}${search}`;
  if (!currentPath || currentPath === "/") return "/";
  return `/?next_path=${encodeURIComponent(currentPath)}`;
};

export const shouldShowMaintenance = (
  hasRequestError: boolean,
  hasCachedData: boolean,
  recoveryWindowElapsed: boolean
): boolean => hasRequestError && !hasCachedData && recoveryWindowElapsed;

export const shouldPreserveAuthenticatedUser = (hasCurrentUser: boolean, isAuthenticated: boolean): boolean =>
  hasCurrentUser && isAuthenticated;

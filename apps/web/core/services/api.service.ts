/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AxiosInstance, AxiosRequestConfig } from "axios";
import { create } from "axios";
// helpers
import {
  getCurrentUserUrl,
  getLoginRedirectUrl,
  isCurrentUserRequest,
  isSessionConfirmedExpired,
} from "@/services/session-reliability";

export abstract class APIService {
  protected baseURL: string;
  private axiosInstance: AxiosInstance;
  private sessionCheckPromise: Promise<boolean> | undefined;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.axiosInstance = create({
      baseURL,
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 && typeof window !== "undefined" && !isCurrentUserRequest(error.config?.url))
          void this.redirectIfSessionExpired();
        return Promise.reject(error);
      }
    );
  }

  private async redirectIfSessionExpired(): Promise<void> {
    if (!this.sessionCheckPromise)
      this.sessionCheckPromise = isSessionConfirmedExpired(
        window.fetch.bind(window),
        getCurrentUserUrl(this.baseURL)
      ).finally(() => {
        this.sessionCheckPromise = undefined;
      });

    if (await this.sessionCheckPromise)
      window.location.replace(getLoginRedirectUrl(window.location.pathname, window.location.search));
  }

  get(url: string, params = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  post(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  put(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  patch(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  delete(url: string, data?: any, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  request(config = {}) {
    return this.axiosInstance(config);
  }
}

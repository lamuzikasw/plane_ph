/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const runWorkspaceViewLoad = async <T>(
  toggleLoading: (value: boolean) => void,
  load: () => Promise<T>
): Promise<T> => {
  toggleLoading(true);

  try {
    return await load();
  } finally {
    toggleLoading(false);
  }
};

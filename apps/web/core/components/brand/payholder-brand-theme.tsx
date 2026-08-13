/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";

export const PAYHOLDER_BRAND_WORKSPACE_SLUG = "payholder";

export const isPayholderBrandedWorkspace = (workspaceSlug: string | undefined): boolean =>
  workspaceSlug?.toLowerCase() === PAYHOLDER_BRAND_WORKSPACE_SLUG;

type TPayholderBrandThemeProps = {
  workspaceSlug: string | undefined;
};

/**
 * Applies the PayHolder visual system to every page in the PayHolder workspace.
 * The previous value is restored on navigation so other workspaces remain unaffected.
 */
export function PayholderBrandTheme({ workspaceSlug }: TPayholderBrandThemeProps) {
  useEffect(() => {
    if (!isPayholderBrandedWorkspace(workspaceSlug)) return;

    const root = document.documentElement;
    const previousTheme = root.dataset.brandTheme;
    root.dataset.brandTheme = "payholder";

    return () => {
      if (root.dataset.brandTheme !== "payholder") return;

      if (previousTheme) root.dataset.brandTheme = previousTheme;
      else delete root.dataset.brandTheme;
    };
  }, [workspaceSlug]);

  return null;
}

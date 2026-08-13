/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";

export const PAYHOLDER_BRAND_PREVIEW_PROJECT_ID = "c4899f6f-bb85-4fb4-bcda-d493e866d1d2";

export const isPayholderBrandPreviewProject = (projectId: string | undefined): boolean =>
  projectId === PAYHOLDER_BRAND_PREVIEW_PROJECT_ID;

type TPayholderBrandThemeProps = {
  projectId: string | undefined;
};

/**
 * Temporarily scopes the PayHolder visual system to the dedicated preview project.
 * The previous value is restored on navigation so the rest of Plane is unaffected.
 */
export function PayholderBrandTheme({ projectId }: TPayholderBrandThemeProps) {
  useEffect(() => {
    if (!isPayholderBrandPreviewProject(projectId)) return;

    const root = document.documentElement;
    const previousTheme = root.dataset.brandTheme;
    root.dataset.brandTheme = "payholder";

    return () => {
      if (root.dataset.brandTheme !== "payholder") return;

      if (previousTheme) root.dataset.brandTheme = previousTheme;
      else delete root.dataset.brandTheme;
    };
  }, [projectId]);

  return null;
}

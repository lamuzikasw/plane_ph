/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import {
  FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  restoreTemporaryLanguage,
  setTemporaryLanguage,
  SUPPORTED_LANGUAGES,
} from "@plane/i18n";
import type { TLanguage, TTemporaryLanguageSnapshot } from "@plane/i18n";

export const PAYHOLDER_BRAND_PREVIEW_PROJECT_ID = "c4899f6f-bb85-4fb4-bcda-d493e866d1d2";

export const isPayholderBrandPreviewProject = (projectId: string | undefined): boolean =>
  projectId === PAYHOLDER_BRAND_PREVIEW_PROJECT_ID;

type TPayholderBrandThemeProps = {
  projectId: string | undefined;
};

/**
 * Scopes the PayHolder visual system to the dedicated preview project.
 * The previous value is restored on navigation so the rest of Plane is unaffected.
 */
export function PayholderBrandTheme({ projectId }: TPayholderBrandThemeProps) {
  const languageSnapshotRef = useRef<TTemporaryLanguageSnapshot | undefined>(undefined);

  useEffect(() => {
    if (!isPayholderBrandPreviewProject(projectId)) {
      languageSnapshotRef.current = undefined;
      return;
    }

    const root = document.documentElement;
    const previousTheme = root.dataset.brandTheme;
    const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const previousLanguage = SUPPORTED_LANGUAGES.some(({ value }) => value === savedLanguage)
      ? (savedLanguage as TLanguage)
      : FALLBACK_LANGUAGE;

    languageSnapshotRef.current ??= {
      language: previousLanguage,
      documentLanguage: previousLanguage,
    };

    root.dataset.brandTheme = "payholder";
    void setTemporaryLanguage("ru");

    return () => {
      if (languageSnapshotRef.current) void restoreTemporaryLanguage(languageSnapshotRef.current);

      if (root.dataset.brandTheme === "payholder") {
        if (previousTheme) root.dataset.brandTheme = previousTheme;
        else delete root.dataset.brandTheme;
      }
    };
  }, [projectId]);

  return null;
}

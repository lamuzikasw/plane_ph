/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { initPromise, i18nInstance } from "./instance";
import { LANGUAGE_STORAGE_KEY } from "../constants/language";
import type { TLanguage } from "../types";

export type TTemporaryLanguageSnapshot = {
  language: TLanguage;
  documentLanguage: string | null;
};

let temporaryLanguageQueue: Promise<void> = Promise.resolve();

const queueTemporaryLanguageChange = (change: () => Promise<void>): Promise<void> => {
  temporaryLanguageQueue = temporaryLanguageQueue.then(change, change);
  return temporaryLanguageQueue;
};

export async function setLanguage(lng: TLanguage): Promise<void> {
  await initPromise;
  await i18nInstance.changeLanguage(lng);
  if (typeof window !== "undefined") {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
    document.documentElement.lang = lng;
  }
}

/**
 * Changes the active language without updating the user's saved preference.
 * This is intended for route-scoped previews that must be reverted on navigation.
 */
export function setTemporaryLanguage(lng: TLanguage): Promise<void> {
  return queueTemporaryLanguageChange(async () => {
    await initPromise;
    await i18nInstance.changeLanguage(lng);
    if (typeof document !== "undefined") document.documentElement.lang = lng;
  });
}

/** Restores a language captured by setTemporaryLanguage without touching localStorage. */
export function restoreTemporaryLanguage(snapshot: TTemporaryLanguageSnapshot): Promise<void> {
  return queueTemporaryLanguageChange(async () => {
    await initPromise;
    await i18nInstance.changeLanguage(snapshot.language);

    if (typeof document === "undefined") return;
    if (snapshot.documentLanguage) document.documentElement.lang = snapshot.documentLanguage;
    else document.documentElement.removeAttribute("lang");
  });
}

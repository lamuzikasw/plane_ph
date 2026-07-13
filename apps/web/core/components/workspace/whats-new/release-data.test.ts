/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  getReleaseBySlug,
  hasUnseenRelease,
  LATEST_RELEASE,
  PATCH_1_0,
  PATCH_1_1,
  PRODUCT_RELEASES,
  WHATS_NEW_LAST_SEEN_STORAGE_KEY,
} from "./release-data";

describe("release archive", () => {
  it("keeps the newest release first and resolves release URLs", () => {
    expect(PRODUCT_RELEASES.map((release) => release.slug)).toEqual(["1-1", "1-0"]);
    expect(LATEST_RELEASE).toBe(PATCH_1_1);
    expect(getReleaseBySlug("1-0")).toBe(PATCH_1_0);
    expect(getReleaseBySlug("unknown")).toBe(PATCH_1_1);
  });

  it("uses one browser-wide marker for the application release", () => {
    expect(WHATS_NEW_LAST_SEEN_STORAGE_KEY).toBe("whats-new:last-seen-release");
  });

  it("shows the indicator until the latest release has been viewed", () => {
    expect(hasUnseenRelease(null)).toBe(true);
    expect(hasUnseenRelease("1-0")).toBe(true);
    expect(hasUnseenRelease("1-1")).toBe(false);
  });
});

describe("patch 1.1 release content", () => {
  it("covers Igor, cross-project relations, performance, and the release archive", () => {
    expect(PATCH_1_1.features.map((feature) => feature.id)).toEqual(["igor", "relations", "performance", "updates"]);

    const releaseText = PATCH_1_1.features
      .flatMap((feature) => [feature.title, feature.description, ...feature.highlights])
      .join(" ");

    expect(releaseText).toContain("Игорь");
    expect(releaseText).toContain("всех доступных проектов");
    expect(releaseText).toContain("Рабочее пространство появляется");
    expect(releaseText).toContain("синий индикатор");
    expect(releaseText).toContain("архиве обновлений");
    expect(releaseText).not.toContain("Kanban-доске");
    expect(releaseText).not.toContain("стартовой передачи");
  });

  it("gives every feature a useful action and a concise set of highlights", () => {
    for (const feature of PATCH_1_1.features) {
      expect(feature.action.href || feature.action.event).toBeTruthy();
      expect(feature.action.label.length).toBeGreaterThan(0);
      expect(feature.highlights.length).toBeGreaterThan(0);
    }

    expect(PATCH_1_1.features.find((feature) => feature.id === "relations")?.highlights.length).toBeGreaterThan(3);
    expect(PATCH_1_1.featureTitle).not.toMatch(/четыр/i);
  });
});

describe("patch 1.0 release content", () => {
  it("covers every user-facing area from the changelog", () => {
    expect(PATCH_1_0.features.map((feature) => feature.id)).toEqual(["planning", "tasks", "analytics", "today"]);

    const releaseText = PATCH_1_0.features
      .flatMap((feature) => [feature.title, feature.description, ...feature.highlights])
      .join(" ");

    expect(releaseText).toContain("Ганта");
    expect(releaseText).toContain("зависимость");
    expect(releaseText).toContain("Масштаб");
    expect(releaseText).toContain("другой проект");
    expect(releaseText).toContain("Done");
    expect(releaseText).toContain("управленческий обзор");
    expect(releaseText).toContain("Daily digest");
  });

  it("gives every feature a useful destination and a concise set of highlights", () => {
    for (const feature of PATCH_1_0.features) {
      expect(feature.action.href).toMatch(/^\//);
      expect(feature.action.label.length).toBeGreaterThan(0);
      expect(feature.highlights.length).toBeGreaterThan(0);
    }

    expect(PATCH_1_0.featureTitle).not.toMatch(/четыр/i);
  });
});

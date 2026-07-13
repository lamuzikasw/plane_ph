/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { PATCH_1_0 } from "./release-data";

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

  it("gives every feature a useful destination and concise highlights", () => {
    for (const feature of PATCH_1_0.features) {
      expect(feature.href).toMatch(/^\//);
      expect(feature.actionLabel.length).toBeGreaterThan(0);
      expect(feature.highlights).toHaveLength(3);
    }
  });
});

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KanbanIssueTitle } from "./issue-title";

describe("KanbanIssueTitle", () => {
  it("renders the complete title without truncation classes", () => {
    const title = "Разобраться с Оплати. Им нужен редирект или SSL сертификат?";

    const markup = renderToStaticMarkup(<KanbanIssueTitle name={title} />);

    expect(markup).toContain(title);
    expect(markup).toContain("whitespace-normal");
    expect(markup).toContain("break-words");
    expect(markup).not.toContain("line-clamp");
    expect(markup).not.toContain("truncate");
  });
});

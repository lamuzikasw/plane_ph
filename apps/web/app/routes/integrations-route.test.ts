import type { RouteConfigEntry } from "@react-router/dev/routes";
import type { RouteObject } from "react-router";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";
import { WORKSPACE_SETTINGS } from "@plane/constants";
import { joinUrlPath } from "@plane/utils";
import routes from "../routes";

// Match the actual core + extended + fallback configuration used by the app.
// React Router's runtime matcher needs RouteObjects rather than dev file entries.
const toRouteObjects = (entries: RouteConfigEntry[]): RouteObject[] =>
  entries.map((entry) => {
    const common = {
      path: entry.path,
      caseSensitive: entry.caseSensitive,
      id: entry.id,
      handle: { file: entry.file },
    };
    return entry.index
      ? { ...common, index: true }
      : { ...common, children: entry.children ? toRouteObjects(entry.children) : undefined };
  });
const actualRoutes = toRouteObjects(routes);
const integrationPage = "./(all)/[workspaceSlug]/(settings)/settings/(workspace)/integrations/page.tsx";

describe("workspace integrations navigation", () => {
  it.each(["payholder", "demo-workspace"])(
    "matches the menu link to the integrations page for %s, not the 404 fallback",
    (workspaceSlug) => {
      const href = joinUrlPath(workspaceSlug, WORKSPACE_SETTINGS.integrations.href);
      for (const pathname of [href.replace(/\/+$/, ""), `${href.replace(/\/+$/, "")}/`]) {
        const matches = matchRoutes(actualRoutes, pathname)!;
        expect(matches).not.toBeNull();
        expect(matches.at(-1)?.route.handle.file).toBe(integrationPage);
        expect(matches.at(-1)?.params.workspaceSlug).toBe(workspaceSlug);
        expect(matches.some((match) => match.route.path === "*")).toBe(false);
        expect(matches.map((match) => match.route.handle.file)).toContain(
          "./(all)/[workspaceSlug]/(settings)/settings/(workspace)/layout.tsx"
        );
      }
    }
  );

  it("preserves the 404 fallback for unregistered integration subpages", () => {
    const href = joinUrlPath("payholder", WORKSPACE_SETTINGS.integrations.href, "not-a-registered-page");
    const matches = matchRoutes(actualRoutes, href)!;
    expect(matches.at(-1)?.route.handle.file).toBe("./not-found.tsx");
    expect(matches.at(-1)?.route.path).toBe("*");
  });
});

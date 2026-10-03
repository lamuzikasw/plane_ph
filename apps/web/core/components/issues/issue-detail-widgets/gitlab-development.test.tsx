// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TGitLabDevelopment, TGitLabObject } from "@plane/types";
import { GitLabDevelopmentStore } from "@plane/shared-state";
import { GitLabDevelopmentTree } from "@plane/ui";

const empty: TGitLabDevelopment = { integrations: [], access_errors: [], objects: [], relations: [], links: [] };
const fixtureObject = (id: string, kind: TGitLabObject["kind"], details: TGitLabObject["data"]): TGitLabObject => ({
  id,
  kind,
  external_id: id === "commit" ? "abcdef123456" : id,
  repository_id: "repo",
  repository: "team/repo",
  synced_at: "2026-10-03T10:00:00Z",
  data: { web_url: `https://gitlab.example.com/team/repo/-/${kind}/${id}`, ...details },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
describe("GitLab development store", () => {
  it("discards in-flight data after leaving the issue or changing users", async () => {
    const response = deferred<TGitLabDevelopment>();
    const store = new GitLabDevelopmentStore(
      { getDevelopment: () => response.promise, mutateDevelopment: vi.fn() },
      "demo",
      "project",
      "issue"
    );
    const load = store.load();
    store.dispose();
    response.resolve(empty);
    await load;
    expect(store.data).toBeUndefined();
    expect(store.loading).toBe(false);
  });
  it("a mutation wins over an earlier refresh", async () => {
    const response = deferred<TGitLabDevelopment>();
    const updated = { ...empty, access_errors: ["new-result"] };
    const store = new GitLabDevelopmentStore(
      { getDevelopment: () => response.promise, mutateDevelopment: vi.fn().mockResolvedValue(updated) },
      "demo",
      "project",
      "issue"
    );
    const load = store.load();
    await store.mutate({ action: "pin", object_id: "job" });
    response.resolve(empty);
    await load;
    expect(store.data).toEqual(updated);
    expect(store.saving).toBe(false);
  });
  it("clears previous private metadata when a refresh fails", async () => {
    const service = {
      getDevelopment: vi.fn().mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error("403")),
      mutateDevelopment: vi.fn(),
    };
    const store = new GitLabDevelopmentStore(service, "demo", "project", "issue");
    await store.load();
    expect(store.data).toEqual(empty);
    await store.load();
    expect(store.data).toBeUndefined();
    expect(store.error).toBe("load");
  });
  it("does not overlap refresh requests", async () => {
    const response = deferred<TGitLabDevelopment>();
    const service = { getDevelopment: vi.fn().mockReturnValue(response.promise), mutateDevelopment: vi.fn() };
    const store = new GitLabDevelopmentStore(service, "demo", "project", "issue");
    const first = store.load();
    await store.load();
    expect(service.getDevelopment).toHaveBeenCalledTimes(1);
    response.resolve(empty);
    await first;
  });
  it("clears cached metadata when a link action loses authorization", async () => {
    const service = {
      getDevelopment: vi.fn().mockResolvedValue(empty),
      mutateDevelopment: vi.fn().mockRejectedValue(new Error("403")),
    };
    const store = new GitLabDevelopmentStore(service, "demo", "project", "issue");
    await store.load();
    expect(await store.mutate({ action: "pin", object_id: "private-job" })).toBe(false);
    expect(store.data).toBeUndefined();
    expect(store.error).toBe("mutation");
  });
});

describe("GitLab development tree", () => {
  const data: TGitLabDevelopment = {
    ...empty,
    integrations: [
      {
        id: "integration",
        name: "GitLab",
        base_url: "https://gitlab.example.com",
        enabled: true,
        status: "connected",
        error_code: "",
        last_synced_at: null,
        user_connected: true,
        username: "developer",
        oauth_configured: true,
      },
    ],
    objects: [
      {
        id: "old",
        kind: "job",
        external_id: "10",
        repository_id: "repo",
        repository: "team/repo",
        synced_at: "2026-10-03T10:00:00Z",
        data: {
          name: "build",
          status: "success",
          retried: true,
          stage: "package",
          duration: 12.4,
          sha: "abcdef123456",
          pipeline_id: 5,
          web_url: "https://gitlab.example.com/team/repo/-/jobs/10",
        },
      },
      {
        id: "retry",
        kind: "job",
        external_id: "11",
        repository_id: "repo",
        repository: "team/repo",
        synced_at: "2026-10-03T10:00:00Z",
        data: { name: "build", status: "failed", web_url: "javascript:alert(1)" },
      },
    ],
    links: [{ id: "pin", object_id: "old", origins: ["pin"], pinned: true, created_at: "2026-10-03T10:00:00Z" }],
  };
  it("keeps the exact pinned job ID and only exposes links on configured GitLab origins", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<GitLabDevelopmentTree data={data} />);
    });
    expect(container.textContent).toContain("Pinned jobs");
    expect(container.textContent).toContain("build #10");
    expect(container.textContent).toContain("Pipeline #5");
    expect(container.querySelector('a[href="https://gitlab.example.com/team/repo/-/pipelines/5"]')).not.toBeNull();
    expect(
      container.querySelector('a[href="https://gitlab.example.com/team/repo/-/commit/abcdef123456"]')
    ).not.toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    await act(async () => {
      root.unmount();
    });
  });
  it("pin and unlink callbacks target concrete object IDs", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const action = vi.fn();
    await act(async () => {
      root.render(<GitLabDevelopmentTree data={data} editable onAction={action} />);
    });
    const pin = [...container.querySelectorAll("button")].find((button) => button.textContent === "Pin this job")!;
    await act(async () => {
      pin.click();
    });
    expect(action).toHaveBeenCalledWith("pin", "retry");
    await act(async () => {
      root.unmount();
    });
  });

  const hierarchy: TGitLabDevelopment = {
    ...data,
    objects: [
      fixtureObject("1", "mr", {
        title: "GitLab integration",
        state: "opened",
        source_branch: "feature/gitlab",
        target_branch: "main",
      }),
      fixtureObject("commit", "commit", {
        message: "Add GitLab widget\n\nDetailed implementation notes\nplane:PLGIT-1",
        author_name: "Alex Developer",
        committed_date: "2026-10-03T09:00:00Z",
      }),
      fixtureObject("5", "pipeline", {
        status: "failed",
        source: "push",
        ref: "v1.2.3",
        tag: true,
        sha: "abcdef123456",
        started_at: "2026-10-03T09:01:00Z",
      }),
      { ...data.objects[0], data: { ...data.objects[0].data, retried: false } },
      fixtureObject("11", "job", { name: "test", stage: "verify", duration: 0, status: "failed" }),
      fixtureObject("12", "job", { name: "lint", status: "running" }),
      fixtureObject("13", "job", { name: "release", status: "manual" }),
      fixtureObject("9", "job", { name: "old test", status: "failed", retried: true }),
    ],
    relations: [
      { parent: "1", child: "commit", created_at: "2026-10-03T10:00:00Z" },
      { parent: "commit", child: "5", created_at: "2026-10-03T10:00:00Z" },
      ...["old", "11", "12", "13", "9"].map((child) => ({ parent: "5", child, created_at: "2026-10-03T10:00:00Z" })),
    ],
    links: [
      { id: "link", object_id: "1", origins: ["manual", "marker"], pinned: false, created_at: "2026-10-03T10:00:00Z" },
      data.links[0],
    ],
  };

  it("shows required object metadata, both link sources and their creation time", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<GitLabDevelopmentTree data={hierarchy} />));
    expect(container.textContent).toContain("feature/gitlab → main");
    expect(container.textContent).toContain("Author: Alex Developer");
    expect(container.querySelector('time[datetime="2026-10-03T09:00:00Z"]')).not.toBeNull();
    expect(container.textContent).toContain("Tag: v1.2.3");
    expect(container.textContent).toContain("SHA: abcdef123456");
    expect(container.querySelector('time[datetime="2026-10-03T09:01:00Z"]')).not.toBeNull();
    expect(container.textContent).toContain("Stage: verify");
    expect(container.textContent).toContain("Duration: 0 s");
    expect(container.textContent).toContain("Manual · Marker");
    expect(container.textContent).toContain("Linked:");
    expect(container.querySelector('time[datetime="2026-10-03T10:00:00Z"]')).not.toBeNull();
    const message = [...container.querySelectorAll("details")].find(
      (item) => item.firstElementChild?.textContent === "Full commit message"
    )!;
    expect(message.open).toBe(false);
    expect(message.querySelector("p")?.textContent).toBe(
      "Add GitLab widget\n\nDetailed implementation notes\nplane:PLGIT-1"
    );
    expect(container.querySelectorAll('a[href$="/mr/1"]')).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("counts current jobs, folds retries and preserves opened pipelines across refreshes", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<GitLabDevelopmentTree data={hierarchy} />));
    const pipeline = [...container.querySelectorAll("details")].find((item) =>
      item.firstElementChild?.textContent?.startsWith("Pipeline #5")
    )!;
    expect(pipeline.open).toBe(false);
    expect(pipeline.firstElementChild?.textContent).toContain("Succeeded: 1");
    expect(pipeline.firstElementChild?.textContent).toContain("Failed: 1");
    expect(pipeline.firstElementChild?.textContent).toContain("Running: 1");
    expect(pipeline.firstElementChild?.textContent).toContain("Waiting: 1");
    const history = [...pipeline.querySelectorAll("details")].find(
      (item) => item.firstElementChild?.textContent === "History (1)"
    )!;
    expect(history.open).toBe(false);
    expect(history.textContent).toContain("old test #9");
    await act(async () => {
      pipeline.open = true;
      pipeline.dispatchEvent(new Event("toggle"));
    });
    await act(async () =>
      root.render(
        <GitLabDevelopmentTree
          data={{
            ...hierarchy,
            objects: hierarchy.objects.map((object) => ({ ...object, synced_at: "2026-10-03T10:15:00Z" })),
          }}
        />
      )
    );
    expect(pipeline.open).toBe(true);
    expect(container.querySelector("summary > div")).toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps the current synthetic merge pipeline at MR level when commits have history", async () => {
    const extraCommits = [2, 3, 4].map((id) =>
      fixtureObject(`commit-${id}`, "commit", { message: `Commit ${id}`, committed_date: `2026-10-03T09:0${id}:00Z` })
    );
    const synthetic = fixtureObject("6", "pipeline", {
      status: "running",
      source: "merge_request_event",
      ref: "refs/merge-requests/1/merge",
      sha: "synthetic-merge-sha",
      started_at: "2026-10-03T09:05:00Z",
    });
    const mixed: TGitLabDevelopment = {
      ...hierarchy,
      objects: [...hierarchy.objects, ...extraCommits, synthetic],
      relations: [
        ...hierarchy.relations,
        ...extraCommits.map((object) => ({ parent: "1", child: object.id, created_at: "2026-10-03T10:00:00Z" })),
        { parent: "1", child: "6", created_at: "2026-10-03T10:00:00Z" },
      ],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<GitLabDevelopmentTree data={mixed} />));
    const syntheticLink = container.querySelector('a[href$="/pipeline/6"]')!;
    expect(syntheticLink.textContent).toContain("merge_request_event");
    expect(syntheticLink.parentElement?.parentElement?.textContent).toContain("synthetic-merge-sha");
    expect(syntheticLink.closest("details")?.firstElementChild?.textContent).toContain("!1 GitLab integration");
    const history = [...container.querySelectorAll("details")].find(
      (item) => item.firstElementChild?.textContent === "History (1)" && item.textContent?.includes("Add GitLab widget")
    )!;
    expect(history.open).toBe(false);
    expect(history.contains(syntheticLink)).toBe(false);
    await act(async () => root.unmount());
  });

  it("folds large lists of directly linked objects and names concrete action targets", async () => {
    const direct: TGitLabDevelopment = {
      ...data,
      objects: [1, 2, 3, 4, 5].map((id) => fixtureObject(String(id), "commit", { message: `Direct commit ${id}` })),
      links: [],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<GitLabDevelopmentTree data={direct} editable onAction={vi.fn()} />));
    const history = [...container.querySelectorAll("details")].find(
      (item) => item.firstElementChild?.textContent === "History (2)"
    )!;
    expect(history.open).toBe(false);
    expect(history.querySelectorAll("a")).toHaveLength(2);
    expect(container.querySelector('button[aria-label="Unlink: 5 Direct commit 5"]')).not.toBeNull();
    expect(container.querySelector("summary button")).toBeNull();
    await act(async () => root.unmount());
  });

  const branchName = "feature/PLGIT-1-local-integration";
  const branchHash = "a".repeat(64);
  const headSHA = "9230a38bd899aaf9d17b4cc4d681ce3ab87c6af9";
  const branch: TGitLabObject = {
    ...fixtureObject("branch-object", "branch", {
      name: branchName,
      state: "active",
      sha: headSHA,
      protected: true,
      default: true,
      author_name: "Alex Developer",
      committed_date: "2026-10-03T09:00:00Z",
      web_url: `https://gitlab.example.com/team/repo/-/tree/${encodeURIComponent(branchName)}`,
    }),
    external_id: branchHash,
  };
  const branchLink = {
    id: "branch-link",
    object_id: branch.id,
    origins: ["branch"],
    pinned: false,
    created_at: "2026-10-03T10:00:00Z",
  };

  it("shows a slash-containing branch name, head metadata and provenance without its storage hash or pin action", async () => {
    const branchData: TGitLabDevelopment = { ...data, objects: [branch], relations: [], links: [branchLink] };
    const container = document.createElement("div");
    const root = createRoot(container);
    const action = vi.fn();
    await act(async () => root.render(<GitLabDevelopmentTree data={branchData} editable onAction={action} />));
    const section = container.querySelector('section[aria-label="Branches"]')!;
    const anchor = section.querySelector("a")!;
    expect(anchor.textContent).toBe(branchName);
    expect(anchor.getAttribute("href")).toBe(branch.data.web_url);
    expect(section.textContent).toContain("Existing");
    expect(section.textContent).toContain("Protected");
    expect(section.textContent).toContain("Default");
    expect(section.textContent).toContain("Branch name");
    expect(section.textContent).toContain("Author: Alex Developer");
    expect(section.querySelector('time[datetime="2026-10-03T09:00:00Z"]')).not.toBeNull();
    expect(section.querySelector(`[title="${headSHA}"]`)?.textContent).toBe(`SHA: ${headSHA.slice(0, 8)}`);
    expect(container.innerHTML).not.toContain(branchHash);
    expect(section.querySelectorAll("button")).toHaveLength(1);
    await act(async () => section.querySelector("button")!.click());
    expect(action).toHaveBeenCalledWith("unlink", "branch-object");
    await act(async () => root.unmount());
  });

  it("keeps long branch names in their own block before the independent MR hierarchy", async () => {
    const longName = `feature/PLGIT-1-${"long-name".repeat(35)}`;
    const longBranch = { ...branch, data: { ...branch.data, name: longName } };
    const mixed: TGitLabDevelopment = {
      ...hierarchy,
      objects: [...hierarchy.objects, longBranch],
      links: [
        ...hierarchy.links.map((link) =>
          link.object_id === "1" ? Object.assign({}, link, { origins: ["branch", "marker"] }) : link
        ),
        branchLink,
      ],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<GitLabDevelopmentTree data={mixed} />));
    const section = container.querySelector('section[aria-label="Branches"]')!;
    const branchAnchor = section.querySelector("a")!;
    const mrAnchor = container.querySelector('a[href$="/mr/1"]')!;
    expect(branchAnchor.textContent).toBe(longName);
    expect(branchAnchor.classList.contains("[overflow-wrap:anywhere]")).toBe(true);
    expect(section.contains(mrAnchor)).toBe(false);
    expect(section.compareDocumentPosition(mrAnchor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mrAnchor.closest("summary")?.textContent).toContain("Branch name · Marker");
    const mrTree = mrAnchor.closest("details")!;
    const pipeline = [...mrTree.querySelectorAll("details")].find((item) =>
      item.firstElementChild?.textContent?.startsWith("Pipeline #5")
    )!;
    expect(pipeline.closest('section[aria-label="Branches"]')).toBeNull();
    expect(container.querySelectorAll('a[href$="/mr/1"]')).toHaveLength(1);
    expect(mrTree.querySelectorAll('a[href$="/pipeline/5"]')).toHaveLength(1);
    expect(section.querySelector('a[href$="/pipeline/5"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("retains removed branch metadata and its exact unlink target in folded history", async () => {
    const removed = {
      ...branch,
      id: "removed-branch-object",
      external_id: "b".repeat(64),
      data: {
        ...branch.data,
        name: "feature/PLGIT-1-removed",
        state: "deleted",
        protected: false,
        default: false,
        web_url: "https://gitlab.example.com/team/repo/-/tree/feature%2FPLGIT-1-removed",
      },
    };
    const branchData: TGitLabDevelopment = {
      ...data,
      objects: [branch, removed],
      relations: [],
      links: [branchLink, { ...branchLink, id: "removed-link", object_id: removed.id }],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    const action = vi.fn();
    await act(async () => root.render(<GitLabDevelopmentTree data={branchData} editable onAction={action} />));
    const section = container.querySelector('section[aria-label="Branches"]')!;
    const history = [...section.querySelectorAll("details")].find(
      (item) => item.firstElementChild?.textContent === "History (1)"
    )!;
    expect(history.open).toBe(false);
    expect(history.textContent).toContain("feature/PLGIT-1-removed");
    expect(history.textContent).toContain("Removed");
    expect(history.querySelector("a")?.getAttribute("href")).toBe(removed.data.web_url);
    expect(history.textContent).not.toContain("Protected");
    expect(section.querySelectorAll("a")).toHaveLength(2);
    await act(async () => history.querySelector("button")!.click());
    expect(action).toHaveBeenCalledWith("unlink", "removed-branch-object");
    await act(async () => root.render(<GitLabDevelopmentTree data={branchData} />));
    expect(section.querySelectorAll("button")).toHaveLength(0);
    await act(async () =>
      root.render(
        <GitLabDevelopmentTree data={{ ...empty, integrations: data.integrations, access_errors: ["access_denied"] }} />
      )
    );
    expect(container.querySelector('section[aria-label="Branches"]')).toBeNull();
    expect(container.textContent).not.toContain(branchName);
    await act(async () => root.unmount());
  });
});

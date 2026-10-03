import type { Meta, StoryObj } from "@storybook/react";
import type { TGitLabDevelopment } from "@plane/types";
import { GitLabDevelopmentTree } from "./tree";

const data: TGitLabDevelopment = {
  integrations: [
    {
      id: "gitlab",
      name: "GitLab",
      base_url: "https://gitlab.example.com",
      enabled: true,
      status: "connected",
      error_code: "",
      last_synced_at: "2026-10-03T10:00:00Z",
      user_connected: true,
      username: "developer",
      oauth_configured: true,
    },
  ],
  access_errors: [],
  objects: [
    {
      id: "mr",
      kind: "mr",
      external_id: "1",
      repository_id: "repo",
      repository: "team/backend",
      synced_at: "2026-10-03T10:00:00Z",
      data: {
        title: "Add GitLab links plane:DEV-1",
        state: "opened",
        source_branch: "feature/gitlab-integration",
        target_branch: "main",
        web_url: "https://gitlab.example.com/team/backend/-/merge_requests/1",
      },
    },
    {
      id: "commit",
      kind: "commit",
      external_id: "abcdef123456",
      repository_id: "repo",
      repository: "team/backend",
      synced_at: "2026-10-03T10:00:00Z",
      data: {
        message: "Implement development widget\n\nPreserve multiple CI runs and pinned job IDs.\nplane:DEV-1",
        author_name: "Alex Developer",
        committed_date: "2026-10-03T09:00:00Z",
        web_url: "https://gitlab.example.com/team/backend/-/commit/abcdef123456",
      },
    },
    {
      id: "pipeline",
      kind: "pipeline",
      external_id: "42",
      repository_id: "repo",
      repository: "team/backend",
      synced_at: "2026-10-03T10:00:00Z",
      data: {
        status: "failed",
        ref: "feature/integration",
        source: "push",
        tag: false,
        sha: "abcdef123456",
        started_at: "2026-10-03T09:01:00Z",
        web_url: "https://gitlab.example.com/team/backend/-/pipelines/42",
      },
    },
    {
      id: "job",
      kind: "job",
      external_id: "99",
      repository_id: "repo",
      repository: "team/backend",
      synced_at: "2026-10-03T10:00:00Z",
      data: {
        name: "test",
        stage: "verify",
        duration: 42.7,
        status: "failed",
        pipeline_id: 42,
        sha: "abcdef123456",
        web_url: "https://gitlab.example.com/team/backend/-/jobs/99",
      },
    },
  ],
  relations: [
    { parent: "mr", child: "commit", created_at: "2026-10-03T10:00:00Z" },
    { parent: "commit", child: "pipeline", created_at: "2026-10-03T10:00:00Z" },
    { parent: "pipeline", child: "job", created_at: "2026-10-03T10:00:00Z" },
  ],
  links: [
    { id: "link", object_id: "mr", origins: ["marker", "manual"], pinned: false, created_at: "2026-10-03T10:00:00Z" },
    { id: "pin", object_id: "job", origins: ["pin"], pinned: true, created_at: "2026-10-03T10:00:00Z" },
  ],
};
const meta: Meta<typeof GitLabDevelopmentTree> = {
  title: "Integrations/GitLab Development",
  component: GitLabDevelopmentTree,
};
export default meta;
type Story = StoryObj<typeof GitLabDevelopmentTree>;
export const Connected: Story = { args: { data, editable: true, onAction: () => {} } };
export const ReadOnly: Story = { args: { data } };
export const Empty: Story = { args: { data: { ...data, objects: [], relations: [], links: [] } } };
export const RetryAndMergeResult: Story = {
  args: {
    data: {
      ...data,
      objects: [
        ...data.objects.map((object) =>
          object.kind === "job" ? { ...object, data: { ...object.data, retried: true } } : object
        ),
        {
          ...data.objects[2],
          id: "merge-pipeline",
          external_id: "43",
          data: {
            status: "running",
            ref: "refs/merge-requests/1/merge",
            source: "merge_request_event",
            sha: "123456abcdef",
            started_at: "2026-10-03T09:03:00Z",
            web_url: "https://gitlab.example.com/team/backend/-/pipelines/43",
          },
        },
        {
          ...data.objects[3],
          id: "retry",
          external_id: "100",
          data: {
            ...data.objects[3].data,
            status: "success",
            duration: 40.2,
            web_url: "https://gitlab.example.com/team/backend/-/jobs/100",
          },
        },
      ],
      relations: [
        ...data.relations,
        { parent: "mr", child: "merge-pipeline", created_at: "2026-10-03T10:00:00Z" },
        { parent: "pipeline", child: "retry", created_at: "2026-10-03T10:00:00Z" },
      ],
    },
    editable: true,
    onAction: () => {},
  },
};

export const BranchesBeforeMergeRequest: Story = {
  args: {
    data: {
      ...data,
      objects: [
        ...data.objects,
        {
          id: "active-branch",
          kind: "branch",
          external_id: "a".repeat(64),
          repository_id: "repo",
          repository: "team/backend",
          synced_at: "2026-10-03T10:00:00Z",
          data: {
            name: "feature/DEV-1-gitlab-links",
            state: "active",
            sha: "abcdef1234567890",
            protected: true,
            default: false,
            author_name: "Alex Developer",
            committed_date: "2026-10-03T09:00:00Z",
            web_url: "https://gitlab.example.com/team/backend/-/tree/feature%2FDEV-1-gitlab-links",
          },
        },
        {
          id: "removed-branch",
          kind: "branch",
          external_id: "b".repeat(64),
          repository_id: "repo",
          repository: "team/backend",
          synced_at: "2026-10-03T10:00:00Z",
          data: {
            name: "feature/DEV-1-previous-attempt",
            state: "deleted",
            sha: "1234567890abcdef",
            web_url: "https://gitlab.example.com/team/backend/-/tree/feature%2FDEV-1-previous-attempt",
          },
        },
      ],
      links: [
        ...data.links.map((link) =>
          link.object_id === "mr" ? Object.assign({}, link, { origins: ["branch", "marker"] }) : link
        ),
        {
          id: "branch-link",
          object_id: "active-branch",
          origins: ["branch"],
          pinned: false,
          created_at: "2026-10-03T10:00:00Z",
        },
        {
          id: "removed-branch-link",
          object_id: "removed-branch",
          origins: ["branch"],
          pinned: false,
          created_at: "2026-10-03T10:00:00Z",
        },
      ],
    },
    editable: true,
    onAction: () => {},
  },
};

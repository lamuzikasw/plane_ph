import { API_BASE_URL } from "@plane/constants";
import type { TGitLabConfiguration, TGitLabDevelopment, TGitLabIntegration, TGitLabMutation } from "@plane/types";
import { APIService } from "@/services/api.service";

export class GitLabIntegrationService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getDevelopment(workspace: string, project: string, issue: string): Promise<TGitLabDevelopment> {
    return (
      await this.get(
        `/api/workspaces/${workspace}/projects/${project}/issues/${issue}/development/`,
        {},
        { timeout: 30000 }
      )
    ).data;
  }

  async mutateDevelopment(
    workspace: string,
    project: string,
    issue: string,
    data: TGitLabMutation
  ): Promise<TGitLabDevelopment> {
    return (
      await this.post(`/api/workspaces/${workspace}/projects/${project}/issues/${issue}/development/`, data, {
        timeout: 120000,
      })
    ).data;
  }

  async configurations(workspace: string): Promise<{ integrations: TGitLabIntegration[]; can_configure: boolean }> {
    return (await this.get(`/api/workspaces/${workspace}/gitlab-integrations/`, {}, { timeout: 30000 })).data;
  }

  async configure(
    workspace: string,
    data: TGitLabConfiguration
  ): Promise<TGitLabIntegration & { webhook_secret: string }> {
    return (await this.post(`/api/workspaces/${workspace}/gitlab-integrations/`, data, { timeout: 120000 })).data;
  }

  async connect(workspace: string, integration: string, returnPath: string): Promise<string> {
    return (
      await this.post(
        `/api/workspaces/${workspace}/gitlab-integrations/${integration}/connect/`,
        {
          return_path: returnPath,
        },
        { timeout: 30000 }
      )
    ).data.url;
  }
}

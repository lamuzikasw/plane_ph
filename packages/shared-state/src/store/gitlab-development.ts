import { makeAutoObservable, runInAction } from "mobx";
import type { TGitLabDevelopment, TGitLabMutation } from "@plane/types";

export interface IGitLabDevelopmentService {
  getDevelopment(workspace: string, project: string, issue: string): Promise<TGitLabDevelopment>;
  mutateDevelopment(
    workspace: string,
    project: string,
    issue: string,
    mutation: TGitLabMutation
  ): Promise<TGitLabDevelopment>;
}

export class GitLabDevelopmentStore {
  data: TGitLabDevelopment | undefined;
  loading = false;
  saving = false;
  error: string | undefined;
  private generation = 0;

  constructor(
    private service: IGitLabDevelopmentService,
    private workspace: string,
    private project: string,
    private issue: string,
    readonly userId?: string
  ) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  async load() {
    if (this.loading || this.saving) return;
    const generation = ++this.generation;
    this.loading = true;
    try {
      const data = await this.service.getDevelopment(this.workspace, this.project, this.issue);
      runInAction(() => {
        if (generation !== this.generation) return;
        this.data = data;
        this.error = undefined;
      });
    } catch {
      runInAction(() => {
        if (generation !== this.generation) return;
        this.data = undefined;
        this.error = "load";
      });
    } finally {
      runInAction(() => {
        if (generation === this.generation) this.loading = false;
      });
    }
  }

  async mutate(mutation: TGitLabMutation): Promise<boolean> {
    if (this.saving) return false;
    const generation = ++this.generation;
    this.saving = true;
    this.loading = false;
    try {
      const data = await this.service.mutateDevelopment(this.workspace, this.project, this.issue, mutation);
      runInAction(() => {
        if (generation !== this.generation) return;
        this.data = data;
        this.error = undefined;
      });
      return generation === this.generation;
    } catch {
      runInAction(() => {
        if (generation === this.generation) {
          this.data = undefined;
          this.error = "mutation";
        }
      });
      return false;
    } finally {
      runInAction(() => {
        if (generation === this.generation) this.saving = false;
      });
    }
  }

  dispose() {
    this.generation++;
    this.data = undefined;
    this.loading = false;
    this.saving = false;
  }

  connectionFailed() {
    this.error = "connect";
  }
}

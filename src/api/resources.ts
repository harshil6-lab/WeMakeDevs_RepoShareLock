import type { GitHubClient } from "../github/types";
import type { RepositoryStore } from "../storage/types";

export type RepositoryResourceService = {
  listRepositories: () => Promise<unknown[]>;
  createRepository: (input: { owner: string; name: string }) => Promise<unknown>;
  getRepository: (repositoryId: string) => Promise<unknown>;
  startIndex: (repositoryId: string) => Promise<unknown>;
  getIndexStatus: (repositoryId: string) => Promise<unknown>;
  listIssues: (repositoryId: string) => Promise<unknown[]>;
  getIssue: (repositoryId: string, issueNumber: number) => Promise<unknown>;
  listEvidence: (investigationId: string) => Promise<unknown[]>;
};

export type RepositoryResourceOptions = {
  storage: RepositoryStore;
  userId: string;
  github?: GitHubClient;
  startIndex?: (repositoryId: string) => Promise<void>;
};

export function createRepositoryResourceService(
  options: RepositoryResourceOptions,
): RepositoryResourceService {
  return {
    async listRepositories() {
      const page = await options.storage.repositories.listForUser(options.userId, undefined, 100);
      return page.items;
    },
    async createRepository(input) {
      if (!options.github) throw new Error("Repository creation is not configured");
      const repository = await options.github.getRepository(input.owner, input.name);
      const record = {
        repositoryId: String(repository.id),
        userId: options.userId,
        owner: repository.owner.login,
        name: repository.name,
        defaultBranch: repository.default_branch,
        indexingStatus: "not_started" as const,
        createdAt: repository.updated_at,
        updatedAt: repository.updated_at,
      };
      await options.storage.repositories.create(record);
      return record;
    },
    async getRepository(repositoryId) {
      const repository = await options.storage.repositories.get(repositoryId);
      if (!repository) throw new Error("Repository was not found");
      return repository;
    },
    async startIndex(repositoryId) {
      const repository = await options.storage.repositories.get(repositoryId);
      if (!repository) throw new Error("Repository was not found");
      if (!options.startIndex) throw new Error("Repository indexing is not configured");
      // Awaited so a serverless runtime cannot freeze before the asynchronous
      // indexing invoke is accepted. Ingestion itself runs outside this request.
      await options.startIndex(repositoryId);
      return { repositoryId, status: "running" };
    },
    async getIndexStatus(repositoryId) {
      const repository = await options.storage.repositories.get(repositoryId);
      if (!repository) throw new Error("Repository was not found");
      return {
        repositoryId,
        status: repository.indexingStatus,
        progress: repository.indexingStatus === "completed" ? 100 : 0,
      };
    },
    async listIssues(repositoryId) {
      const page = await options.storage.issues.listForRepository(repositoryId, undefined, 100);
      return page.items;
    },
    async getIssue(repositoryId, issueNumber) {
      const issue = await options.storage.issues.get(repositoryId, issueNumber);
      if (!issue) throw new Error("Issue was not found");
      return issue;
    },
    async listEvidence(investigationId) {
      const investigation = await options.storage.investigations.get(investigationId);
      const result = investigation?.result?.["evidence"];
      return Array.isArray(result) ? result : [];
    },
  };
}

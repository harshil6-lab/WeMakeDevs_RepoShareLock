import type { GitHubClient } from "../github/types";
import type { RepositoryStore } from "../storage/types";
import { NotFoundError } from "./errors";

/**
 * Repository, issue and evidence reads.
 *
 * Every method takes the authenticated `userId` and resolves ownership before
 * returning anything. A resource that belongs to somebody else is reported as
 * not found, so the API neither serves nor discloses another user's data.
 */
export type RepositoryResourceService = {
  listRepositories: (userId: string) => Promise<unknown[]>;
  createRepository: (userId: string, input: { owner: string; name: string }) => Promise<unknown>;
  getRepository: (userId: string, repositoryId: string) => Promise<unknown>;
  startIndex: (userId: string, repositoryId: string) => Promise<unknown>;
  getIndexStatus: (userId: string, repositoryId: string) => Promise<unknown>;
  listIssues: (userId: string, repositoryId: string) => Promise<unknown[]>;
  getIssue: (userId: string, repositoryId: string, issueNumber: number) => Promise<unknown>;
  listEvidence: (userId: string, investigationId: string) => Promise<unknown[]>;
};

export type RepositoryResourceOptions = {
  storage: RepositoryStore;
  github?: GitHubClient;
  startIndex?: (userId: string, repositoryId: string) => Promise<void>;
};

export function createRepositoryResourceService(
  options: RepositoryResourceOptions,
): RepositoryResourceService {
  /** Loads a repository only when the verified user owns it. */
  async function requireOwnedRepository(userId: string, repositoryId: string) {
    const repository = await options.storage.repositories.get(repositoryId);
    if (!repository || repository.userId !== userId)
      throw new NotFoundError("Repository was not found.");
    return repository;
  }

  return {
    async listRepositories(userId) {
      const page = await options.storage.repositories.listForUser(userId, undefined, 100);
      return page.items;
    },

    async createRepository(userId, input) {
      if (!options.github) throw new Error("Repository creation is not configured");
      const repository = await options.github.getRepository(input.owner, input.name);
      const record = {
        repositoryId: String(repository.id),
        userId,
        owner: repository.owner.login,
        name: repository.name,
        defaultBranch: repository.default_branch,
        indexingStatus: "not_started" as const,
        createdAt: repository.updated_at,
        updatedAt: repository.updated_at,
      };
      const existing = await options.storage.repositories.get(record.repositoryId);
      if (existing && existing.userId !== userId)
        throw new NotFoundError("Repository was not found.");
      await options.storage.repositories.create(record);
      return record;
    },

    async getRepository(userId, repositoryId) {
      return requireOwnedRepository(userId, repositoryId);
    },

    async startIndex(userId, repositoryId) {
      await requireOwnedRepository(userId, repositoryId);
      if (!options.startIndex) throw new Error("Repository indexing is not configured");
      // Awaited so a serverless runtime cannot freeze before the asynchronous
      // indexing invoke is accepted. Ingestion itself runs outside this request.
      await options.startIndex(userId, repositoryId);
      return { repositoryId, status: "running" };
    },

    async getIndexStatus(userId, repositoryId) {
      const repository = await requireOwnedRepository(userId, repositoryId);
      return {
        repositoryId,
        status: repository.indexingStatus,
        progress: repository.indexingStatus === "completed" ? 100 : 0,
      };
    },

    async listIssues(userId, repositoryId) {
      await requireOwnedRepository(userId, repositoryId);
      const page = await options.storage.issues.listForRepository(repositoryId, undefined, 100);
      return page.items;
    },

    async getIssue(userId, repositoryId, issueNumber) {
      await requireOwnedRepository(userId, repositoryId);
      const issue = await options.storage.issues.get(repositoryId, issueNumber);
      if (!issue) throw new NotFoundError("Issue was not found.");
      return issue;
    },

    async listEvidence(userId, investigationId) {
      const investigation = await options.storage.investigations.get(investigationId);
      if (!investigation || investigation.userId !== userId)
        throw new NotFoundError("Investigation was not found.");
      const result = investigation.result?.["evidence"];
      return Array.isArray(result) ? result : [];
    },
  };
}

import type { ArtifactRepository } from "../../src/storage/s3-repository";
import { s3Keys } from "../../src/storage/keys";
import type {
  CommitMetadataRecord,
  EvidenceRecord,
  InvestigationRecord,
  IssueMetadataRecord,
  Page,
  RepositoryChunkRecord,
  RepositoryFileRecord,
  RepositoryRecord,
  RepositoryStore,
  UserRecord,
} from "../../src/storage/types";

/**
 * In-memory implementations of the storage ports.
 *
 * They mirror the DynamoDB conditional semantics that the worker relies on
 * (only `queued` work can be claimed, only `running` work can progress or
 * finish) so the golden path exercises the real lifecycle rules without AWS.
 */
export type GoldenStore = RepositoryStore & {
  readonly investigationsById: Map<string, InvestigationRecord>;
  readonly commitsStored: CommitMetadataRecord[];
  readonly filesStored: RepositoryFileRecord[];
};

export function createInMemoryRepositoryStore(): GoldenStore {
  const users = new Map<string, UserRecord>();
  const repositories = new Map<string, RepositoryRecord>();
  const chunks: RepositoryChunkRecord[] = [];
  const files: RepositoryFileRecord[] = [];
  const commits: CommitMetadataRecord[] = [];
  const investigationsById = new Map<string, InvestigationRecord>();
  const evidence: EvidenceRecord[] = [];
  const issues: IssueMetadataRecord[] = [];

  const page = <T>(items: T[]): Page<T> => ({ items });

  const store: GoldenStore = {
    investigationsById,
    commitsStored: commits,
    filesStored: files,
    users: {
      create: async (record) => void users.set(record.userId, record),
      get: async (userId) => users.get(userId),
      update: async (record) => void users.set(record.userId, record),
    },
    repositories: {
      create: async (record) => void repositories.set(record.repositoryId, { ...record }),
      get: async (repositoryId) => repositories.get(repositoryId),
      listForUser: async (userId) =>
        page([...repositories.values()].filter((record) => record.userId === userId)),
      updateIndexingStatus: async (repositoryId, status, updatedAt) => {
        const existing = repositories.get(repositoryId);
        if (!existing) throw new Error(`Repository ${repositoryId} is not indexed`);
        repositories.set(repositoryId, { ...existing, indexingStatus: status, updatedAt });
      },
    },
    chunks: {
      put: async (record) => void chunks.push(record),
      listForRepository: async (repositoryId) =>
        page(chunks.filter((record) => record.repositoryId === repositoryId)),
    },
    files: {
      put: async (record) => void files.push(record),
    },
    commits: {
      put: async (record) => void commits.push(record),
    },
    investigations: {
      create: async (record) => void investigationsById.set(record.investigationId, { ...record }),
      get: async (investigationId) => investigationsById.get(investigationId),
      updateStatus: async (investigationId, status, updatedAt) => {
        const record = investigationsById.get(investigationId);
        if (!record) throw new Error("Investigation was not found");
        investigationsById.set(investigationId, { ...record, status, updatedAt });
      },
      claimQueued: async (investigationId, startedAt, updatedAt) => {
        const record = investigationsById.get(investigationId);
        if (!record || record.status !== "queued") return false;
        investigationsById.set(investigationId, {
          ...record,
          status: "running",
          startedAt,
          updatedAt,
        });
        return true;
      },
      updateProgress: async (investigationId, stage, progress, updatedAt) => {
        const record = investigationsById.get(investigationId);
        if (!record) throw new Error("Investigation was not found");
        // Progress is dropped once the investigation reaches a terminal state,
        // matching the conditional DynamoDB write.
        if (record.status !== "running") return;
        investigationsById.set(investigationId, {
          ...record,
          currentStage: stage,
          progress,
          updatedAt,
        });
      },
      complete: async (investigationId, result, completedAt, durationMs, updatedAt) => {
        const record = investigationsById.get(investigationId);
        if (!record) throw new Error("Investigation was not found");
        if (record.status !== "running") return false;
        investigationsById.set(investigationId, {
          ...record,
          status: "completed",
          currentStage: "completed",
          progress: 100,
          result,
          completedAt,
          durationMs,
          updatedAt,
          failureCode: undefined,
          error: undefined,
        });
        return true;
      },
      fail: async (
        investigationId,
        status,
        failureCode,
        error,
        completedAt,
        durationMs,
        updatedAt,
      ) => {
        const record = investigationsById.get(investigationId);
        if (!record) throw new Error("Investigation was not found");
        if (record.status !== "running") return false;
        investigationsById.set(investigationId, {
          ...record,
          status,
          failureCode,
          error,
          completedAt,
          durationMs,
          updatedAt,
        });
        return true;
      },
    },
    evidence: {
      put: async (record) => void evidence.push(record),
      listForInvestigation: async (investigationId) =>
        page(evidence.filter((record) => record.investigationId === investigationId)),
    },
    issues: {
      put: async (record) => {
        const index = issues.findIndex(
          (existing) =>
            existing.repositoryId === record.repositoryId &&
            existing.issueNumber === record.issueNumber,
        );
        if (index >= 0) issues[index] = record;
        else issues.push(record);
      },
      get: async (repositoryId, issueNumber) =>
        issues.find(
          (record) => record.repositoryId === repositoryId && record.issueNumber === issueNumber,
        ),
      listForRepository: async (repositoryId) =>
        page(issues.filter((record) => record.repositoryId === repositoryId)),
    },
  };
  return store;
}

export function createInMemoryArtifactRepository(): ArtifactRepository & {
  readonly objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    putSnapshot: async (repositoryId, snapshotVersion, body) => {
      const key = s3Keys.snapshot(repositoryId, snapshotVersion);
      objects.set(key, body);
      return key;
    },
    putRawArtifact: async (repositoryId, artifactPath, body) => {
      const key = s3Keys.rawArtifact(repositoryId, artifactPath);
      objects.set(key, body);
      return key;
    },
    putChunk: async (repositoryId, chunkId, body) => {
      const key = s3Keys.chunk(repositoryId, chunkId);
      objects.set(key, body);
      return key;
    },
    get: async (objectKey) => {
      const body = objects.get(objectKey);
      if (!body) throw new Error(`Artifact ${objectKey} was not found`);
      return body;
    },
  };
}

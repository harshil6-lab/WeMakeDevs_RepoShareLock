export type Timestamp = string;

export type EntityStatus = "active" | "inactive";
export type IndexingStatus = "not_started" | "queued" | "running" | "completed" | "failed";
export type InvestigationStatus = "queued" | "running" | "completed" | "failed" | "timeout";
export type InvestigationStage =
  | "understanding_issue"
  | "searching_repository"
  | "tracing_code"
  | "checking_history"
  | "finding_related_issues"
  | "forming_hypothesis"
  | "verifying_evidence"
  | "synthesizing"
  | "validating"
  | "completed";
export type EvidenceType = "source_file" | "commit" | "issue" | "pull_request" | "artifact";

export type UserRecord = {
  userId: string;
  email?: string;
  displayName?: string;
  status: EntityStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type RepositoryRecord = {
  repositoryId: string;
  userId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  indexingStatus: IndexingStatus;
  snapshotVersion?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type RepositoryChunkRecord = {
  repositoryId: string;
  chunkId: string;
  objectKey: string;
  contentHash: string;
  filePath: string;
  commitSha: string;
  language: string;
  startLine: number;
  endLine: number;
  embedding: number[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type RepositoryFileRecord = {
  repositoryId: string;
  filePath: string;
  language?: string;
  size?: number;
  commitSha: string;
  objectKey: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CommitMetadataRecord = {
  repositoryId: string;
  commitSha: string;
  author: string;
  message: string;
  createdAt: Timestamp;
};

export type InvestigationRecord = {
  investigationId: string;
  userId?: string;
  repositoryId: string;
  issueNumber: number;
  status: InvestigationStatus;
  currentStage?: InvestigationStage;
  progress?: number;
  createdAt: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  updatedAt: Timestamp;
  result?: Record<string, unknown>;
  error?: string;
  failureCode?: string;
  durationMs?: number;
};

export type EvidenceRecord = {
  investigationId: string;
  evidenceId: string;
  type: EvidenceType;
  locator: string;
  excerpt?: string;
  sourceObjectKey?: string;
  createdAt: Timestamp;
};

export type IssueMetadataRecord = {
  repositoryId: string;
  issueNumber: number;
  title: string;
  state: "open" | "closed";
  updatedAt: Timestamp;
};

export type Page<T> = {
  items: T[];
  nextToken?: string;
};

export type RepositoryStore = {
  users: {
    create: (record: UserRecord) => Promise<void>;
    get: (userId: string) => Promise<UserRecord | undefined>;
    update: (record: UserRecord) => Promise<void>;
  };
  repositories: {
    create: (record: RepositoryRecord) => Promise<void>;
    get: (repositoryId: string) => Promise<RepositoryRecord | undefined>;
    listForUser: (
      userId: string,
      nextToken?: string,
      limit?: number,
    ) => Promise<Page<RepositoryRecord>>;
    updateIndexingStatus: (
      repositoryId: string,
      status: IndexingStatus,
      updatedAt: Timestamp,
    ) => Promise<void>;
  };
  chunks: {
    put: (record: RepositoryChunkRecord) => Promise<void>;
    listForRepository: (
      repositoryId: string,
      nextToken?: string,
      limit?: number,
    ) => Promise<Page<RepositoryChunkRecord>>;
  };
  files: {
    put: (record: RepositoryFileRecord) => Promise<void>;
  };
  commits: {
    put: (record: CommitMetadataRecord) => Promise<void>;
  };
  investigations: {
    create: (record: InvestigationRecord) => Promise<void>;
    get: (investigationId: string) => Promise<InvestigationRecord | undefined>;
    updateStatus: (
      investigationId: string,
      status: InvestigationStatus,
      updatedAt: Timestamp,
    ) => Promise<void>;
    claimQueued: (
      investigationId: string,
      startedAt: Timestamp,
      updatedAt: Timestamp,
    ) => Promise<boolean>;
    updateProgress: (
      investigationId: string,
      stage: InvestigationStage,
      progress: number,
      updatedAt: Timestamp,
    ) => Promise<void>;
    complete: (
      investigationId: string,
      result: Record<string, unknown>,
      completedAt: Timestamp,
      durationMs: number,
      updatedAt: Timestamp,
    ) => Promise<boolean>;
    fail: (
      investigationId: string,
      status: "failed" | "timeout",
      failureCode: string,
      error: string,
      completedAt: Timestamp,
      durationMs: number,
      updatedAt: Timestamp,
    ) => Promise<boolean>;
  };
  evidence: {
    put: (record: EvidenceRecord) => Promise<void>;
    listForInvestigation: (
      investigationId: string,
      nextToken?: string,
      limit?: number,
    ) => Promise<Page<EvidenceRecord>>;
  };
  issues: {
    put: (record: IssueMetadataRecord) => Promise<void>;
    get: (repositoryId: string, issueNumber: number) => Promise<IssueMetadataRecord | undefined>;
    listForRepository: (
      repositoryId: string,
      nextToken?: string,
      limit?: number,
    ) => Promise<Page<IssueMetadataRecord>>;
  };
};

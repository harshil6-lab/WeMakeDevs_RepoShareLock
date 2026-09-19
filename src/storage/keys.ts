export const tableKeys = {
  user: (userId: string) => ({ PK: `USER#${userId}`, SK: "PROFILE" }),
  repository: (repositoryId: string) => ({ PK: `REPOSITORY#${repositoryId}`, SK: "METADATA" }),
  repositoryForUser: (userId: string, repositoryId: string) => ({
    PK: `USER#${userId}`,
    SK: `REPOSITORY#${repositoryId}`,
  }),
  chunk: (repositoryId: string, chunkId: string) => ({
    PK: `REPOSITORY#${repositoryId}`,
    SK: `CHUNK#${chunkId}`,
  }),
  file: (repositoryId: string, filePath: string) => ({
    PK: `REPOSITORY#${repositoryId}`,
    SK: `FILE#${filePath}`,
  }),
  commit: (repositoryId: string, commitSha: string) => ({
    PK: `REPOSITORY#${repositoryId}`,
    SK: `COMMIT#${commitSha}`,
  }),
  investigation: (investigationId: string) => ({
    PK: `INVESTIGATION#${investigationId}`,
    SK: "METADATA",
  }),
  evidence: (investigationId: string, evidenceId: string) => ({
    PK: `INVESTIGATION#${investigationId}`,
    SK: `EVIDENCE#${evidenceId}`,
  }),
  issue: (repositoryId: string, issueNumber: number) => ({
    PK: `REPOSITORY#${repositoryId}`,
    SK: `ISSUE#${issueNumber}`,
  }),
};

export const indexKeys = {
  userRepository: (userId: string, repositoryId: string) => ({
    GSI1PK: `USER#${userId}`,
    GSI1SK: `REPOSITORY#${repositoryId}`,
  }),
  repositoryChunk: (repositoryId: string, chunkId: string) => ({
    GSI1PK: `REPOSITORY#${repositoryId}`,
    GSI1SK: `CHUNK#${chunkId}`,
  }),
};

export const s3Keys = {
  repositoryRoot: (repositoryId: string) => `repositories/${repositoryId}/`,
  snapshot: (repositoryId: string, snapshotVersion: string) =>
    `repositories/${repositoryId}/snapshots/${snapshotVersion}/snapshot.tar.gz`,
  rawArtifact: (repositoryId: string, artifactPath: string) =>
    `repositories/${repositoryId}/raw/${artifactPath.replace(/^\/+/, "")}`,
  chunk: (repositoryId: string, chunkId: string) =>
    `repositories/${repositoryId}/chunks/${chunkId}.json`,
};

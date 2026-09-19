export const tableKeys = {
  user: (userId: string) => ({ pk: `USER#${userId}`, sk: "PROFILE" }),
  repository: (repositoryId: string) => ({ pk: `REPOSITORY#${repositoryId}`, sk: "METADATA" }),
  repositoryForUser: (userId: string, repositoryId: string) => ({
    pk: `USER#${userId}`,
    sk: `REPOSITORY#${repositoryId}`,
  }),
  chunk: (repositoryId: string, chunkId: string) => ({
    pk: `REPOSITORY#${repositoryId}`,
    sk: `CHUNK#${chunkId}`,
  }),
  file: (repositoryId: string, filePath: string) => ({
    pk: `REPOSITORY#${repositoryId}`,
    sk: `FILE#${filePath}`,
  }),
  commit: (repositoryId: string, commitSha: string) => ({
    pk: `REPOSITORY#${repositoryId}`,
    sk: `COMMIT#${commitSha}`,
  }),
  investigation: (investigationId: string) => ({
    pk: `INVESTIGATION#${investigationId}`,
    sk: "METADATA",
  }),
  evidence: (investigationId: string, evidenceId: string) => ({
    pk: `INVESTIGATION#${investigationId}`,
    sk: `EVIDENCE#${evidenceId}`,
  }),
  issue: (repositoryId: string, issueNumber: number) => ({
    pk: `REPOSITORY#${repositoryId}`,
    sk: `ISSUE#${issueNumber}`,
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

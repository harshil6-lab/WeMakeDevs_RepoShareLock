import type { ArtifactRepository } from "../storage/s3-repository";
import type { RepositoryStore } from "../storage/types";
import type { StructuredLogger } from "../api/logger";
import { IngestionError } from "./errors";
import type { GitHubClient, GitHubRepository, GitHubTreeEntry } from "./types";
import {
  detectLanguage,
  indexSourceFile,
  isIndexableSourceFile,
  type RetrievalConfig,
} from "../retrieval";

const sourceExtensions = new Set([
  ".c",
  ".cpp",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".py",
  ".rs",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);
const ignoredPathParts = new Set([".git", "node_modules", "dist", "build", "coverage"]);

export type IngestionOptions = {
  maxFiles?: number;
  maxFileBytes?: number;
  logger?: StructuredLogger;
  retrieval?: RetrievalConfig;
};
export type IngestionResult = {
  repositoryId: string;
  snapshotVersion: string;
  filesStored: number;
  issuesStored: number;
};

function relevant(entry: GitHubTreeEntry): boolean {
  return (
    entry.type === "blob" &&
    sourceExtensions.has(`.${entry.path.split(".").at(-1)?.toLowerCase() ?? ""}`) &&
    isIndexableSourceFile(entry.path)
  );
}

export async function ingestRepository(
  github: GitHubClient,
  storage: RepositoryStore,
  artifacts: ArtifactRepository,
  input: { userId: string; owner: string; name: string; repositoryId?: string },
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const maxFiles = Math.min(Math.max(options.maxFiles ?? 100, 1), 500);
  const maxFileBytes = Math.min(Math.max(options.maxFileBytes ?? 512_000, 1), 2_000_000);
  const repository: GitHubRepository = await github.getRepository(input.owner, input.name);
  const repositoryId = input.repositoryId ?? String(repository.id);
  const tree = await github.getTree(input.owner, input.name, repository.default_branch);
  if (tree.truncated)
    throw new IngestionError(
      "INGESTION_BOUNDED",
      "GitHub tree response was truncated; ingestion refused to fabricate a complete index.",
    );
  await storage.repositories.create({
    repositoryId,
    userId: input.userId,
    owner: repository.owner.login,
    name: repository.name,
    defaultBranch: repository.default_branch,
    indexingStatus: "running",
    snapshotVersion: tree.sha,
    createdAt: repository.updated_at,
    updatedAt: repository.updated_at,
  });
  const archive = await github.downloadRepositorySource(input.owner, input.name, tree.sha);
  await artifacts.putSnapshot(repositoryId, tree.sha, archive);
  let filesStored = 0;
  for (const entry of tree.tree.filter(relevant).slice(0, maxFiles)) {
    const content = await github.getFile(input.owner, input.name, entry.path, tree.sha);
    if (content.byteLength > maxFileBytes) {
      options.logger?.warn("github_file_skipped_size", {
        path: entry.path,
        bytes: content.byteLength,
      });
      continue;
    }
    const objectKey = await artifacts.putRawArtifact(repositoryId, entry.path, content);
    const language = detectLanguage(entry.path);
    if (!language) continue;
    const fileMetadata = {
      repositoryId,
      filePath: entry.path,
      language,
      commitSha: entry.sha,
      objectKey,
      createdAt: repository.updated_at,
      updatedAt: repository.updated_at,
      ...(entry.size === undefined ? {} : { size: entry.size }),
    };
    await storage.files.put(fileMetadata);
    await indexSourceFile(
      storage,
      artifacts,
      {
        repositoryId,
        filePath: entry.path,
        commitSha: entry.sha,
        content: new TextDecoder().decode(content),
        language,
      },
      repository.updated_at,
      options.retrieval,
    );
    filesStored += 1;
  }
  for (let page = 1; page <= 10; page += 1) {
    const commits = await github.listCommits(input.owner, input.name, page);
    for (const commit of commits.items) {
      await storage.commits.put({
        repositoryId,
        commitSha: commit.sha,
        author: commit.commit.author?.name ?? "unknown",
        message: commit.commit.message,
        createdAt: commit.commit.author?.date ?? repository.updated_at,
      });
    }
    if (!commits.nextPage) break;
  }
  let issuesStored = 0;
  for (let page = 1; page <= 10; page += 1) {
    const issues = await github.listIssues(input.owner, input.name, page);
    for (const issue of issues.items) {
      if (issue.pull_request) continue;
      await storage.issues.put({
        repositoryId,
        issueNumber: issue.number,
        title: issue.title,
        state: issue.state,
        updatedAt: issue.updated_at,
      });
      issuesStored += 1;
    }
    if (!issues.nextPage) break;
  }
  await storage.repositories.updateIndexingStatus(
    repositoryId,
    "completed",
    new Date().toISOString(),
  );
  return { repositoryId, snapshotVersion: tree.sha, filesStored, issuesStored };
}

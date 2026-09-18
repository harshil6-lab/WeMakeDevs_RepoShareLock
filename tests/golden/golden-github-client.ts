import type {
  GitHubClient,
  GitHubCommit,
  GitHubIssue,
  GitHubPage,
  GitHubRepository,
} from "../../src/github/types";
import {
  goldenCommits,
  goldenFileByPath,
  goldenFiles,
  goldenRepositoryFixture,
  goldenRepositoryIssues,
  goldenRelatedSearchResults,
} from "../fixtures/golden-repository.fixture";

/**
 * A GitHub client backed by the golden fixture.
 *
 * Reads are strictly resolved against the fixture: an unknown owner, path, ref
 * or sha throws instead of returning synthesized data, so the investigation can
 * never be handed a fabricated locator.
 */
export function createGoldenGitHubClient(): GitHubClient {
  const repository: GitHubRepository = {
    id: goldenRepositoryFixture.id,
    full_name: goldenRepositoryFixture.fullName,
    name: goldenRepositoryFixture.name,
    owner: { login: goldenRepositoryFixture.owner },
    default_branch: goldenRepositoryFixture.defaultBranch,
    private: goldenRepositoryFixture.private,
    html_url: `https://github.com/${goldenRepositoryFixture.fullName}`,
    updated_at: goldenRepositoryFixture.updatedAt,
  };

  const assertRepository = (owner: string, name: string) => {
    if (owner !== repository.owner.login || name !== repository.name)
      throw new Error(`Unknown golden repository ${owner}/${name}`);
  };

  const toCommit = (sha: string): GitHubCommit => {
    const commit = goldenCommits.find((candidate) => candidate.sha === sha);
    if (!commit) throw new Error(`Unknown golden commit ${sha}`);
    return {
      sha: commit.sha,
      commit: { message: commit.message, author: { ...commit.author } },
      html_url: `https://github.com/${goldenRepositoryFixture.fullName}/commit/${commit.sha}`,
    };
  };

  const page = <T>(items: T[]): GitHubPage<T> => ({ items });

  return {
    listAccessibleRepositories: async () => page([repository]),
    getRepository: async (owner, name) => {
      assertRepository(owner, name);
      return repository;
    },
    listIssues: async (owner, name) => {
      assertRepository(owner, name);
      return page(goldenRepositoryIssues as GitHubIssue[]);
    },
    getIssue: async (owner, name, issueNumber) => {
      assertRepository(owner, name);
      const issue = goldenRepositoryIssues.find((candidate) => candidate.number === issueNumber);
      if (!issue) throw new Error(`Unknown golden issue ${issueNumber}`);
      return issue as GitHubIssue;
    },
    getTree: async (owner, name, ref) => {
      assertRepository(owner, name);
      if (ref !== goldenRepositoryFixture.defaultBranch && ref !== goldenRepositoryFixture.treeSha)
        throw new Error(`Unknown golden ref ${ref}`);
      return {
        sha: goldenRepositoryFixture.treeSha,
        truncated: false,
        tree: goldenFiles.map((file) => ({
          path: file.path,
          mode: "100644",
          type: "blob" as const,
          sha: file.blobSha,
          size: file.size,
          url: `https://api.github.com/repos/${goldenRepositoryFixture.fullName}/git/blobs/${file.blobSha}`,
        })),
      };
    },
    getFile: async (owner, name, path) => {
      assertRepository(owner, name);
      const file = goldenFileByPath.get(path);
      if (!file) throw new Error(`Unknown golden path ${path}`);
      return new TextEncoder().encode(file.content);
    },
    downloadRepositorySource: async (owner, name, ref) => {
      assertRepository(owner, name);
      if (ref !== goldenRepositoryFixture.treeSha) throw new Error(`Unknown golden ref ${ref}`);
      return new TextEncoder().encode(
        goldenFiles.map((file) => `--- ${file.path}\n${file.content}`).join("\n"),
      );
    },
    listCommits: async (owner, name) => {
      assertRepository(owner, name);
      return page(goldenCommits.map((commit) => toCommit(commit.sha)));
    },
    getCommit: async (owner, name, sha) => {
      assertRepository(owner, name);
      return toCommit(sha);
    },
    searchRelated: async (owner, name, query) => {
      assertRepository(owner, name);
      const queryTokens = new Set(
        query
          .replace(/repo:\S+/g, " ")
          .toLowerCase()
          .match(/[a-z0-9]+/g)
          ?.filter((token) => token.length > 1) ?? [],
      );
      const matches = goldenRelatedSearchResults
        .map((issue) => {
          const titleTokens = issue.title.toLowerCase().match(/[a-z0-9]+/g) ?? [];
          const overlap = titleTokens.filter((token) => queryTokens.has(token)).length;
          return { issue, overlap };
        })
        .filter((candidate) => candidate.overlap > 0)
        .sort((left, right) => right.overlap - left.overlap)
        .map((candidate) => candidate.issue as GitHubIssue);
      return page(matches);
    },
  };
}

export type GitHubRepository = {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  html_url: string;
  updated_at: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  pull_request?: { url: string } | undefined;
};

export type GitHubCommit = {
  sha: string;
  commit: { message: string; author: { name: string; date: string } | null };
  html_url: string;
};

export type GitHubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number | undefined;
  url: string;
};

export type GitHubTree = { sha: string; truncated: boolean; tree: GitHubTreeEntry[] };

export type GitHubPage<T> = { items: T[]; nextPage?: number };

export type GitHubClient = {
  listAccessibleRepositories: (page?: number) => Promise<GitHubPage<GitHubRepository>>;
  getRepository: (owner: string, name: string) => Promise<GitHubRepository>;
  listIssues: (owner: string, name: string, page?: number) => Promise<GitHubPage<GitHubIssue>>;
  getIssue: (owner: string, name: string, issueNumber: number) => Promise<GitHubIssue>;
  getTree: (owner: string, name: string, ref: string) => Promise<GitHubTree>;
  getFile: (owner: string, name: string, path: string, ref: string) => Promise<Uint8Array>;
  downloadRepositorySource: (owner: string, name: string, ref: string) => Promise<Uint8Array>;
  listCommits: (owner: string, name: string, page?: number) => Promise<GitHubPage<GitHubCommit>>;
  getCommit: (owner: string, name: string, sha: string) => Promise<GitHubCommit>;
  searchRelated: (
    owner: string,
    name: string,
    query: string,
    page?: number,
  ) => Promise<GitHubPage<GitHubIssue>>;
};

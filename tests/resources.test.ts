import { describe, expect, it } from "vitest";
import { createApiRouter } from "../src/api/router";
import type { RepositoryResourceService } from "../src/api/resources";

const request = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);

const resources: RepositoryResourceService = {
  listRepositories: async () => [{ repositoryId: "repo-1", owner: "acme", name: "payments" }],
  createRepository: async () => ({ repositoryId: "repo-1" }),
  getRepository: async () => ({ repositoryId: "repo-1", indexingStatus: "completed" }),
  startIndex: async () => ({ repositoryId: "repo-1", status: "running" }),
  getIndexStatus: async () => ({ repositoryId: "repo-1", status: "completed", progress: 100 }),
  listIssues: async () => [
    { repositoryId: "repo-1", issueNumber: 42, title: "Timeout", state: "open" },
  ],
  getIssue: async () => ({
    repositoryId: "repo-1",
    issueNumber: 42,
    title: "Timeout",
    state: "open",
  }),
  listEvidence: async () => [
    {
      evidenceId: "file:1",
      excerpt: "source",
      provenance: { type: "repository_file", repositoryId: "repo-1" },
    },
  ],
};

describe("frozen frontend resource routes", () => {
  it("routes repositories, indexing, issues, auth, and evidence through the adapter", async () => {
    const router = createApiRouter({ resources });
    expect(
      (await router(request("/api/auth/session", { method: "POST", body: "{}" })))?.status,
    ).toBe(200);
    expect((await router(request("/api/repositories")))?.status).toBe(200);
    expect(
      (await router(request("/api/repositories/repo-1/index", { method: "POST", body: "{}" })))
        ?.status,
    ).toBe(202);
    expect((await router(request("/api/repositories/repo-1/index-status")))?.status).toBe(200);
    expect((await router(request("/api/repositories/repo-1/issues")))?.status).toBe(200);
    expect((await router(request("/api/investigations/inv-1/evidence")))?.status).toBe(200);
  });
});

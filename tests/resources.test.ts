import { describe, expect, it } from "vitest";
import { createApiRouter } from "../src/api/router";
import { createRepositoryResourceService } from "../src/api/resources";
import { createInMemoryRepositoryStore } from "./golden/in-memory-store";
import { testAuth } from "./helpers/auth";
import type { RepositoryStore } from "../src/storage/types";

const request = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const now = "2026-01-01T00:00:00.000Z";

async function seed(store: RepositoryStore, userId: string) {
  await store.repositories.create({
    repositoryId: "repo-1",
    userId,
    owner: "acme",
    name: "payments",
    defaultBranch: "main",
    indexingStatus: "completed",
    createdAt: now,
    updatedAt: now,
  });
  await store.issues.put({
    repositoryId: "repo-1",
    issueNumber: 42,
    title: "Timeout",
    state: "open",
    updatedAt: now,
  });
  await store.investigations.create({
    investigationId: "11111111-1111-4111-8111-111111111111",
    userId,
    repositoryId: "repo-1",
    issueNumber: 42,
    status: "completed",
    createdAt: now,
    updatedAt: now,
    result: {
      evidence: [
        {
          evidenceId: "file:1",
          excerpt: "source",
          provenance: { type: "repository_file", repositoryId: "repo-1" },
        },
      ],
    },
  });
}

async function buildRouter(userId = "user-1") {
  const store = createInMemoryRepositoryStore();
  await seed(store, userId);
  const resources = createRepositoryResourceService({
    storage: store,
    startIndex: async () => undefined,
  });
  return { store, router: createApiRouter({ resources, auth: testAuth(userId) }) };
}

describe("frontend resource routes", () => {
  it("routes repositories, indexing, issues and evidence for the signed-in user", async () => {
    const { router } = await buildRouter();
    expect((await router(request("/api/repositories")))?.status).toBe(200);
    expect(
      (await router(request("/api/repositories/repo-1/index", { method: "POST", body: "{}" })))
        ?.status,
    ).toBe(202);
    expect((await router(request("/api/repositories/repo-1/index-status")))?.status).toBe(200);
    expect((await router(request("/api/repositories/repo-1/issues")))?.status).toBe(200);
    expect((await router(request("/api/repositories/repo-1/issues/42")))?.status).toBe(200);
    expect(
      (await router(request("/api/investigations/11111111-1111-4111-8111-111111111111/evidence")))
        ?.status,
    ).toBe(200);
  });

  it("reports the session state instead of assuming one", async () => {
    const { router } = await buildRouter();
    const session = await router(request("/api/auth/session"));
    expect(session?.status).toBe(200);
    expect(await session!.json()).toMatchObject({ authenticated: true, configured: true });
    expect((await router(request("/api/auth/logout", { method: "POST" })))?.status).toBe(200);
  });

  it("hides a repository that belongs to another user", async () => {
    const store = createInMemoryRepositoryStore();
    await seed(store, "user-2");
    const resources = createRepositoryResourceService({ storage: store });
    await expect(resources.getRepository("user-1", "repo-1")).rejects.toThrow(
      "Repository was not found.",
    );
  });
});

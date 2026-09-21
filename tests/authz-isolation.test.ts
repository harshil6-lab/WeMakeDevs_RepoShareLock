import { describe, expect, it } from "vitest";
import { createApiRouter } from "../src/api/router";
import { createRepositoryResourceService } from "../src/api/resources";
import { createInvestigationService } from "../src/api/service";
import { createInMemoryRepositoryStore } from "./golden/in-memory-store";
import { anonymousAuth, testAuth } from "./helpers/auth";
import type { RepositoryStore } from "../src/storage/types";

/**
 * Multi-user isolation.
 *
 * Two users exist in the same table: `user-a` owns `repo-a`, `user-b` owns
 * `repo-b`. Every by-id read must resolve ownership from the verified identity,
 * and a browser-supplied `userId` must never widen that boundary.
 */
const request = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const now = "2026-01-01T00:00:00.000Z";
const investigationA = "11111111-1111-4111-8111-111111111111";
const investigationB = "22222222-2222-4222-8222-222222222222";

async function seed(
  store: RepositoryStore,
  userId: string,
  repositoryId: string,
  investigationId: string,
) {
  await store.repositories.create({
    repositoryId,
    userId,
    owner: "acme",
    name: repositoryId,
    defaultBranch: "main",
    indexingStatus: "completed",
    createdAt: now,
    updatedAt: now,
  });
  await store.issues.put({
    repositoryId,
    issueNumber: 7,
    title: "Timeout",
    state: "open",
    updatedAt: now,
  });
  await store.investigations.create({
    investigationId,
    userId,
    repositoryId,
    issueNumber: 7,
    status: "completed",
    createdAt: now,
    updatedAt: now,
    result: { evidence: [{ evidenceId: "file:1", excerpt: "source" }] },
  });
}

async function build() {
  const store = createInMemoryRepositoryStore();
  await seed(store, "user-a", "repo-a", investigationA);
  await seed(store, "user-b", "repo-b", investigationB);
  const resources = createRepositoryResourceService({
    storage: store,
    startIndex: async () => undefined,
  });
  const service = createInvestigationService(
    { enqueue: async () => undefined },
    { storage: store },
  );
  const routerFor = (userId?: string) =>
    createApiRouter({
      resources,
      service,
      storage: store,
      auth: userId ? testAuth(userId) : anonymousAuth(),
    });
  return { store, routerFor };
}

describe("multi-user isolation", () => {
  it("lists only the signed-in user's repositories", async () => {
    const { routerFor } = await build();
    const response = await routerFor("user-a")(request("/api/repositories"));
    const body = (await response!.json()) as { items: { repositoryId: string }[] };
    expect(body.items.map((item) => item.repositoryId)).toEqual(["repo-a"]);
  });

  it("does not serve another user's repository, index status or issues", async () => {
    const { routerFor } = await build();
    const router = routerFor("user-a");
    for (const path of [
      "/api/repositories/repo-b",
      "/api/repositories/repo-b/index-status",
      "/api/repositories/repo-b/issues",
      "/api/repositories/repo-b/issues/7",
    ]) {
      const response = await router(request(path));
      expect(response?.status, path).toBe(404);
    }
    const index = await router(
      request("/api/repositories/repo-b/index", { method: "POST", body: "{}" }),
    );
    expect(index?.status).toBe(404);
  });

  it("does not serve another user's investigation or evidence", async () => {
    const { routerFor } = await build();
    const router = routerFor("user-a");
    for (const path of [
      `/api/investigations/${investigationB}`,
      `/api/investigations/${investigationB}/status`,
      `/api/investigations/${investigationB}/evidence`,
    ]) {
      const response = await router(request(path));
      expect(response?.status, path).toBe(404);
    }
  });

  it("still serves the user's own resources", async () => {
    const { routerFor } = await build();
    const router = routerFor("user-a");
    expect((await router(request("/api/repositories/repo-a")))?.status).toBe(200);
    expect((await router(request(`/api/investigations/${investigationA}`)))?.status).toBe(200);
    expect((await router(request(`/api/investigations/${investigationA}/evidence`)))?.status).toBe(
      200,
    );
  });

  it("ignores a browser-supplied userId in the query string or body", async () => {
    const { routerFor } = await build();
    const router = routerFor("user-a");
    expect((await router(request("/api/repositories?userId=user-b")))?.status).toBe(200);
    const spoofed = await router(request(`/api/repositories/repo-b?userId=user-b`));
    expect(spoofed?.status).toBe(404);

    const impersonated = await router(
      request("/api/investigations", {
        method: "POST",
        body: JSON.stringify({ repositoryId: "repo-b", issueNumber: 7, userId: "user-b" }),
      }),
    );
    expect(impersonated?.status).toBe(400); // the strict request schema rejects the extra field

    const ownRepository = await router(
      request("/api/investigations", {
        method: "POST",
        body: JSON.stringify({ repositoryId: "repo-a", issueNumber: 7 }),
      }),
    );
    expect(ownRepository?.status).toBe(202);
    const created = (await ownRepository!.json()) as { investigationId: string };
    expect((await router(request(`/api/investigations/${created.investigationId}`)))?.status).toBe(
      200,
    );
    // The record belongs to the verified user, not to the caller-supplied field.
    expect(
      (await routerFor("user-b")(request(`/api/investigations/${created.investigationId}`)))
        ?.status,
    ).toBe(404);
  });

  it("refuses every protected route without a verified identity", async () => {
    const { routerFor } = await build();
    const router = routerFor();
    for (const path of [
      "/api/repositories",
      "/api/repositories/repo-a",
      "/api/repositories/repo-a/issues",
      `/api/investigations/${investigationA}`,
      `/api/investigations/${investigationA}/evidence`,
    ]) {
      const response = await router(request(path));
      expect(response?.status, path).toBe(401);
      expect((await response!.json()).error.code, path).toBe("UNAUTHORIZED");
    }
    const queued = await router(
      request("/api/investigations", {
        method: "POST",
        body: JSON.stringify({ repositoryId: "repo-a", issueNumber: 7 }),
      }),
    );
    expect(queued?.status).toBe(401);
  });
});

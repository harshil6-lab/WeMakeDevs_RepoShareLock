import { describe, expect, it } from "vitest";
import { createApiRouter } from "../src/api/router";
import { createInvestigationService } from "../src/api/service";
import { testAuth } from "./helpers/auth";

const request = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);

describe("RepoSherlock API", () => {
  it("validates investigation input", async () => {
    const response = await createApiRouter({ auth: testAuth() })(
      request("/api/investigations", {
        method: "POST",
        body: JSON.stringify({ repositoryId: "", issueNumber: 0 }),
      }),
    );
    expect(response?.status).toBe(400);
    expect(response).toBeDefined();
    expect((await response!.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("routes health and unknown paths", async () => {
    expect((await createApiRouter()(request("/api/health")))?.status).toBe(200);
    expect((await createApiRouter()(request("/api/missing")))?.status).toBe(404);
  });

  it("creates a queued investigation and triggers the worker", async () => {
    let triggered = false;
    const service = createInvestigationService({
      enqueue: () => {
        triggered = true;
      },
    });
    const router = createApiRouter({ service, auth: testAuth() });
    const response = await router(
      request("/api/investigations", {
        method: "POST",
        body: JSON.stringify({ repositoryId: "repo-1", issueNumber: 42 }),
      }),
    );
    expect(response).toBeDefined();
    const body = await response!.json();
    expect(response?.status).toBe(202);
    expect(body.status).toBe("queued");
    expect(triggered).toBe(true);
    const status = await router(request(`/api/investigations/${body.investigationId}`));
    expect(status).toBeDefined();
    expect((await status!.json()).status).toBe("queued");
  });

  it("exposes lifecycle status separately from the result read", async () => {
    const router = createApiRouter({ auth: testAuth() });
    const response = await router(
      request("/api/investigations", {
        method: "POST",
        body: JSON.stringify({ repositoryId: "repo-1", issueNumber: 42 }),
      }),
    );
    expect(response).toBeDefined();
    const body = await response!.json();
    const status = await router(request(`/api/investigations/${body.investigationId}/status`));
    expect(status).toBeDefined();
    expect(await status!.json()).toMatchObject({
      investigationId: body.investigationId,
      status: "queued",
      progress: 0,
    });
  });

  it("returns a stable not-found error", async () => {
    const response = await createApiRouter({ auth: testAuth() })(
      request("/api/investigations/00000000-0000-0000-0000-000000000000"),
    );
    expect(response?.status).toBe(404);
    expect(response).toBeDefined();
    expect((await response!.json()).error.code).toBe("INVESTIGATION_NOT_FOUND");
  });
});

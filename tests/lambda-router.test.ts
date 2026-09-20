import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asyncEventMarker } from "../src/api/composition";
import { createLambdaHandler } from "../src/aws/lambda-handler";

type Event = Record<string, unknown>;

type ProxyResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
};

/**
 * Minimal API Gateway HTTP API event. The deployed integration uses payload
 * format 1.0, so the v1-style `path`/`httpMethod` fields are the ones the
 * Lambda handler reads; `rawPath` covers the v2 shape.
 */
function apiEvent(overrides: Event = {}): Event {
  return {
    version: "2.0",
    rawPath: "/",
    rawQueryString: "",
    headers: { host: "api.example.com" },
    requestContext: { http: { method: "GET", path: "/" }, domainName: "api.example.com" },
    ...overrides,
  };
}

/** Stands in for the packaged Nitro SSR server so routing can be asserted. */
function fakeSsr() {
  const events: unknown[] = [];
  const response: ProxyResponse = {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: "<!doctype html><title>RepoSherlock</title>",
  };
  const load = async () => ({
    handler: async (nextEvent: unknown) => {
      events.push(nextEvent);
      return response;
    },
  });
  return { events, response, load };
}

const compositionKeys = [
  "REPOSHERLOCK_TABLE_NAME",
  "REPOSHERLOCK_BUCKET_NAME",
  "REPOSHERLOCK_GITHUB_TOKEN",
  "REPOSHERLOCK_BEDROCK_MODEL_ID",
  "REPOSHERLOCK_BEDROCK_ROLE_ARN",
  "REPOSHERLOCK_USER_ID",
  "REPOSHERLOCK_ASYNC_FUNCTION_NAME",
  "AWS_LAMBDA_FUNCTION_NAME",
];

/** Keeps the API-router branch deterministic regardless of the host env. */
function clearCompositionEnv() {
  for (const key of compositionKeys) delete process.env[key];
}

function configureApi() {
  process.env["REPOSHERLOCK_TABLE_NAME"] = "reposherlock-table";
  process.env["REPOSHERLOCK_BUCKET_NAME"] = "reposherlock-bucket";
  process.env["REPOSHERLOCK_GITHUB_TOKEN"] = "ghp_test_token";
  process.env["REPOSHERLOCK_BEDROCK_MODEL_ID"] = "test.model-v1";
}

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  saved.clear();
  for (const key of compositionKeys) saved.set(key, process.env[key]);
  clearCompositionEnv();
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Lambda HTTP routing", () => {
  it("routes /api/* to the API router and never to Nitro", async () => {
    configureApi();
    const ssr = fakeSsr();
    const handler = createLambdaHandler(ssr.load);
    const response = (await handler(
      apiEvent({
        rawPath: "/api/health",
        requestContext: { http: { method: "GET", path: "/api/health" } },
      }),
      {},
    )) as ProxyResponse;
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: "ok" });
    expect(ssr.events).toHaveLength(0);
  });

  it("treats /api as an API path rather than a browser route", async () => {
    configureApi();
    const ssr = fakeSsr();
    const handler = createLambdaHandler(ssr.load);
    const response = (await handler(
      apiEvent({ rawPath: "/api", path: "/api" }),
      {},
    )) as ProxyResponse;
    expect(ssr.events).toHaveLength(0);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: "Not found" });
  });

  it("renders the frontend without requiring API configuration", async () => {
    const ssr = fakeSsr();
    const handler = createLambdaHandler(ssr.load);
    const response = await handler(apiEvent({ rawPath: "/", path: "/" }), {});
    expect(response).toBe(ssr.response);
    expect(ssr.events).toHaveLength(1);
  });

  it("routes browser routes to the Nitro SSR handler", async () => {
    for (const path of ["/", "/login", "/dashboard", "/repositories", "/investigations/abc"]) {
      const ssr = fakeSsr();
      const handler = createLambdaHandler(ssr.load);
      const response = (await handler(apiEvent({ rawPath: path, path }), {})) as ProxyResponse;
      expect(ssr.events, path).toHaveLength(1);
      expect(response.statusCode, path).toBe(200);
      expect(response.body, path).toContain("<!doctype html>");
    }
  });

  it("passes the original API Gateway event through to Nitro", async () => {
    const ssr = fakeSsr();
    const handler = createLambdaHandler(ssr.load);
    const incoming = apiEvent({
      rawPath: "/dashboard",
      path: "/dashboard",
      rawQueryString: "tab=1",
    });
    await handler(incoming, { functionName: "reposherlock-dev" });
    expect(ssr.events[0]).toEqual(incoming);
  });

  it("gives Nitro a headers map when a hand-built event omits one", async () => {
    const ssr = fakeSsr();
    const handler = createLambdaHandler(ssr.load);
    // Nitro reads `event.headers.host` directly; a manual invoke without a
    // headers map used to throw before rendering (see lambda-response.json).
    const incoming = { path: "/", httpMethod: "GET" };
    await handler(incoming, {});
    expect(ssr.events[0]).toEqual({ ...incoming, headers: {} });
  });

  it("keeps asynchronous self-invocations on the existing async path", async () => {
    const ssr = fakeSsr();
    const handler = createLambdaHandler(ssr.load);
    await expect(
      handler({ marker: asyncEventMarker, kind: "investigation", investigationId: "inv-1" }, {}),
    ).rejects.toThrow("RepoSherlock is not configured for asynchronous work");
    expect(ssr.events).toHaveLength(0);
  });
});

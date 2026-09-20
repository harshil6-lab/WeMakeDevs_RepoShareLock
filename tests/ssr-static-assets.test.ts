import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static assets in the AWS package.
 *
 * Nitro's `aws-lambda` preset registers no static handler, so the client assets
 * it builds into `.output-aws/public` are only served when the build inlines
 * them into the server bundle. Without that, the SSR document renders but every
 * `/assets/*` request falls through to the renderer and the page is unstyled.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lambdaBundle = resolve(root, "dist-lambda", "index.mjs");
const hasLambdaBundle = existsSync(lambdaBundle);

type ProxyResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
};

type LambdaHandler = (event: unknown, context: unknown) => Promise<ProxyResponse>;

/** API Gateway payload format 1.0 event for a GET, as API Gateway sends it. */
function eventFor(path: string): Record<string, unknown> {
  return {
    version: "1.0",
    path,
    httpMethod: "GET",
    headers: { host: "reposherlock.local" },
    requestContext: { httpMethod: "GET", path },
    isBase64Encoded: false,
  };
}

async function loadLambdaHandler(): Promise<LambdaHandler> {
  const module = (await import(pathToFileURL(lambdaBundle).href)) as { handler: LambdaHandler };
  return module.handler;
}

describe("AWS Nitro build config", () => {
  it("inlines the public assets so the Lambda serves them without a CDN", () => {
    const config = readFileSync(resolve(root, "vite.config.aws.ts"), "utf8");
    expect(config).toMatch(/serveStatic:\s*["']inline["']/);
  });
});

// The bundle is produced by `npm run build:aws`; the checks are skipped in a
// checkout that has not built the AWS package rather than failing on a stale or
// missing artifact.
describe.skipIf(!hasLambdaBundle)("packaged Lambda static assets", () => {
  it("serves the CSS and JS the SSR document references", async () => {
    const handler = await loadLambdaHandler();

    const document = await handler(eventFor("/"), {});
    expect(document.statusCode).toBe(200);
    expect(document.headers["content-type"]).toContain("text/html");

    const refs = [...document.body.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map(
      (match) => match[1],
    );
    const cssRefs = refs.filter((ref) => ref.endsWith(".css"));
    const jsRefs = refs.filter((ref) => ref.endsWith(".js"));
    expect(cssRefs, "SSR document references a CSS asset").not.toHaveLength(0);
    expect(jsRefs, "SSR document references a JS asset").not.toHaveLength(0);

    for (const asset of [...cssRefs, ...jsRefs, "/favicon.ico"]) {
      const response = await handler(eventFor(asset), {});
      expect(response.statusCode, asset).toBe(200);
      const contentType = response.headers["content-type"] ?? "";
      if (asset.endsWith(".css")) expect(contentType, asset).toContain("text/css");
      else if (asset.endsWith(".js")) expect(contentType, asset).toContain("javascript");
    }
  });

  it("keeps /api/* off the SSR renderer", async () => {
    const handler = await loadLambdaHandler();
    const response = await handler(eventFor("/api/health"), {});
    // The API router answers JSON (503 here because the test process has no
    // composition env); the SSR renderer would have answered an HTML document.
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("still renders an HTML document for an unknown browser route", async () => {
    const handler = await loadLambdaHandler();
    const response = await handler(eventFor("/not-a-route"), {});
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("<!DOCTYPE html>");
  });
});

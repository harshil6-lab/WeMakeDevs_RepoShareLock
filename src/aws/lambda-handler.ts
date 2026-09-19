import {
  asyncEventMarker,
  createCompositionRuntime,
  createConfiguredApiRouter,
  readCompositionEnv,
} from "../api/composition";

/**
 * AWS Lambda entry point.
 *
 * Two kinds of invocation reach this handler:
 *
 * - HTTP events from API Gateway, which are converted to a Fetch `Request`,
 *   handled by the existing RepoSherlock API router (`createConfiguredApiRouter`)
 *   and converted back to an API Gateway response:
 *
 *     API Gateway HTTP event -> Fetch Request -> ApiRequestHandler -> Fetch Response
 *
 * - Asynchronous self-invocations from `createLambdaDispatcher`, which carry the
 *   `asyncEventMarker`. Those run the already-composed worker or ingestion
 *   runtime so Lambda cannot freeze the work before it completes.
 *
 * These conversions are transport glue only: they do not add a router, a
 * service, or any new API behavior. The API router still owns `/api/*`.
 */

type AsyncInvocation = {
  marker?: string;
  kind?: string;
  investigationId?: string;
  repositoryId?: string;
  userId?: string;
};

/**
 * API Gateway event. The HTTP API v2.0 payload (`rawPath`, `rawQueryString`,
 * `requestContext.http`, `cookies`) is supported, and the v1.0 shape
 * (`path`, `httpMethod`, `queryStringParameters`) is accepted as a fallback so
 * the current integration keeps working without an infrastructure change.
 */
type ApiGatewayEvent = {
  version?: string;
  rawPath?: string;
  rawQueryString?: string;
  path?: string;
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  multiValueHeaders?: Record<string, string[] | undefined>;
  cookies?: string[];
  queryStringParameters?: Record<string, string | undefined>;
  multiValueQueryStringParameters?: Record<string, string[] | undefined>;
  requestContext?: {
    http?: { method?: string; path?: string };
    httpMethod?: string;
    path?: string;
  };
  body?: string | null;
  isBase64Encoded?: boolean;
};

type LambdaEvent = AsyncInvocation & ApiGatewayEvent;

/** API Gateway proxy response. */
type ApiGatewayResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
};

/** Content types that can be returned as UTF-8 text rather than base64. */
const textContentTypePattern =
  /^(?:text\/|application\/(?:json|xml|javascript|x-www-form-urlencoded)|[\w.+-]+\/[\w.+-]*\+(?:json|xml))/i;

const fallbackHost = "reposherlock.local";

function resolveMethod(event: ApiGatewayEvent): string {
  return (
    event.requestContext?.http?.method ??
    event.httpMethod ??
    event.requestContext?.httpMethod ??
    "GET"
  ).toUpperCase();
}

function resolvePath(event: ApiGatewayEvent): string {
  return (
    event.rawPath ??
    event.requestContext?.http?.path ??
    event.path ??
    event.requestContext?.path ??
    "/"
  );
}

function resolveQueryString(event: ApiGatewayEvent): string {
  if (event.rawQueryString) return event.rawQueryString;
  const search = new URLSearchParams();
  for (const [key, values] of Object.entries(event.multiValueQueryStringParameters ?? {}))
    for (const value of values ?? []) search.append(key, value);
  for (const [key, value] of Object.entries(event.queryStringParameters ?? {}))
    if (value !== undefined && !search.has(key)) search.append(key, value);
  return search.toString();
}

function resolveHeaders(event: ApiGatewayEvent): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {}))
    if (value !== undefined) headers.set(key, value);
  // HTTP API v2 carries cookies separately from the headers map.
  for (const cookie of event.cookies ?? []) headers.append("cookie", cookie);
  return headers;
}

function resolveRequestUrl(event: ApiGatewayEvent): string {
  const host = event.headers?.["host"] ?? event.headers?.["Host"] ?? fallbackHost;
  const query = resolveQueryString(event);
  const path = resolvePath(event);
  return `https://${host}${path}${query ? `?${query}` : ""}`;
}

function decodeBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

function isBinaryContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return !textContentTypePattern.test(contentType.trim());
}

/** Converts an API Gateway event into a Fetch request for the API router. */
function toFetchRequest(event: ApiGatewayEvent): Request {
  const method = resolveMethod(event);
  const init: RequestInit = { method, headers: resolveHeaders(event) };
  if (event.body !== undefined && event.body !== null && method !== "GET" && method !== "HEAD")
    init.body = event.isBase64Encoded ? decodeBase64ToBytes(event.body) : event.body;
  return new Request(resolveRequestUrl(event), init);
}

/** Converts a Fetch response into an API Gateway proxy response. */
async function toApiGatewayResponse(response: Response): Promise<ApiGatewayResponse> {
  const headers: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) headers[key] = value;
  if (response.status === 204 || response.status === 304)
    return { statusCode: response.status, headers, body: "", isBase64Encoded: false };
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (isBinaryContentType(response.headers.get("content-type")))
    return {
      statusCode: response.status,
      headers,
      body: encodeBytesToBase64(bytes),
      isBase64Encoded: true,
    };
  return {
    statusCode: response.status,
    headers,
    body: new TextDecoder().decode(bytes),
    isBase64Encoded: false,
  };
}

function jsonResponse(statusCode: number, body: unknown): ApiGatewayResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

export async function handler(event: LambdaEvent, context: unknown): Promise<unknown> {
  if (event && event.marker === asyncEventMarker) {
    const runtime = createCompositionRuntime(readCompositionEnv(process.env));
    if (!runtime) throw new Error("RepoSherlock is not configured for asynchronous work");
    if (event.kind === "investigation" && event.investigationId) {
      await runtime.worker.handle({ investigationId: event.investigationId });
    } else if (event.kind === "index" && event.repositoryId) {
      await runtime.runIndex({
        repositoryId: event.repositoryId,
        userId: event.userId ?? runtime.userId,
      });
    } else {
      throw new Error("Unsupported asynchronous event");
    }
    return { statusCode: 200, body: "" };
  }

  // HTTP API requests are handled by the RepoSherlock API router only. Nitro is
  // still built and packaged, but it does not serve API Gateway traffic.
  const router = createConfiguredApiRouter(readCompositionEnv(process.env));
  if (!router) return jsonResponse(503, { error: "RepoSherlock API is not configured" });
  const response = await router(toFetchRequest(event));
  if (!response) return jsonResponse(404, { error: "Not found" });
  return toApiGatewayResponse(response);
}

import { z } from "zod";

const apiBaseUrl =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") ?? "/api";

const repositorySchema = z
  .object({
    repositoryId: z.string().optional(),
    id: z.union([z.string(), z.number()]).optional(),
    owner: z.union([z.string(), z.object({ login: z.string() })]),
    name: z.string(),
    defaultBranch: z.string().optional(),
    language: z.string().optional(),
    indexingStatus: z.string().optional(),
    snapshotVersion: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type ApiRepository = z.infer<typeof repositorySchema>;

const issueSchema = z
  .object({
    issueNumber: z.number().int().optional(),
    number: z.number().int().optional(),
    title: z.string(),
    state: z.string(),
    labels: z.array(z.union([z.string(), z.object({ name: z.string() })])).optional(),
    user: z.object({ login: z.string() }).nullable().optional(),
    updatedAt: z.string().optional(),
    comments: z.number().optional(),
    pull_request: z.unknown().optional(),
  })
  .passthrough();
export type ApiIssue = z.infer<typeof issueSchema>;

const statusSchema = z
  .object({
    investigationId: z.string().uuid(),
    repositoryId: z.string().optional(),
    issueNumber: z.number().int().positive().optional(),
    status: z.enum(["queued", "running", "completed", "failed", "timeout"]),
    currentStage: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),
    updatedAt: z.string(),
    failureCode: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type InvestigationStatus = z.infer<typeof statusSchema>;

const investigationSchema = statusSchema
  .extend({
    result: z.record(z.unknown()).optional(),
    evidence: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type ApiInvestigation = z.infer<typeof investigationSchema>;

export const evidenceSchema = z
  .object({
    evidenceId: z.string(),
    excerpt: z.string(),
    provenance: z.object({ type: z.string(), repositoryId: z.string() }).passthrough(),
  })
  .passthrough();
export type ApiEvidence = z.infer<typeof evidenceSchema>;

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...init.headers },
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ code: z.string(), message: z.string() }) })
        .safeParse(body);
      throw new ApiClientError(
        response.status,
        error.success ? error.data.error.code : "HTTP_ERROR",
        error.success ? error.data.error.message : "The API request failed.",
      );
    }
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ApiClientError || error instanceof z.ZodError) throw error;
    if (error instanceof DOMException && error.name === "AbortError")
      throw new ApiClientError(408, "TIMEOUT", "The request timed out.");
    throw new ApiClientError(0, "NETWORK_ERROR", "The investigation connection was interrupted.");
  } finally {
    window.clearTimeout(timeout);
  }
}

const listSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextToken: z.string().optional() }).or(z.array(item));
const repositoryListSchema = listSchema(repositorySchema);
const issueListSchema = listSchema(issueSchema);
const evidenceListSchema = listSchema(evidenceSchema);
const normalizeList = <T>(value: T[] | { items: T[] }): T[] =>
  Array.isArray(value) ? value : value.items;

export const apiClient = {
  createSession: () =>
    request("/auth/session", z.object({ authenticated: z.boolean() }).passthrough(), {
      method: "POST",
      body: "{}",
    }),
  listRepositories: async () => normalizeList(await request("/repositories", repositoryListSchema)),
  createRepository: (input: { owner: string; name: string }) =>
    request("/repositories", repositorySchema, { method: "POST", body: JSON.stringify(input) }),
  getRepository: (repositoryId: string) =>
    request(`/repositories/${encodeURIComponent(repositoryId)}`, repositorySchema),
  startIndexing: (repositoryId: string) =>
    request(
      `/repositories/${encodeURIComponent(repositoryId)}/index`,
      z.object({ repositoryId: z.string(), status: z.string() }).passthrough(),
      { method: "POST", body: "{}" },
    ),
  getIndexStatus: (repositoryId: string) =>
    request(
      `/repositories/${encodeURIComponent(repositoryId)}/index-status`,
      z
        .object({ repositoryId: z.string(), status: z.string(), progress: z.number().optional() })
        .passthrough(),
    ),
  listIssues: async (repositoryId: string) =>
    normalizeList(
      await request(`/repositories/${encodeURIComponent(repositoryId)}/issues`, issueListSchema),
    ),
  getIssue: (repositoryId: string, issueNumber: number) =>
    request(`/repositories/${encodeURIComponent(repositoryId)}/issues/${issueNumber}`, issueSchema),
  createInvestigation: (repositoryId: string, issueNumber: number) =>
    request(
      "/investigations",
      z.object({ investigationId: z.string().uuid(), status: z.literal("queued") }),
      { method: "POST", body: JSON.stringify({ repositoryId, issueNumber }) },
    ),
  getInvestigationStatus: (investigationId: string) =>
    request(`/investigations/${encodeURIComponent(investigationId)}/status`, statusSchema),
  getInvestigation: (investigationId: string) =>
    request(`/investigations/${encodeURIComponent(investigationId)}`, investigationSchema),
  listEvidence: async (investigationId: string) =>
    normalizeList(
      await request(
        `/investigations/${encodeURIComponent(investigationId)}/evidence`,
        evidenceListSchema,
      ),
    ),
};

export type ApiClient = typeof apiClient;

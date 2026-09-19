export class GitHubError extends Error {
  constructor(
    public readonly code:
      "GITHUB_REQUEST_FAILED" | "GITHUB_RATE_LIMITED" | "GITHUB_INVALID_RESPONSE",
    message: string,
    public readonly status?: number,
    cause?: unknown,
  ) {
    super(message);
    this.name = "GitHubError";
    this.cause = cause;
  }
}

export class IngestionError extends Error {
  constructor(
    public readonly code: "INGESTION_BOUNDED" | "INGESTION_FAILED",
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "IngestionError";
    this.cause = cause;
  }
}

export class StorageError extends Error {
  constructor(
    public readonly code: "STORAGE_READ_FAILED" | "STORAGE_WRITE_FAILED" | "STORAGE_NOT_FOUND",
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
    this.cause = cause;
  }
}

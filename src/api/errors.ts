import { ZodError } from "zod";
import { errorResponseSchema, type ErrorResponse } from "./schemas";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Route not found.") {
    super(404, "NOT_FOUND", message);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Authentication is required.") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class AuthNotConfiguredError extends ApiError {
  constructor(message = "Sign-in is not configured for this deployment yet.") {
    super(503, "AUTH_NOT_CONFIGURED", message);
  }
}
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError)
    return new ApiError(400, "VALIDATION_ERROR", "Request validation failed.");
  return new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

export function errorResponse(error: unknown, requestId: string): Response {
  const apiError = toApiError(error);
  const body: ErrorResponse = errorResponseSchema.parse({
    error: { code: apiError.code, message: apiError.message, requestId },
  });
  return Response.json(body, { status: apiError.status });
}

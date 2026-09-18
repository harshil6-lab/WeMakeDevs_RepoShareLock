import { z } from "zod";

export const investigationStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "timeout",
]);
export type InvestigationStatus = z.infer<typeof investigationStatusSchema>;
export const investigationStageSchema = z.enum([
  "understanding_issue",
  "searching_repository",
  "tracing_code",
  "checking_history",
  "finding_related_issues",
  "forming_hypothesis",
  "verifying_evidence",
  "synthesizing",
  "validating",
  "completed",
]);
export type InvestigationStage = z.infer<typeof investigationStageSchema>;

export const createInvestigationRequestSchema = z
  .object({
    repositoryId: z.string().trim().min(1).max(200),
    issueNumber: z.number().int().positive(),
  })
  .strict();
export type CreateInvestigationRequest = z.infer<typeof createInvestigationRequestSchema>;

export const investigationSchema = z.object({
  investigationId: z.string().uuid(),
  repositoryId: z.string(),
  issueNumber: z.number().int().positive(),
  status: investigationStatusSchema,
  currentStage: investigationStageSchema.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
  result: z.record(z.unknown()).optional(),
  error: z.string().max(1000).optional(),
  failureCode: z.string().max(100).optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type Investigation = z.infer<typeof investigationSchema>;

export const createInvestigationResponseSchema = z.object({
  investigationId: z.string().uuid(),
  status: z.literal("queued"),
});
export type CreateInvestigationResponse = z.infer<typeof createInvestigationResponseSchema>;

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().uuid(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

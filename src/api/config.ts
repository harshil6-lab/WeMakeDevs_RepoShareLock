import { z } from "zod";

const configSchema = z.object({
  serviceName: z.string().min(1),
  apiVersion: z.string().min(1),
  environment: z.string().min(1),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = {}): ApiConfig {
  return configSchema.parse({
    serviceName: env["REPOSHERLOCK_SERVICE_NAME"] ?? "reposherlock-api",
    apiVersion: env["REPOSHERLOCK_API_VERSION"] ?? "v1",
    environment: env["NODE_ENV"] ?? "development",
    logLevel: env["REPOSHERLOCK_LOG_LEVEL"] ?? "info",
  });
}

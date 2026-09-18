import type { ApiConfig } from "./config";

type LogContext = Record<string, unknown>;

export type StructuredLogger = {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
};

export function createLogger(config: ApiConfig): StructuredLogger {
  const write = (level: keyof StructuredLogger, message: string, context: LogContext = {}) => {
    if (level === "debug" && config.logLevel !== "debug") return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: config.serviceName,
      message,
      ...context,
    };
    console[level](JSON.stringify(entry));
  };
  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}

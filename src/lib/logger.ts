import pino from "pino";

/**
 * Structured logger using Pino
 * Provides JSON-formatted logs with levels and context
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  }),
});

/**
 * Create a child logger with additional context
 * @param context - Context to add to all log messages
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Log with request ID context
 * @param requestId - Request ID for tracing
 */
export function loggerWithRequestId(requestId: string) {
  return logger.child({ requestId: requestId.slice(0, 8) });
}

/**
 * Log levels:
 * - trace: Very detailed debugging
 * - debug: Debugging information
 * - info: General information
 * - warn: Warning messages
 * - error: Error messages
 * - fatal: Fatal errors that require immediate attention
 */

export type Logger = typeof logger;

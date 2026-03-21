/**
 * Minimal structured logger. Convex-safe (no process.env, no Node APIs).
 * Replace with your own logger by wrapping this module.
 */
export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  return {
    info(message, data) {
      console.log(prefix, message, data ?? "");
    },
    warn(message, data) {
      console.warn(prefix, message, data ?? "");
    },
    error(message, data) {
      console.error(prefix, message, data ?? "");
    },
  };
}

type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const entry = {
    level,
    message,
    ...(data ? { data } : {}),
    ts: new Date().toISOString(),
  };

  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

type Level = "info" | "warn" | "error" | "debug";

function ts(): string {
  return new Date().toISOString();
}

function out(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const line = {
    time: ts(),
    level,
    msg,
    ...meta,
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  info(msg: string, meta?: Record<string, unknown>): void {
    out("info", msg, meta);
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    out("warn", msg, meta);
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    out("error", msg, meta);
  },
  debug(msg: string, meta?: Record<string, unknown>): void {
    if (process.env.DEBUG_SCOUT === "1") out("debug", msg, meta);
  },
};

/**
 * Time window helpers (UTC).
 */

export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export function hoursSinceUnixUtc(createdUtc: number, nowMs: number = Date.now()): number {
  return (nowMs / 1000 - createdUtc) / 3600;
}

export function isWithinLastHours(createdUtc: number, hours: number, nowMs: number = Date.now()): boolean {
  return hoursSinceUnixUtc(createdUtc, nowMs) <= hours;
}

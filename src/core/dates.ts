export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** A syllabus date with no clock time is planned for this local hour. */
export const DEFAULT_EVENT_HOUR = 9;

const pad = (n: number) => String(n).padStart(2, "0");

export const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Local calendar day key, YYYY-MM-DD. */
export const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const monthKey = (ms: number): string => dayKey(ms).slice(0, 7);

/** Whole local calendar days from `now` to `target`. Negative when past. */
export const daysUntil = (target: number, now: number): number =>
  Math.round((startOfDay(target) - startOfDay(now)) / DAY);

export interface ParsedDate {
  ms: number;
  hasTime: boolean;
}

/**
 * Reads the date forms the server is expected to return: YYYY-MM-DD, a full ISO
 * timestamp, or M/D/YYYY. Returns null for anything else so the student fixes it
 * on the confirmation screen instead of the app guessing.
 */
export function parseItemDate(value: unknown): ParsedDate | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(y, mo - 1, d, DEFAULT_EVENT_HOUR);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return { ms: date.getTime(), hasTime: false };
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(y, mo - 1, d, DEFAULT_EVENT_HOUR);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return { ms: date.getTime(), hasTime: false };
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const ms = Date.parse(s.replace(" ", "T"));
    if (Number.isFinite(ms) && new Date(ms).getFullYear() >= 2000) return { ms, hasTime: true };
  }
  return null;
}

export const formatDay = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

export const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Short countdown label: TODAY, TOMORROW, 6 DAYS, PAST. */
export function countdownLabel(target: number, now: number): string {
  const d = daysUntil(target, now);
  if (d < 0) return "PAST";
  if (d === 0) return "TODAY";
  if (d === 1) return "TOMORROW";
  return `${d} DAYS`;
}

export const FREE_BUILDS = 3;
export const FREE_COURSES = 1;
export const FREE_MOCKS = 1;
export interface Counter { builds: number; courses: number; mocks: number }
export const EMPTY_COUNTER: Counter = { builds: 0, courses: 0, mocks: 0 };
export function readCounter(raw: unknown): Counter {
  const x = raw as Partial<Counter> | null;
  const clean = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  return { builds: clean(x?.builds), courses: clean(x?.courses), mocks: clean(x?.mocks) };
}
export const mergeCounters = (a: Counter, b: Counter): Counter => ({ builds: Math.max(a.builds,b.builds), courses: Math.max(a.courses,b.courses), mocks: Math.max(a.mocks,b.mocks) });
export type Gate = { allowed: true } | { allowed: false; reason: "build" | "course" | "mock" };
export function gate(action: "build"|"course"|"mock", c: Counter, pro: boolean): Gate {
  if (pro) return { allowed: true };
  const blocked = action === "build" ? c.builds >= FREE_BUILDS : action === "course" ? c.courses >= FREE_COURSES : c.mocks >= FREE_MOCKS;
  return blocked ? { allowed: false, reason: action } : { allowed: true };
}

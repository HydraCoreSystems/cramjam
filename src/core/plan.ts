import { DAY, HOUR, daysUntil, dayKey, parseItemDate, startOfDay } from "./dates";
import { SkeletonItem, isDatedKind, isTestKind, weightPlan } from "./syllabus";

export interface CourseLike { id: string; name: string; items: SkeletonItem[] }

/** A dated item with its moment resolved. */
export interface DatedItem {
  courseId: string;
  courseName: string;
  item: SkeletonItem;
  at: number;
  hasTime: boolean;
  daysLeft: number;
}

/** All dated items from every course that have not passed, soonest first. */
export function upcomingItems(courses: CourseLike[], now: number): DatedItem[] {
  const out: DatedItem[] = [];
  for (const c of courses) {
    for (const item of c.items) {
      if (!isDatedKind(item.kind) || !item.date) continue;
      const p = parseItemDate(item.date);
      if (!p) continue;
      const daysLeft = daysUntil(p.ms, now);
      if (daysLeft < 0 || (daysLeft === 0 && p.ms < now - 3 * HOUR)) continue;
      out.push({ courseId: c.id, courseName: c.name, item, at: p.ms, hasTime: p.hasTime, daysLeft });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export const upcomingTests = (courses: CourseLike[], now: number) => upcomingItems(courses, now).filter(i => isTestKind(i.item.kind));

/** Weight used when the syllabus gave none. The screen says so. */
export const ASSUMED_WEIGHT = { exam: 20, quiz: 5 } as const;

export interface GradeMath { weight: number; assumed: boolean; per10: number }
export function gradeMath(item: SkeletonItem): GradeMath {
  const assumed = item.weight == null;
  const weight = item.weight ?? (item.kind === "exam" ? ASSUMED_WEIGHT.exam : ASSUMED_WEIGHT.quiz);
  return { weight, assumed, per10: Math.round(weight) / 10 };
}

export interface PlanTarget { id: string; title: string; at: number; weight: number; assumed: boolean }

export function planTargets(courses: CourseLike[], now: number, courseId?: string): PlanTarget[] {
  return upcomingTests(courseId ? courses.filter(c => c.id === courseId) : courses, now).map(t => {
    const g = gradeMath(t.item);
    return { id: t.item.id, title: courseId ? t.item.label : `${t.courseName}: ${t.item.label}`, at: t.at, weight: g.weight, assumed: g.assumed };
  });
}

export interface PlanDay {
  date: string;
  dayMs: number;
  targets: { id: string; title: string; minutes: number; daysLeft: number; weight: number }[];
  topics: string[];
  total: number;
}

export const MAX_PLAN_DAYS = 30;

/**
 * Lays weightPlan out day by day. Each day, every test still ahead shares the daily minutes by
 * weight over days left. Weak topics are rotated in, weakest first.
 */
export function buildDayPlan(targets: PlanTarget[], topicsWeakFirst: string[], now: number, dailyMinutes: number): PlanDay[] {
  if (!targets.length) return [];
  const last = Math.max(...targets.map(t => t.at));
  const days: PlanDay[] = [];
  for (let i = 0; i < MAX_PLAN_DAYS; i++) {
    const dayMs = startOfDay(now) + 12 * HOUR + i * DAY;
    if (startOfDay(dayMs) > startOfDay(last)) break;
    const active = targets.filter(t => daysUntil(t.at, dayMs) >= 1);
    if (!active.length) break;
    const shares = weightPlan(active.map(t => ({ title: t.id, daysLeft: daysUntil(t.at, dayMs), weight: t.weight })));
    const scale = dailyMinutes / 120;
    const rows = shares.map(s => {
      const t = active.find(a => a.id === s.title)!;
      return { id: t.id, title: t.title, minutes: Math.max(5, Math.round((s.minutes * scale) / 5) * 5), daysLeft: s.daysLeft, weight: t.weight };
    });
    const topics = topicsWeakFirst.length
      ? Array.from({ length: Math.min(3, topicsWeakFirst.length) }, (_, k) => topicsWeakFirst[(i * 2 + k) % topicsWeakFirst.length])
      : [];
    days.push({ date: dayKey(dayMs), dayMs, targets: rows, topics: [...new Set(topics)], total: rows.reduce((n, r) => n + r.minutes, 0) });
  }
  return days;
}

// Finals Mode -----------------------------------------------------------------

export const FINALS_WINDOW = 72 * HOUR;

/** The test, if any, that begins inside the next 72 hours. */
export function finalsTarget(courses: CourseLike[], now: number): DatedItem | null {
  const t = upcomingTests(courses, now).find(x => x.at > now - HOUR && x.at - now <= FINALS_WINDOW);
  return t ?? null;
}

export type BlockActivity = "drill" | "cards" | "mistakes" | "facts" | "rest" | "sleep";
export interface FinalsBlock { startsAt: number; endsAt: number; activity: BlockActivity; label: string; topic?: string }

const SLEEP_FROM = 23;
const SLEEP_TO = 7;
const ROTATION: BlockActivity[] = ["drill", "cards", "mistakes", "cards", "facts"];
const LABEL: Record<BlockActivity, string> = {
  drill: "Weak spot drill",
  cards: "Flashcard review",
  mistakes: "Mistake Book retest",
  facts: "Facts and formulas sheet",
  rest: "Break and food",
  sleep: "Sleep",
};

/**
 * Hour by hour, review only, from the next whole hour to one hour before the test.
 * Every fourth block is a break, and 23:00 to 07:00 is protected for sleep.
 */
export function finalsBlocks(now: number, examAt: number, topicsWeakFirst: string[]): FinalsBlock[] {
  const out: FinalsBlock[] = [];
  const first = Math.ceil(now / HOUR) * HOUR;
  const stop = examAt - HOUR;
  let study = 0;
  let sinceBreak = 0;
  let sleepStart: number | null = null;
  const flushSleep = (end: number) => {
    if (sleepStart != null) out.push({ startsAt: sleepStart, endsAt: end, activity: "sleep", label: LABEL.sleep });
    sleepStart = null;
  };
  for (let t = first; t < stop; t += HOUR) {
    const h = new Date(t).getHours();
    const asleep = h >= SLEEP_FROM || h < SLEEP_TO;
    if (asleep) { sleepStart ??= t; continue; }
    flushSleep(t);
    if (sinceBreak >= 3) {
      out.push({ startsAt: t, endsAt: t + HOUR, activity: "rest", label: LABEL.rest });
      sinceBreak = 0;
      continue;
    }
    const activity = ROTATION[study % ROTATION.length];
    const topic = activity === "drill" || activity === "cards" ? topicsWeakFirst[study % Math.max(1, topicsWeakFirst.length)] : undefined;
    out.push({ startsAt: t, endsAt: t + HOUR, activity, label: LABEL[activity], topic });
    study++;
    sinceBreak++;
  }
  flushSleep(stop);
  return out;
}

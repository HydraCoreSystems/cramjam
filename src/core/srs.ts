import { DAY, HOUR, MINUTE, dayKey, startOfDay } from "./dates";

/**
 * Spaced repetition on the FSRS pattern: each card carries stability and difficulty, recall
 * probability decays as a power curve, and the next interval is solved for a target retention.
 * This is the FSRS-5 memory model with its published default weights. Intervals are whole days
 * for passed reviews and a 10 minute requeue for a lapse.
 */
export type Rating = 1 | 2 | 3 | 4; // again, hard, good, easy
export const RATING_LABEL: Record<Rating, string> = { 1: "AGAIN", 2: "HARD", 3: "GOOD", 4: "EASY" };

export interface SrsCard {
  id: string;
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  last: number | null;
  first: number;
  state: "learning" | "review" | "relearning";
}

const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;
export const TARGET_RETENTION = 0.9;
const MAX_INTERVAL_DAYS = 365;
const LAPSE_REQUEUE = 10 * MINUTE;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const d0 = (g: number) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);

export const retrievability = (elapsedDays: number, stability: number): number =>
  Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / Math.max(0.01, stability), DECAY);

const intervalDays = (stability: number, retention = TARGET_RETENTION): number =>
  (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);

function nextDifficulty(d: number, g: Rating): number {
  const delta = -W[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clamp(W[7] * d0(4) + (1 - W[7]) * damped, 1, 10);
}

function nextStability(c: SrsCard, g: Rating, r: number, elapsedDays: number): number {
  const s = c.stability;
  if (elapsedDays < 1) return Math.max(0.01, s * Math.exp(W[17] * (g - 3 + W[18])));
  if (g === 1) {
    const forget = W[11] * Math.pow(c.difficulty, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]);
    return Math.max(0.01, Math.min(s, forget));
  }
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - c.difficulty) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hard * easy);
}

export interface ReviewOptions {
  /** Do not schedule past this moment (the exam), unless that is nearly now. */
  capAt?: number | null;
}

function schedule(stability: number, g: Rating, now: number, opts?: ReviewOptions): number {
  if (g === 1) return now + LAPSE_REQUEUE;
  let due = now + clamp(Math.round(intervalDays(stability)), 1, MAX_INTERVAL_DAYS) * DAY;
  if (opts?.capAt && opts.capAt > now && due > opts.capAt) due = Math.max(opts.capAt - DAY, now + 6 * 3_600_000);
  return due;
}

/** A card not yet seen. The first rating creates its schedule. */
export function reviewNew(id: string, g: Rating, now: number, opts?: ReviewOptions): SrsCard {
  const stability = W[g - 1];
  return {
    id,
    stability,
    difficulty: d0(g),
    reps: 1,
    lapses: g === 1 ? 1 : 0,
    last: now,
    first: now,
    state: g === 1 ? "learning" : "review",
    due: schedule(stability, g, now, opts),
  };
}

/** Advances a card by one rating. Pure: returns the next card, never mutates. */
export function reviewCard(c: SrsCard, g: Rating, now: number, opts?: ReviewOptions): SrsCard {
  const elapsed = c.last == null ? 0 : Math.max(0, (now - c.last) / DAY);
  const r = retrievability(elapsed, c.stability);
  const stability = nextStability(c, g, r, elapsed);
  return {
    ...c,
    stability,
    difficulty: nextDifficulty(c.difficulty, g),
    reps: c.reps + 1,
    lapses: c.lapses + (g === 1 ? 1 : 0),
    last: now,
    state: g === 1 ? "relearning" : "review",
    due: schedule(stability, g, now, opts),
  };
}

export const isDue = (c: SrsCard, now: number) => c.due <= now;

/** Label for a rating button, such as "10m" or "4d", computed without changing the card. */
export function previewInterval(c: SrsCard | null, id: string, g: Rating, now: number): string {
  const next = c ? reviewCard(c, g, now) : reviewNew(id, g, now);
  const mins = Math.round((next.due - now) / MINUTE);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const days = Math.round((next.due - now) / DAY);
  return days < 1 ? `${Math.round(mins / 60)}h` : `${days}d`;
}

export const NEW_PER_DAY = 20;

export interface QueueItem { id: string; kind: "due" | "new" }

/**
 * Today's review queue for a set of card ids: due cards first (most forgotten first), then new
 * cards up to the daily limit, counting new cards already introduced today.
 */
export function dailyQueue(ids: string[], srs: Record<string, SrsCard>, now: number, newLimit = NEW_PER_DAY): QueueItem[] {
  const today = dayKey(now);
  const due: { id: string; r: number }[] = [];
  const fresh: string[] = [];
  let introducedToday = 0;
  for (const id of ids) {
    const c = srs[id];
    if (!c) { fresh.push(id); continue; }
    if (dayKey(c.first) === today) introducedToday++;
    if (isDue(c, now)) due.push({ id, r: retrievability(c.last == null ? 0 : (now - c.last) / DAY, c.stability) });
  }
  due.sort((a, b) => a.r - b.r);
  const room = Math.max(0, newLimit - introducedToday);
  return [
    ...due.map((d): QueueItem => ({ id: d.id, kind: "due" })),
    ...fresh.slice(0, room).map((id): QueueItem => ({ id, kind: "new" })),
  ];
}

/** Cards the student keeps forgetting: lapsed, or rated hard enough to hold high difficulty. */
export const isShaky = (c: SrsCard) => c.lapses > 0 || c.difficulty >= 8;

// Streak ---------------------------------------------------------------

/** Cards reviewed plus questions answered a day needs to count as a completed day. */
export const DAILY_GOAL = 5;

export interface StreakInfo { streak: number; todayCount: number; todayDone: boolean }

/** Counts consecutive completed days ending today, or yesterday while today is still open. */
export function streakFrom(activity: Record<string, number>, now: number, goal = DAILY_GOAL): StreakInfo {
  const todayCount = activity[dayKey(now)] ?? 0;
  const todayDone = todayCount >= goal;
  let streak = 0;
  // Anchor at noon so daylight saving shifts can never repeat or skip a calendar day.
  let cursor = startOfDay(now) + 12 * HOUR - (todayDone ? 0 : DAY);
  while ((activity[dayKey(cursor)] ?? 0) >= goal) {
    streak++;
    cursor -= DAY;
  }
  return { streak, todayCount, todayDone };
}

import { DAY, HOUR, parseItemDate } from "./dates";
import { CourseLike } from "./plan";
import { isDatedKind } from "./syllabus";

export const NOTIF_PREFIX = "cj:";
/** iOS keeps at most 64 pending local notifications. Leave room for the two daily ones. */
export const MAX_DATED_NOTIFICATIONS = 56;
const HORIZON = 90 * DAY;

export interface PlannedNotification {
  id: string;
  title: string;
  body: string;
  /** Fire once at this moment. */
  at: number;
}

export interface DailyNotification { id: string; title: string; body: string; hour: number; minute: number }

const at9 = (ms: number) => { const d = new Date(ms); d.setHours(9, 0, 0, 0); return d.getTime(); };
const at8 = (ms: number) => { const d = new Date(ms); d.setHours(8, 0, 0, 0); return d.getTime(); };

/**
 * Local notifications for every dated item that is still ahead. Exams: three days and one day
 * out, plus the morning of. Quizzes and due dates: one day out and the morning of. Never in the past.
 */
export function planDatedNotifications(courses: CourseLike[], now: number): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  for (const c of courses) {
    for (const it of c.items) {
      if (!isDatedKind(it.kind) || !it.date) continue;
      const p = parseItemDate(it.date);
      if (!p || p.ms <= now || p.ms - now > HORIZON) continue;
      const offsets: { days: number; text: string }[] =
        it.kind === "exam"
          ? [{ days: 3, text: "in 3 days" }, { days: 1, text: "tomorrow" }, { days: 0, text: "today" }]
          : [{ days: 1, text: "tomorrow" }, { days: 0, text: "today" }];
      for (const o of offsets) {
        const base = p.ms - o.days * DAY;
        const fireAt = o.days === 0 ? (p.hasTime ? Math.max(now + HOUR, p.ms - 2 * HOUR) : at8(p.ms)) : at9(base);
        if (fireAt <= now + 30_000) continue;
        const noun = it.kind === "exam" ? "exam" : it.kind === "quiz" ? "quiz" : "due date";
        out.push({
          id: `${NOTIF_PREFIX}${c.id}:${it.id}:${o.days}`,
          title: it.kind === "assignment" ? `Due ${o.text}` : `${it.label || noun} ${o.text}`,
          body: it.kind === "exam" || it.kind === "quiz" ? `${c.name}. Your study queue is ready.` : `${c.name}: ${it.label}.`,
          at: fireAt,
        });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_DATED_NOTIFICATIONS);
}

export interface DailySettings { warmupEnabled: boolean; warmupHour: number; hasUpcomingTest: boolean }

export function planDailyNotifications(s: DailySettings): DailyNotification[] {
  const out: DailyNotification[] = [];
  if (s.warmupEnabled) out.push({ id: `${NOTIF_PREFIX}daily:warmup`, title: "Daily five", body: "Five quick questions from your own decks. It takes two minutes.", hour: s.warmupHour, minute: 0 });
  if (s.hasUpcomingTest) out.push({ id: `${NOTIF_PREFIX}daily:plan`, title: "Today's session is ready", body: "Your plan for today is set. Open CramJam to start.", hour: 8, minute: 0 });
  return out;
}

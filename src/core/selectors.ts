import { FullBuild } from "./build";
import { FREE_BUILDS } from "./counter";
import { DAY } from "./dates";
import { PRO_MONTHLY_BUILDS, isPro } from "./entitlement";
import { CourseLike, DatedItem, finalsTarget, upcomingItems, upcomingTests } from "./plan";
import { SrsCard, dailyQueue, isDue, isShaky, streakFrom } from "./srs";
import { Answer, Question, dueRetests, latestAnswers, openMistakes, readiness, weakTopics } from "./study";
import type { AppState } from "./store";

export const buildsOf = (s: AppState, courseId: string | null | "all"): FullBuild[] =>
  Object.values(s.builds).filter(b => courseId === "all" || b.courseId === courseId).sort((a, b) => b.createdAt - a.createdAt);

export const bankOf = (s: AppState, courseId: string | null | "all"): Question[] => buildsOf(s, courseId).flatMap(b => b.questions);
export const cardsOf = (s: AppState, courseId: string | null | "all") => buildsOf(s, courseId).flatMap(b => b.cards);

export function answersOf(s: AppState, courseId: string | null | "all"): Answer[] {
  const ids = new Set(bankOf(s, courseId).map(q => q.id));
  return s.answers.filter(a => ids.has(a.questionId));
}

/** 0 to 100, or null while no question for the course has been answered. Moved only by answers. */
export function courseReadiness(s: AppState, courseId: string | null | "all"): number | null {
  const a = latestAnswers(answersOf(s, courseId));
  return a.length ? readiness(a) : null;
}

export function weakFor(s: AppState, courseId: string | null | "all"): string[] {
  const bank = bankOf(s, courseId);
  const shaky = new Set<string>();
  const cards = cardsOf(s, courseId);
  for (const c of cards) { const st = s.srs[c.id]; if (st && isShaky(st)) shaky.add(c.topic); }
  return weakTopics(answersOf(s, courseId), s.mistakes, bank, [...shaky]);
}

export interface DueInfo { dueCards: number; newCards: number; openMistakes: number; retestsDue: number; shakyCards: number }

export function dueInfo(s: AppState, courseId: string | null | "all", now: number): DueInfo {
  const cards = cardsOf(s, courseId);
  const q = dailyQueue(cards.map(c => c.id), s.srs, now);
  const ids = new Set(bankOf(s, courseId).map(x => x.id));
  const mine = s.mistakes.filter(m => ids.has(m.questionId));
  return {
    dueCards: q.filter(x => x.kind === "due").length,
    newCards: q.filter(x => x.kind === "new").length,
    openMistakes: openMistakes(mine).length,
    retestsDue: dueRetests(mine, now).length,
    shakyCards: cards.filter(c => { const st = s.srs[c.id]; return st && isShaky(st); }).length,
  };
}

export const streakOf = (s: AppState, now: number) => streakFrom(s.activity, now);

export const coursesLike = (s: AppState): CourseLike[] => s.courses;

export interface AllowanceView { text: string; low: boolean; pro: boolean; boosts: number }

/** One line for the student. Free shows the free count; Pro shows nothing numeric until it is nearly used up. */
export function allowanceView(s: AppState, now: number): AllowanceView {
  const pro = isPro(s.entitlement, now);
  const boosts = s.entitlement.boosts;
  const extra = boosts > 0 ? ` + ${boosts} Boost build${boosts === 1 ? "" : "s"}` : "";
  if (pro) {
    const left = Math.max(0, PRO_MONTHLY_BUILDS - s.proUsage.used);
    const low = left <= 5;
    return { pro, boosts, low, text: low ? `CramJam Pro. ${left} base build${left === 1 ? "" : "s"} left this month${extra}` : `CramJam Pro${extra}` };
  }
  const left = Math.max(0, FREE_BUILDS - s.counter.builds);
  return { pro, boosts, low: left + boosts === 0, text: `${left} of ${FREE_BUILDS} free Study Builds left${extra}` };
}

export type HomeModel =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "finals"; target: DatedItem }
  | { kind: "normal"; next: DatedItem | null; upcoming: DatedItem[] };

export function homeModel(s: AppState, now: number): HomeModel {
  if (!s.ready) return { kind: "loading" };
  if (!s.courses.length && !Object.keys(s.builds).length) return { kind: "empty" };
  const f = finalsTarget(s.courses, now);
  if (f) return { kind: "finals", target: f };
  const tests = upcomingTests(s.courses, now);
  return { kind: "normal", next: tests[0] ?? null, upcoming: upcomingItems(s.courses, now).filter(i => i.at - now < 60 * DAY).slice(0, 8) };
}

export const srsCardsOf = (s: AppState, courseId: string | null | "all"): SrsCard[] => cardsOf(s, courseId).map(c => s.srs[c.id]).filter((x): x is SrsCard => !!x);
export const dueNow = (cards: SrsCard[], now: number) => cards.filter(c => isDue(c, now)).length;

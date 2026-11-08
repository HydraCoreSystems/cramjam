import { DAY } from "./dates";

export type QuestionKind = "mcq" | "tf" | "short" | "fill" | "match";

/** Points at the exact place in the student's own material an answer comes from. */
export interface SourcePointer { label: string; quote?: string; start?: number; end?: number }

export interface Question {
  id: string;
  topic: string;
  prompt: string;
  answer: string;
  kind?: QuestionKind;
  options?: string[];
  pairs?: { left: string; right: string }[];
  reason?: string;
  source?: SourcePointer;
  difficulty?: 1 | 2 | 3;
}

export interface Answer {
  questionId: string;
  topic: string;
  correct: boolean;
  confidence: "sure" | "guessing";
  at: number;
  mode?: "drill" | "mock" | "warmup" | "retest" | "practice";
}

export interface StudyBuild { fingerprint: string; summary: string; questions: Question[] }

export const fingerprint = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

export function buildCached<T extends StudyBuild>(text: string, cache: Map<string, T>, generate: (clean: string) => T): { build: T; spent: boolean } {
  const key = fingerprint(text);
  const hit = cache.get(key);
  if (hit) return { build: hit, spent: false };
  const made = generate(key);
  cache.set(key, made);
  return { build: made, spent: true };
}

/** Async twin for network generation. A hit returns instantly and spends nothing. */
export async function buildCachedAsync<T extends StudyBuild>(
  text: string,
  cache: Map<string, T>,
  generate: (clean: string) => Promise<T>,
): Promise<{ build: T; spent: boolean }> {
  const key = fingerprint(text);
  const hit = cache.get(key);
  if (hit) return { build: hit, spent: false };
  const made = await generate(key);
  cache.set(key, made);
  return { build: made, spent: true };
}

export const assembleQuestions = (bank: Question[], weak: string[], length: number) =>
  [...bank].sort((a, b) => Number(weak.includes(b.topic)) - Number(weak.includes(a.topic))).slice(0, length);

export function readiness(answers: Answer[]): number {
  if (!answers.length) return 0;
  const score = answers.reduce((n, a) => n + (a.correct ? (a.confidence === "sure" ? 1 : .85) : 0), 0) / answers.length;
  return Math.round(score * 100);
}

export type MistakeReason = "never-saw" | "misread" | "knew-wrong" | "time";
export const MISTAKE_REASONS: { id: MistakeReason; label: string }[] = [
  { id: "never-saw", label: "NEVER SAW IT" },
  { id: "misread", label: "MISREAD IT" },
  { id: "knew-wrong", label: "KNEW IT WRONG" },
  { id: "time", label: "RAN OUT OF TIME" },
];

export interface Mistake {
  questionId: string;
  reason: MistakeReason;
  missedAt: number;
  retestAt: number;
  /** Times the weekly retest was taken and missed again. */
  retests?: number;
  /** Set when a retest was answered correctly. A cleared mistake leaves the drill queue. */
  clearedAt?: number | null;
}

export const RETEST_AFTER = 7 * DAY;
export const recordMistake = (questionId: string, reason: Mistake["reason"], now: number): Mistake => ({ questionId, reason, missedAt: now, retestAt: now + RETEST_AFTER });
export const importSharedDeck = <T>(deck: T): { deck: T; buildsSpent: 0 } => ({ deck, buildsSpent: 0 });

// Mistake Book ---------------------------------------------------------------

/** One entry per question. A repeat miss replaces the old entry and restarts the weekly clock. */
export function addMistake(book: Mistake[], questionId: string, reason: MistakeReason, now: number): Mistake[] {
  const prev = book.find(m => m.questionId === questionId);
  const next: Mistake = { ...recordMistake(questionId, reason, now), retests: prev?.retests ?? 0, clearedAt: null };
  return [...book.filter(m => m.questionId !== questionId), next];
}

export function resolveRetest(book: Mistake[], questionId: string, correct: boolean, now: number): Mistake[] {
  return book.map(m => {
    if (m.questionId !== questionId) return m;
    if (correct) return { ...m, clearedAt: now };
    return { ...m, retests: (m.retests ?? 0) + 1, retestAt: now + RETEST_AFTER, clearedAt: null };
  });
}

export const openMistakes = (book: Mistake[]) => book.filter(m => !m.clearedAt);
export const dueRetests = (book: Mistake[], now: number) => openMistakes(book).filter(m => m.retestAt <= now);

// Answers, topics, calibration ---------------------------------------------

/** The latest answer per question, so an old miss stops weighing once the student gets it right. */
export function latestAnswers(answers: Answer[]): Answer[] {
  const last = new Map<string, Answer>();
  for (const a of answers) last.set(a.questionId, a);
  return [...last.values()];
}

export interface TopicStat { topic: string; answered: number; correct: number; pct: number }

export function topicStats(answers: Answer[]): TopicStat[] {
  const by = new Map<string, { answered: number; correct: number }>();
  for (const a of latestAnswers(answers)) {
    const t = by.get(a.topic) ?? { answered: 0, correct: 0 };
    t.answered++;
    if (a.correct) t.correct++;
    by.set(a.topic, t);
  }
  return [...by.entries()]
    .map(([topic, t]) => ({ topic, ...t, pct: Math.round((t.correct / t.answered) * 100) }))
    .sort((a, b) => a.pct - b.pct || b.answered - a.answered);
}

export const WEAK_BELOW_PCT = 70;

/** Topics with an open mistake, a low score, or cards the student keeps forgetting, weakest first. */
export function weakTopics(answers: Answer[], mistakes: Mistake[], bank: Question[], shakyTopics: string[] = []): string[] {
  const byId = new Map(bank.map(q => [q.id, q]));
  const score = new Map<string, number>();
  const bump = (t: string, n: number) => score.set(t, (score.get(t) ?? 0) + n);
  for (const m of openMistakes(mistakes)) {
    const q = byId.get(m.questionId);
    if (q) bump(q.topic, 3);
  }
  for (const s of topicStats(answers)) if (s.pct < WEAK_BELOW_PCT) bump(s.topic, 2 + (WEAK_BELOW_PCT - s.pct) / 50);
  for (const t of shakyTopics) bump(t, 1);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/**
 * Weak Spot Drill queue, zero AI: every open missed question first, then assembleQuestions fills
 * the rest from the bank with weak topics ahead.
 */
export function drillQueue(bank: Question[], mistakes: Mistake[], weak: string[], length: number): Question[] {
  const open = new Set(openMistakes(mistakes).map(m => m.questionId));
  const missed = bank.filter(q => open.has(q.id));
  const rest = bank.filter(q => !open.has(q.id));
  return [...missed, ...assembleQuestions(rest, weak, length)].slice(0, length);
}

export interface Calibration {
  total: number;
  sure: number;
  sureCorrect: number;
  guessing: number;
  guessingCorrect: number;
  /** Share of answers marked sure. */
  confidencePct: number;
  /** Share of answers that were correct. */
  accuracyPct: number;
  /** Positive: the student believes they know more than the answers prove. */
  gap: number;
}

export function calibration(answers: Answer[]): Calibration {
  const a = latestAnswers(answers);
  const sure = a.filter(x => x.confidence === "sure");
  const guess = a.filter(x => x.confidence === "guessing");
  const sureCorrect = sure.filter(x => x.correct).length;
  const guessingCorrect = guess.filter(x => x.correct).length;
  const total = a.length;
  const accuracyPct = total ? Math.round(((sureCorrect + guessingCorrect) / total) * 100) : 0;
  // Confidence is judged against how often "sure" answers hold up.
  const sureAccuracy = sure.length ? Math.round((sureCorrect / sure.length) * 100) : 0;
  const confidencePct = total ? Math.round((sure.length / total) * 100) : 0;
  return { total, sure: sure.length, sureCorrect, guessing: guess.length, guessingCorrect, confidencePct, accuracyPct, gap: sure.length ? 100 - sureAccuracy : 0 };
}

// Grading local question kinds (no AI) ---------------------------------------

export const normalizeText = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s.%/-]/gu, " ").replace(/\.(?!\d)/g, " ").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();

/**
 * Checks an answer for kinds that have one right string. Returns null for short answer: the app
 * shows the model answer and the student marks it, because matching free text is grading.
 */
export function checkAnswer(q: Question, response: string | { left: string; right: string }[]): boolean | null {
  const kind = q.kind ?? "short";
  if (kind === "short") return null;
  if (kind === "match") {
    if (!Array.isArray(response) || !q.pairs) return false;
    return q.pairs.length === response.length && q.pairs.every(p => response.some(r => r.left === p.left && r.right === p.right));
  }
  if (typeof response !== "string") return false;
  return normalizeText(response) === normalizeText(q.answer);
}

// Mock exam ------------------------------------------------------------------

export type MockDifficulty = "easy" | "mixed" | "hard";
export const MOCK_LENGTHS = [10, 20, 30] as const;
/** Seconds per question under the clock. */
export const SECONDS_PER_QUESTION: Record<MockDifficulty, number> = { easy: 90, mixed: 75, hard: 60 };

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Builds a mock exam from the local bank. Same seed, same exam. No AI call. */
export function assembleMock(bank: Question[], length: number, difficulty: MockDifficulty, seed: number): Question[] {
  const want = difficulty === "easy" ? [1, 2] : difficulty === "hard" ? [3, 2] : [1, 2, 3];
  const rnd = seeded(seed);
  const shuffle = <T,>(xs: T[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const rank = (q: Question) => { const i = want.indexOf(q.difficulty ?? 2); return i < 0 ? want.length : i; };
  const pool = shuffle(bank);
  pool.sort((a, b) => rank(a) - rank(b));
  return shuffle(pool.slice(0, length));
}

export interface MockResult { questionId: string; response: string | { left: string; right: string }[] | null; correct: boolean; confidence: "sure" | "guessing"; timedOut: boolean }
export interface MockReport {
  id: string;
  courseId: string | null;
  at: number;
  total: number;
  correct: number;
  pct: number;
  timeUsedSec: number;
  limitSec: number;
  topics: { topic: string; total: number; correct: number; pct: number }[];
  calibrationGap: number;
  missed: string[];
}

export function gradeMock(id: string, courseId: string | null, at: number, questions: Question[], results: MockResult[], timeUsedSec: number, limitSec: number): MockReport {
  const byQ = new Map(results.map(r => [r.questionId, r]));
  const topics = new Map<string, { total: number; correct: number }>();
  const missed: string[] = [];
  let correct = 0;
  for (const q of questions) {
    const r = byQ.get(q.id);
    const t = topics.get(q.topic) ?? { total: 0, correct: 0 };
    t.total++;
    if (r?.correct) { t.correct++; correct++; } else missed.push(q.id);
    topics.set(q.topic, t);
  }
  const answers: Answer[] = results.filter(r => r.response != null).map(r => ({ questionId: r.questionId, topic: questions.find(q => q.id === r.questionId)?.topic ?? "", correct: r.correct, confidence: r.confidence, at }));
  return {
    id, courseId, at,
    total: questions.length, correct,
    pct: questions.length ? Math.round((correct / questions.length) * 100) : 0,
    timeUsedSec, limitSec,
    topics: [...topics.entries()].map(([topic, t]) => ({ topic, ...t, pct: Math.round((t.correct / t.total) * 100) })).sort((a, b) => a.pct - b.pct),
    calibrationGap: calibration(answers).gap,
    missed,
  };
}

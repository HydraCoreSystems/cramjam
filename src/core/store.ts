import { ApiError, Api, AskMode, describeApiError } from "./api";
import { BuildResponseError, FullBuild, normalizeBuild } from "./build";
import { DeckError, exportDeck, readDeck } from "./deck";
import { Counter, EMPTY_COUNTER, Gate, gate } from "./counter";
import { CounterStore, StringKV } from "./counterStore";
import { dayKey, monthKey } from "./dates";
import { Entitlement, NO_ENTITLEMENT, ActiveSubLike, PurchaseLike, PurchaseOutcome, PRO_MONTHLY_BUILDS, applyActiveSubscriptions, applyPurchase, isPro, spendBoost } from "./entitlement";
import { DailyNotification, PlannedNotification, planDailyNotifications, planDatedNotifications } from "./notifPlan";
import { upcomingTests } from "./plan";
import { MAX_BUILD_CHARS, MAX_SYLLABUS_CHARS, MIN_BUILD_CHARS, capText } from "./limits";
import { chunkText, topChunks } from "./retrieve";
import { Rating, SrsCard, reviewCard, reviewNew } from "./srs";
import {
  Answer, Mistake, MistakeReason, MockDifficulty, MockReport, MockResult, Question, SECONDS_PER_QUESTION,
  addMistake, assembleMock, fingerprint, gradeMock, importSharedDeck, resolveRetest,
} from "./study";
import { SkeletonItem, SyllabusDraft, confirmSkeleton, draftProblems, guessCourseName, mapSyllabusResponse, parseSyllabus, SyllabusResponseError } from "./syllabus";

// Ports: everything the store needs from the outside world, injected so tests run without a phone.

export interface JsonKV {
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface AuthPort {
  supported(): boolean;
  current(): Promise<{ user: string } | null>;
  signIn(): Promise<{ user: string } | null>;
  signOut(): Promise<void>;
}
export interface NotifierPort {
  /** Replaces every CramJam notification with exactly these. Resolves false when permission is denied. */
  sync(dated: PlannedNotification[], daily: DailyNotification[]): Promise<boolean>;
}
export interface Deps {
  kv: JsonKV;
  keychain: StringKV;
  appString: StringKV;
  api: Api;
  sha256: (s: string) => Promise<string>;
  now: () => number;
  newId: () => string;
  auth: AuthPort;
  notifier: NotifierPort;
  /** True only in a development build with the mock flag. Skips the Apple sign in gate. */
  mock: boolean;
}

export interface Course { id: string; name: string; createdAt: number; items: SkeletonItem[] }
export interface Settings { warmupEnabled: boolean; warmupHour: number; dailyMinutes: number }
export interface FocusSession { at: number; minutes: number; goal: string }
export interface MockSession { id: string; courseId: string | null; questionIds: string[]; startedAt: number; limitSec: number; difficulty: MockDifficulty; results: Record<string, MockResult> }

export interface AppState {
  ready: boolean;
  counter: Counter;
  entitlement: Entitlement;
  proUsage: { month: string; used: number };
  user: { id: string } | null;
  courses: Course[];
  builds: Record<string, FullBuild>;
  srs: Record<string, SrsCard>;
  answers: Answer[];
  mistakes: Mistake[];
  activity: Record<string, number>;
  sessions: FocusSession[];
  mock: { active: MockSession | null; reports: MockReport[] };
  settings: Settings;
  /** True while the last attempt to save to this device failed. Shown to the student, retried on the next change. */
  saveFailed: boolean;
}

export const DEFAULT_SETTINGS: Settings = { warmupEnabled: true, warmupHour: 18, dailyMinutes: 60 };

export const initialState = (now: number): AppState => ({
  ready: false,
  counter: EMPTY_COUNTER,
  entitlement: NO_ENTITLEMENT,
  proUsage: { month: monthKey(now), used: 0 },
  user: null,
  courses: [],
  builds: {},
  srs: {},
  answers: [],
  mistakes: [],
  activity: {},
  sessions: [],
  mock: { active: null, reports: [] },
  settings: DEFAULT_SETTINGS,
  saveFailed: false,
});

const K = {
  meta: "cj.v1.meta", courses: "cj.v1.courses", srs: "cj.v1.srs", answers: "cj.v1.answers", mistakes: "cj.v1.mistakes",
  mock: "cj.v1.mock", index: "cj.v1.builds", build: (id: string) => `cj.v1.build.${id}`, src: (id: string) => `cj.v1.src.${id}`,
};
type Slice = "meta" | "courses" | "srs" | "answers" | "mistakes" | "mock" | "builds";

const ANSWER_LOG_CAP = 5000;
const ACTIVITY_KEEP_DAYS = 400;

// Result types ---------------------------------------------------------------

export type PaywallReason = "build" | "course" | "mock" | "pro-exhausted" | "server-limit";
export type BuildGateResult =
  | { allowed: true; source: "free" | "pro" | "boost" }
  | { allowed: false; reason: "build" | "pro-exhausted" };

export type BuildOutcome =
  | { status: "ok"; build: FullBuild; spent: "free" | "pro" | "boost" }
  | { status: "cached"; build: FullBuild }
  | { status: "paywall"; reason: PaywallReason }
  | { status: "needs-signin" }
  | { status: "error"; message: string }
  | { status: "invalid"; message: string }
  | { status: "busy" };

export type SyllabusOutcome =
  | { ok: true; draft: SyllabusDraft; dropped: number; truncated: boolean; buildsSpent: 0 }
  | { ok: false; message: string; draft: SyllabusDraft; buildsSpent: 0 };

export type CourseOutcome =
  | { ok: true; course: Course }
  | { ok: false; reason: "paywall" }
  | { ok: false; reason: "invalid"; problems: string[] };

export type AskOutcome =
  | { status: "ok"; answer: string; pointers: { label: string; quote?: string }[] }
  | { status: "needs-signin" }
  | { status: "paywall"; reason: PaywallReason }
  | { status: "error"; message: string };

export class AppStore {
  private s: AppState;
  private listeners = new Set<() => void>();
  private counter: CounterStore;
  private dirty = new Set<Slice>();
  private dirtyBuilds = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  private building = false;

  constructor(private d: Deps) {
    this.s = initialState(d.now());
    this.counter = new CounterStore(d.keychain, d.appString);
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.s;

  // Loading and saving --------------------------------------------------------

  async init(): Promise<void> {
    const { kv } = this.d;
    const now = this.d.now();
    const [meta, courses, srs, answers, mistakes, mock, index, counter, user] = await Promise.all([
      kv.get<Partial<Pick<AppState, "entitlement" | "proUsage" | "activity" | "sessions" | "settings">>>(K.meta, {}),
      kv.get<Course[]>(K.courses, []),
      kv.get<Record<string, SrsCard>>(K.srs, {}),
      kv.get<Answer[]>(K.answers, []),
      kv.get<Mistake[]>(K.mistakes, []),
      kv.get<AppState["mock"]>(K.mock, { active: null, reports: [] }),
      kv.get<string[]>(K.index, []),
      this.counter.load(),
      this.d.auth.current().catch(() => null),
    ]);
    const loaded = await Promise.all(index.map(id => kv.get<FullBuild | null>(K.build(id), null)));
    const builds: Record<string, FullBuild> = {};
    for (const b of loaded) if (b) builds[b.id] = b;
    const month = monthKey(now);
    const proUsage = meta.proUsage && meta.proUsage.month === month ? meta.proUsage : { month, used: 0 };
    this.s = {
      ...this.s,
      ready: true,
      counter,
      entitlement: { ...NO_ENTITLEMENT, ...meta.entitlement },
      proUsage,
      user: user ? { id: user.user } : null,
      courses, builds, srs, answers, mistakes, mock,
      activity: meta.activity ?? {},
      sessions: meta.sessions ?? [],
      settings: { ...DEFAULT_SETTINGS, ...meta.settings },
    };
    this.emit();
    void this.syncNotifications();
  }

  private emit() { for (const l of this.listeners) l(); }

  private commit(patch: Partial<AppState>, dirty: Slice[], buildIds: string[] = []) {
    this.s = { ...this.s, ...patch };
    dirty.forEach(x => this.dirty.add(x));
    buildIds.forEach(id => this.dirtyBuilds.add(id));
    this.emit();
    this.chain = this.chain.then(() => this.writeDirty()).catch(() => undefined);
  }

  private async writeDirty(): Promise<void> {
    const dirty = [...this.dirty];
    const builds = [...this.dirtyBuilds];
    this.dirty.clear();
    this.dirtyBuilds.clear();
    const s = this.s;
    const { kv } = this.d;
    const jobs: Promise<void>[] = [];
    for (const slice of dirty) {
      if (slice === "meta") jobs.push(kv.set(K.meta, { entitlement: s.entitlement, proUsage: s.proUsage, activity: s.activity, sessions: s.sessions, settings: s.settings }));
      if (slice === "courses") jobs.push(kv.set(K.courses, s.courses));
      if (slice === "srs") jobs.push(kv.set(K.srs, s.srs));
      if (slice === "answers") jobs.push(kv.set(K.answers, s.answers));
      if (slice === "mistakes") jobs.push(kv.set(K.mistakes, s.mistakes));
      if (slice === "mock") jobs.push(kv.set(K.mock, s.mock));
      if (slice === "builds") jobs.push(kv.set(K.index, Object.keys(s.builds)));
    }
    for (const id of builds) {
      const b = s.builds[id];
      jobs.push(b ? kv.set(K.build(id), b) : kv.remove(K.build(id)));
    }
    try {
      await Promise.all(jobs);
      if (this.s.saveFailed) { this.s = { ...this.s, saveFailed: false }; this.emit(); }
    } catch {
      // Keep everything in memory and try again with the next change.
      dirty.forEach(x => this.dirty.add(x));
      builds.forEach(x => this.dirtyBuilds.add(x));
      this.markSaveFailed();
    }
  }

  private markSaveFailed() {
    if (!this.s.saveFailed) { this.s = { ...this.s, saveFailed: true }; this.emit(); }
  }

  /** Resolves when every change so far is on disk. */
  async flush(): Promise<void> { await this.chain; }

  // Allowance and gates -------------------------------------------------------

  isPro(): boolean { return isPro(this.s.entitlement, this.d.now()); }

  /** Where the next Study Build would be paid from, or why it is blocked. */
  buildGate(): BuildGateResult {
    const e = this.s.entitlement;
    const pro = this.isPro();
    if (pro) {
      if (this.s.proUsage.used < PRO_MONTHLY_BUILDS) return { allowed: true, source: "pro" };
    } else if (gate("build", this.s.counter, false).allowed) {
      return { allowed: true, source: "free" };
    }
    if (e.boosts > 0) return { allowed: true, source: "boost" };
    return { allowed: false, reason: pro ? "pro-exhausted" : "build" };
  }
  courseGate(): Gate { return gate("course", this.s.counter, this.isPro()); }
  mockGate(): Gate { return gate("mock", this.s.counter, this.isPro()); }

  // Account -------------------------------------------------------------------

  async signIn(): Promise<boolean> {
    const r = await this.d.auth.signIn().catch(() => null);
    if (!r) return false;
    this.commit({ user: { id: r.user } }, []);
    return true;
  }

  async signOut(): Promise<void> {
    await this.d.auth.signOut().catch(() => undefined);
    this.commit({ user: null }, []);
  }

  private async signedIn(): Promise<boolean> {
    if (this.d.mock) return true;
    if (this.s.user) return true;
    const cur = await this.d.auth.current().catch(() => null);
    if (cur) { this.commit({ user: { id: cur.user } }, []); return true; }
    return false;
  }

  // Syllabus First ------------------------------------------------------------

  /** Reads a syllabus through the server. Never spends a Study Build, on either tier. */
  async parseSyllabusText(text: string): Promise<SyllabusOutcome> {
    const capped = capText(text, MAX_SYLLABUS_CHARS);
    const guess = guessCourseName(capped.text);
    try {
      const raw = await this.d.api.syllabus(capped.text);
      const mapped = mapSyllabusResponse(raw, this.d.newId);
      const { draft } = parseSyllabus(guess, mapped);
      return { ok: true, draft, dropped: mapped.dropped, truncated: capped.truncated, buildsSpent: 0 };
    } catch (e) {
      const message = e instanceof SyllabusResponseError ? e.message : describeApiError(e, "syllabus");
      return { ok: false, message, draft: parseSyllabus(guess).draft, buildsSpent: 0 };
    }
  }

  /** Saves the course only after the student accepts the confirmed skeleton. */
  async confirmCourse(draft: SyllabusDraft): Promise<CourseOutcome> {
    const problems = draftProblems(draft);
    if (problems.length) return { ok: false, reason: "invalid", problems: problems.map(p => p.message) };
    const confirmed = confirmSkeleton(draft, true);
    if (!confirmed) return { ok: false, reason: "invalid", problems: ["Nothing to save."] };
    if (!this.courseGate().allowed) return { ok: false, reason: "paywall" };
    const course: Course = { id: this.d.newId(), name: confirmed.courseName, createdAt: this.d.now(), items: confirmed.items };
    this.counter.value = await this.counter.bump("courses");
    this.commit({ courses: [...this.s.courses, course], counter: this.counter.value }, ["courses"]);
    void this.syncNotifications();
    return { ok: true, course };
  }

  updateCourseItems(courseId: string, items: SkeletonItem[]) {
    this.commit({ courses: this.s.courses.map(c => (c.id === courseId ? { ...c, items } : c)) }, ["courses"]);
    void this.syncNotifications();
  }

  /** Deleting a course keeps its builds as shared style decks. The courses counter never goes back down. */
  deleteCourse(courseId: string) {
    const builds = { ...this.s.builds };
    const touched: string[] = [];
    for (const b of Object.values(builds)) if (b.courseId === courseId) { builds[b.id] = { ...b, courseId: null }; touched.push(b.id); }
    this.commit({ courses: this.s.courses.filter(c => c.id !== courseId), builds }, ["courses"], touched);
    void this.syncNotifications();
  }

  // Study Build ---------------------------------------------------------------

  nextExamDate(courseId: string | null): string | null {
    if (!courseId) return null;
    const c = this.s.courses.find(x => x.id === courseId);
    if (!c) return null;
    const t = upcomingTests([c], this.d.now()).find(x => x.item.kind === "exam") ?? upcomingTests([c], this.d.now())[0];
    return t ? t.item.date : null;
  }

  async runBuild(input: { text: string; courseId: string | null }): Promise<BuildOutcome> {
    if (this.building) return { status: "busy" };
    const capped = capText(input.text, MAX_BUILD_CHARS);
    if (capped.text.length < MIN_BUILD_CHARS && !/^topic:/i.test(capped.text)) {
      return { status: "invalid", message: "Add a little more material first. A page of notes or more works best." };
    }
    const hash = await this.d.sha256(fingerprint(capped.text));
    const id = hash.slice(0, 12);
    // 1. Identical material is free and instant, on any tier, signed in or not.
    const hit = this.s.builds[id];
    if (hit) return { status: "cached", build: hit };
    // 2. The gate.
    const g = this.buildGate();
    if (!g.allowed) return { status: "paywall", reason: g.reason };
    // 3. Sign in with Apple before the first build.
    if (!(await this.signedIn())) return { status: "needs-signin" };

    this.building = true;
    try {
      const course = this.s.courses.find(c => c.id === input.courseId) ?? null;
      let raw: unknown;
      try {
        raw = await this.d.api.build({ fingerprint: hash, text: capped.text, courseName: course?.name ?? "", examDate: this.nextExamDate(course?.id ?? null) });
      } catch (e) {
        if (e instanceof ApiError && e.kind === "limit") return { status: "paywall", reason: "server-limit" };
        return { status: "error", message: describeApiError(e, "build") };
      }
      let build: FullBuild;
      try {
        build = normalizeBuild(raw, { id, hash, courseId: course?.id ?? null, courseName: course?.name ?? "", now: this.d.now(), origin: "generated" });
      } catch (e) {
        return { status: "error", message: e instanceof BuildResponseError ? `${e.message} Nothing was spent. Try again.` : describeApiError(new ApiError("bad-response", ""), "build") };
      }
      // 4. Spend exactly one build, only now that a valid set is in hand.
      await this.spend(g.source);
      await this.d.kv.set(K.src(id), capped.text).catch(() => this.markSaveFailed());
      this.commit({ builds: { ...this.s.builds, [id]: build } }, ["builds"], [id]);
      return { status: "ok", build, spent: g.source };
    } finally {
      this.building = false;
    }
  }

  private async spend(source: "free" | "pro" | "boost") {
    if (source === "free") {
      this.counter.value = await this.counter.bump("builds");
      this.commit({ counter: this.counter.value }, []);
    } else if (source === "pro") {
      this.commit({ proUsage: { month: monthKey(this.d.now()), used: this.s.proUsage.used + 1 } }, ["meta"]);
    } else {
      this.commit({ entitlement: spendBoost(this.s.entitlement) }, ["meta"]);
    }
  }

  async sourceText(buildId: string): Promise<string | null> {
    return this.d.kv.get<string | null>(K.src(buildId), null);
  }

  deleteBuild(buildId: string) {
    const builds = { ...this.s.builds };
    delete builds[buildId];
    void this.d.kv.remove(K.src(buildId));
    this.commit({ builds }, ["builds"], [buildId]);
  }

  // Deck sharing --------------------------------------------------------------

  async exportDeckFile(buildId: string): Promise<string | null> {
    const b = this.s.builds[buildId];
    return b ? exportDeck(b, this.d.now(), this.d.sha256) : null;
  }

  /** Opening a friend's deck spends no Study Build and creates no course. */
  async importDeckFile(text: string): Promise<{ ok: true; build: FullBuild; buildsSpent: 0; existed: boolean } | { ok: false; message: string }> {
    try {
      const file = await readDeck(text, this.d.sha256);
      const id = `i${file.checksum.slice(0, 11)}`;
      const existing = this.s.builds[id];
      if (existing) return { ok: true, ...importSharedDeck(existing), build: existing, existed: true };
      const build = normalizeBuild(file.payload, { id, hash: file.checksum, courseId: null, courseName: "", now: this.d.now(), origin: "imported" });
      this.commit({ builds: { ...this.s.builds, [id]: build } }, ["builds"], [id]);
      return { ok: true, build, buildsSpent: 0, existed: false };
    } catch (e) {
      return { ok: false, message: e instanceof DeckError || e instanceof BuildResponseError ? e.message : "That file could not be opened as a deck." };
    }
  }

  // Cards, answers, mistakes --------------------------------------------------

  private examCap(courseId: string | null): number | null {
    const c = courseId ? this.s.courses.find(x => x.id === courseId) : null;
    if (!c) return null;
    return upcomingTests([c], this.d.now())[0]?.at ?? null;
  }

  private bumpActivity(n = 1): Record<string, number> {
    const key = dayKey(this.d.now());
    const a = { ...this.s.activity, [key]: (this.s.activity[key] ?? 0) + n };
    const keys = Object.keys(a).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - ACTIVITY_KEEP_DAYS))) delete a[k];
    return a;
  }

  reviewCard(cardId: string, rating: Rating) {
    const now = this.d.now();
    const build = Object.values(this.s.builds).find(b => b.cards.some(c => c.id === cardId));
    const opts = { capAt: this.examCap(build?.courseId ?? null) };
    const prev = this.s.srs[cardId];
    const next = prev ? reviewCard(prev, rating, now, opts) : reviewNew(cardId, rating, now, opts);
    this.commit({ srs: { ...this.s.srs, [cardId]: next }, activity: this.bumpActivity() }, ["srs", "meta"]);
  }

  /**
   * Logs one answered question. A correct answer clears an open mistake. A wrong answer on a
   * question already in the Mistake Book restarts its weekly clock. A first wrong answer returns
   * needsReason, and the student picks the tag with markMistake.
   */
  recordAnswer(q: Question, correct: boolean, confidence: "sure" | "guessing", mode: Answer["mode"]): { needsReason: boolean } {
    const now = this.d.now();
    const answer: Answer = { questionId: q.id, topic: q.topic, correct, confidence, at: now, mode };
    const answers = [...this.s.answers, answer].slice(-ANSWER_LOG_CAP);
    const known = this.s.mistakes.find(m => m.questionId === q.id);
    const patch: Partial<AppState> = { answers, activity: this.bumpActivity() };
    const dirty: Slice[] = ["answers", "meta"];
    if (known) {
      patch.mistakes = resolveRetest(this.s.mistakes, q.id, correct, now);
      dirty.push("mistakes");
    }
    this.commit(patch, dirty);
    return { needsReason: !correct && !known };
  }

  markMistake(questionId: string, reason: MistakeReason) {
    this.commit({ mistakes: addMistake(this.s.mistakes, questionId, reason, this.d.now()) }, ["mistakes"]);
  }

  // Mock exam -----------------------------------------------------------------

  async startMock(bank: Question[], courseId: string | null, length: number, difficulty: MockDifficulty): Promise<{ ok: true; session: MockSession } | { ok: false; reason: "paywall" | "empty" }> {
    if (this.s.mock.active) return { ok: true, session: this.s.mock.active };
    if (!bank.length) return { ok: false, reason: "empty" };
    if (!this.mockGate().allowed) return { ok: false, reason: "paywall" };
    const now = this.d.now();
    const qs = assembleMock(bank, length, difficulty, now);
    const session: MockSession = { id: this.d.newId(), courseId, questionIds: qs.map(q => q.id), startedAt: now, limitSec: qs.length * SECONDS_PER_QUESTION[difficulty], difficulty, results: {} };
    // The free mock is counted when it starts, so a free student cannot restart it for another go.
    this.counter.value = await this.counter.bump("mocks");
    this.commit({ counter: this.counter.value, mock: { ...this.s.mock, active: session } }, ["mock"]);
    return { ok: true, session };
  }

  answerMock(questionId: string, response: MockResult["response"], correct: boolean, confidence: "sure" | "guessing") {
    const a = this.s.mock.active;
    if (!a) return;
    const result: MockResult = { questionId, response, correct, confidence, timedOut: false };
    this.commit({ mock: { ...this.s.mock, active: { ...a, results: { ...a.results, [questionId]: result } } } }, ["mock"]);
  }

  finishMock(questions: Question[]): MockReport | null {
    const a = this.s.mock.active;
    if (!a) return null;
    const now = this.d.now();
    const used = Math.min(a.limitSec, Math.round((now - a.startedAt) / 1000));
    const ordered = a.questionIds.map(id => questions.find(q => q.id === id)).filter((q): q is Question => !!q);
    const results = Object.values(a.results);
    const report = gradeMock(a.id, a.courseId, now, ordered, results, used, a.limitSec);
    const answers = [
      ...this.s.answers,
      ...results.filter(r => r.response != null).map((r): Answer => ({ questionId: r.questionId, topic: ordered.find(q => q.id === r.questionId)?.topic ?? "", correct: r.correct, confidence: r.confidence, at: now, mode: "mock" })),
    ].slice(-ANSWER_LOG_CAP);
    this.commit({ mock: { active: null, reports: [...this.s.mock.reports, report] }, answers, activity: this.bumpActivity(results.length) }, ["mock", "answers", "meta"]);
    return report;
  }

  /** Tags a miss from a mock report so it joins the Mistake Book. */
  tagMockMiss(questionId: string, reason: MistakeReason) { this.markMistake(questionId, reason); }

  // Learning modes (server) ---------------------------------------------------

  private async courseChunks(courseId: string | null): Promise<string[]> {
    const builds = Object.values(this.s.builds).filter(b => (courseId ? b.courseId === courseId : true));
    const parts: string[] = [];
    for (const b of builds) {
      const src = await this.sourceText(b.id);
      parts.push(...chunkText(src ?? b.summary));
    }
    return parts;
  }

  async ask(mode: AskMode, input: { text: string; topic?: string; courseId: string | null }): Promise<AskOutcome> {
    if (!(await this.signedIn())) return { status: "needs-signin" };
    const pool = await this.courseChunks(input.courseId);
    const query = `${input.topic ?? ""} ${input.text}`;
    const chunks = topChunks(pool, query, mode === "tutor" ? 4 : 5);
    const question = mode === "teachback" ? `Topic: ${input.topic ?? "(not named)"}\n\nStudent explanation:\n${input.text}` : input.text;
    try {
      const r = await this.d.api.ask({ mode, question, chunks });
      return { status: "ok", answer: r.answer, pointers: r.sourcePointers };
    } catch (e) {
      if (e instanceof ApiError && e.kind === "limit") return { status: "paywall", reason: "server-limit" };
      return { status: "error", message: describeApiError(e, "ask") };
    }
  }

  // Purchases -----------------------------------------------------------------

  /** Records a purchase or restore result as the Entitlement and waits until it is on disk. */
  async recordPurchase(p: PurchaseLike): Promise<PurchaseOutcome> {
    const out = applyPurchase(this.s.entitlement, p, this.d.now());
    if (out.changed) this.commit({ entitlement: out.entitlement }, ["meta"]);
    await this.flush();
    return out;
  }

  /** The store answered with the active subscriptions. Authoritative for Pro. */
  async recordActiveSubscriptions(subs: ActiveSubLike[]): Promise<void> {
    const next = applyActiveSubscriptions(this.s.entitlement, subs, this.d.now());
    if (next.until !== this.s.entitlement.until) this.commit({ entitlement: next }, ["meta"]);
    await this.flush();
  }

  // Misc ----------------------------------------------------------------------

  logFocus(minutes: number, goal: string) {
    this.commit({ sessions: [...this.s.sessions, { at: this.d.now(), minutes, goal }].slice(-500) }, ["meta"]);
  }

  setSettings(patch: Partial<Settings>) {
    this.commit({ settings: { ...this.s.settings, ...patch } }, ["meta"]);
    void this.syncNotifications();
  }

  async syncNotifications(): Promise<void> {
    try {
      const now = this.d.now();
      const dated = planDatedNotifications(this.s.courses, now);
      const daily = planDailyNotifications({ warmupEnabled: this.s.settings.warmupEnabled, warmupHour: this.s.settings.warmupHour, hasUpcomingTest: upcomingTests(this.s.courses, now).length > 0 });
      await this.d.notifier.sync(dated, daily);
    } catch {
      // Notifications are a convenience. A failure never blocks studying.
    }
  }

  /**
   * Delete everything on this device: courses, builds, source text, cards, answers, mistakes,
   * settings, and the sign in. The free allowance count and any purchases stay, so deleting
   * cannot reset what was used or lose what was paid for.
   */
  async deleteEverything(): Promise<void> {
    await this.flush();
    const ids = Object.keys(this.s.builds);
    await Promise.all([
      ...ids.flatMap(id => [this.d.kv.remove(K.build(id)), this.d.kv.remove(K.src(id))]),
      this.d.kv.remove(K.courses), this.d.kv.remove(K.srs), this.d.kv.remove(K.answers), this.d.kv.remove(K.mistakes),
      this.d.kv.remove(K.mock), this.d.kv.remove(K.index),
    ]);
    await this.d.auth.signOut().catch(() => undefined);
    const fresh = initialState(this.d.now());
    this.s = { ...fresh, ready: true, counter: this.s.counter, entitlement: this.s.entitlement, proUsage: this.s.proUsage };
    this.dirty.add("meta");
    this.emit();
    this.chain = this.chain.then(() => this.writeDirty()).catch(() => undefined);
    await this.flush();
    void this.syncNotifications();
  }
}


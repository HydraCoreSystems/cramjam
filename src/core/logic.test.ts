import { describe, expect, it } from "vitest";
import { ApiError, createApi, describeApiError } from "./api";
import { BuildResponseError, normalizeBuild, passageFor, summarySections } from "./build";
import { DAY, HOUR, daysUntil, parseItemDate } from "./dates";
import { DeckError, exportDeck, readDeck } from "./deck";
import { BOOST_TEN, NO_ENTITLEMENT, PLAN_ANNUAL, PLAN_MONTHLY, applyActiveSubscriptions, applyPurchase, isPro, monthlyBuildsLeft } from "./entitlement";
import { guessCourseForText, matchTopic } from "./intakeMatch";
import { jwtExpiry, tokenStale } from "./jwt";
import { capText } from "./limits";
import { mockAllowed } from "./mockGate";
import { planDailyNotifications, planDatedNotifications } from "./notifPlan";
import { buildDayPlan, finalsBlocks, finalsTarget, planTargets } from "./plan";
import { chunkText, topChunks } from "./retrieve";
import { NEW_PER_DAY, dailyQueue, previewInterval, reviewCard, reviewNew, retrievability, streakFrom } from "./srs";
import {
  Answer, Mistake, Question, addMistake, assembleMock, calibration, checkAnswer, dueRetests, drillQueue, gradeMock, openMistakes, readiness, resolveRetest, topicStats, weakTopics,
} from "./study";
import { guessCourseName, mapSyllabusResponse, parseSyllabus, confirmSkeleton, draftProblems } from "./syllabus";
import { goodBuild, sha256 } from "./testkit";

let n = 0;
const nid = () => `x${++n}`;
const T0 = new Date(2026, 10, 8, 10, 0, 0).getTime();

describe("syllabus client: endpoint output becomes skeleton items", () => {
  const resp = { items: [
    { kind: "exam", label: "Final Exam", date: "2026-12-10", weight: 40, detail: "Cumulative" },
    { kind: "Quiz", label: "Quiz 1", date: "2026-11-20", weight: "5%", detail: "" },
    { kind: "due", label: "Lab report", date: "11/30/2026", weight: null, detail: "" },
    { kind: "grading", label: "Homework", date: null, weight: 20, detail: "" },
    { kind: "textbook", label: "Campbell Biology", date: null, weight: null, detail: "12th ed" },
    { kind: "office_hours", label: "Dr. Lee", date: null, weight: null, detail: "Tue 2 to 4, Room 12" },
    { kind: "weekly topic", label: "Week 3: Respiration", date: null, weight: null, detail: "" },
    { kind: "course", label: "BIO 201 Cell Biology" },
    { kind: "mystery", label: "Bring a calculator", date: "someday", weight: 150, detail: "" },
    { label: "", detail: "" }, null,
  ] };

  it("keeps every kind the brief lists and routes aliases", () => {
    const m = mapSyllabusResponse(resp, nid);
    const kinds = m.items.map(i => i.kind);
    expect(kinds).toEqual(["exam", "quiz", "assignment", "grading", "material", "officeHours", "topic", "note"]);
    expect(m.courseName).toBe("BIO 201 Cell Biology");
    expect(m.dropped).toBe(2);
  });

  it("normalizes weights and blanks unreadable dates instead of guessing", () => {
    const m = mapSyllabusResponse(resp, nid);
    expect(m.items[1].weight).toBe(5);
    expect(m.items[2].date).toBe("11/30/2026");
    expect(m.items.at(-1)).toMatchObject({ kind: "note", date: null, weight: null });
    expect(m.items.every(i => i.include)).toBe(true);
  });

  it("rejects a reply with no items array", () => {
    expect(() => mapSyllabusResponse({ nope: true }, nid)).toThrow();
  });

  it("parseSyllabus carries the mapped items into the draft, spends no build, and saves only on confirm", () => {
    const m = mapSyllabusResponse(resp, nid);
    const { draft, buildsSpent } = parseSyllabus("fallback", m);
    expect(buildsSpent).toBe(0);
    expect(draft.items.length).toBe(8);
    expect(draft.courseName).toBe("BIO 201 Cell Biology");
    expect(draft.confirmed).toBe(false);
    expect(confirmSkeleton(draft, false)).toBeNull();
    const off = { ...draft, items: draft.items.map((i, k) => (k === 0 ? { ...i, include: false } : i)) };
    expect(confirmSkeleton(off, true)!.items.length).toBe(7);
    expect(draftProblems({ ...draft, courseName: " " })[0].field).toBe("name");
  });

  it("guesses a course name from a syllabus header for the editable field", () => {
    expect(guessCourseName("Welcome\nBIO 201 Cell Biology\nFall 2026")).toBe("BIO 201 Cell Biology");
    expect(guessCourseName("nothing useful here")).toBe("");
  });

  it("reads dates the server may send, and rejects impossible ones", () => {
    expect(parseItemDate("2026-12-10")?.hasTime).toBe(false);
    expect(parseItemDate("2026-12-10T14:30:00")?.hasTime).toBe(true);
    expect(parseItemDate("2026-02-31")).toBeNull();
    expect(parseItemDate("next Tuesday")).toBeNull();
  });
});

describe("spaced repetition advances a card", () => {
  it("a first Good review creates a card due in days, and a second pushes it further out", () => {
    const c1 = reviewNew("c", 3, T0);
    expect(c1.due).toBeGreaterThan(T0 + 2 * DAY);
    expect(c1.reps).toBe(1);
    const c2 = reviewCard(c1, 3, c1.due);
    expect(c2.reps).toBe(2);
    expect(c2.stability).toBeGreaterThan(c1.stability);
    expect(c2.due - c1.due).toBeGreaterThan(c1.due - T0);
  });

  it("Again requeues in minutes, counts a lapse, and shrinks stability", () => {
    const c1 = reviewCard(reviewNew("c", 3, T0), 3, T0 + 4 * DAY);
    const lapsed = reviewCard(c1, 1, T0 + 12 * DAY);
    expect(lapsed.due - (T0 + 12 * DAY)).toBeLessThan(HOUR);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.stability).toBeLessThan(c1.stability);
    expect(lapsed.state).toBe("relearning");
  });

  it("Easy goes further than Good, and Hard stays shorter", () => {
    const base = reviewNew("c", 3, T0);
    const at = base.due;
    expect(reviewCard(base, 4, at).due).toBeGreaterThan(reviewCard(base, 3, at).due);
    expect(reviewCard(base, 2, at).due).toBeLessThan(reviewCard(base, 3, at).due);
  });

  it("recall probability decays with time and is 90 percent at the scheduled interval", () => {
    expect(retrievability(0, 5)).toBe(1);
    expect(retrievability(5, 5)).toBeCloseTo(0.9, 2);
    expect(retrievability(30, 5)).toBeLessThan(retrievability(5, 5));
  });

  it("never schedules a card past the exam", () => {
    const exam = T0 + 6 * DAY;
    const c = reviewCard(reviewCard(reviewNew("c", 4, T0), 4, T0 + 5 * DAY, { capAt: exam }), 4, T0 + 5.5 * DAY, { capAt: exam });
    expect(c.due).toBeLessThanOrEqual(exam);
  });

  it("builds the daily queue: due first, then new up to the daily limit", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `k${i}`);
    const seen = { k0: reviewNew("k0", 3, T0 - 20 * DAY), k1: reviewNew("k1", 3, T0 - 20 * DAY), k2: reviewNew("k2", 3, T0) };
    const q = dailyQueue(ids, seen, T0 + 5 * DAY);
    expect(q.slice(0, 2).every(x => x.kind === "due")).toBe(true);
    expect(q.filter(x => x.kind === "new").length).toBe(NEW_PER_DAY);
    expect(previewInterval(null, "z", 3, T0)).toMatch(/d$/);
  });

  it("counts a streak from real completed days only", () => {
    const day = (k: number) => { const d = new Date(T0 - k * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    expect(streakFrom({}, T0).streak).toBe(0);
    expect(streakFrom({ [day(1)]: 5, [day(2)]: 9, [day(3)]: 5 }, T0)).toMatchObject({ streak: 3, todayDone: false });
    expect(streakFrom({ [day(0)]: 5, [day(1)]: 5 }, T0)).toMatchObject({ streak: 2, todayDone: true });
    expect(streakFrom({ [day(1)]: 4, [day(2)]: 9 }, T0).streak).toBe(0); // 4 is not a completed day
    expect(streakFrom({ [day(1)]: 5, [day(3)]: 5 }, T0).streak).toBe(1); // a gap ends it
  });
});

describe("study math", () => {
  const bank: Question[] = [
    { id: "a:q0", topic: "Cells", prompt: "p0", answer: "A" }, { id: "a:q1", topic: "Genes", prompt: "p1", answer: "B" },
    { id: "a:q2", topic: "Cells", prompt: "p2", answer: "C" }, { id: "a:q3", topic: "Ecology", prompt: "p3", answer: "D" },
  ];
  const ans = (id: string, topic: string, correct: boolean, confidence: "sure" | "guessing" = "sure", at = 1): Answer => ({ questionId: id, topic, correct, confidence, at });

  it("readiness uses the latest answer per question, so a corrected miss stops hurting", () => {
    expect(readiness([])).toBe(0);
    const a = [ans("q", "x", false), ans("q", "x", true)];
    expect(topicStats(a)[0]).toMatchObject({ answered: 1, correct: 1, pct: 100 });
  });

  it("the drill puts every open miss first, then weak topics", () => {
    const book = addMistake([], "a:q3", "misread", T0);
    const q = drillQueue(bank, book, ["Genes"], 3);
    expect(q.map(x => x.id)).toEqual(["a:q3", "a:q1", "a:q0"]);
  });

  it("mistakes retest a week later; a correct retest clears, a wrong one restarts the clock", () => {
    let book: Mistake[] = addMistake([], "a:q0", "never-saw", T0);
    expect(dueRetests(book, T0 + 6 * DAY)).toHaveLength(0);
    expect(dueRetests(book, T0 + 7 * DAY)).toHaveLength(1);
    book = resolveRetest(book, "a:q0", false, T0 + 8 * DAY);
    expect(book[0].retestAt).toBe(T0 + 15 * DAY);
    expect(book[0].retests).toBe(1);
    book = resolveRetest(book, "a:q0", true, T0 + 16 * DAY);
    expect(openMistakes(book)).toHaveLength(0);
  });

  it("weak topics rank open mistakes and low scores ahead of strong topics", () => {
    const book = addMistake([], "a:q3", "time", T0);
    const w = weakTopics([ans("a:q0", "Cells", true), ans("a:q1", "Genes", false)], book, bank);
    expect(w.slice(0, 2).sort()).toEqual(["Ecology", "Genes"]);
    expect(w).not.toContain("Cells");
  });

  it("calibration compares sure with right", () => {
    const a = [ans("1", "x", true), ans("2", "x", false), ans("3", "x", false), ans("4", "x", true, "guessing")];
    const c = calibration(a);
    expect(c).toMatchObject({ sure: 3, sureCorrect: 1, guessing: 1, guessingCorrect: 1, confidencePct: 75, accuracyPct: 50 });
    expect(c.gap).toBe(67);
  });

  it("checks local kinds without AI and leaves short answers to the student", () => {
    const fill: Question = { id: "f", topic: "t", prompt: "", answer: "The Krebs cycle", kind: "fill" };
    expect(checkAnswer(fill, " krebs  CYCLE.")).toBe(true);
    expect(checkAnswer({ ...fill, kind: "short" }, "anything")).toBeNull();
    const match: Question = { id: "m", topic: "t", prompt: "", answer: "", kind: "match", pairs: [{ left: "a", right: "1" }, { left: "b", right: "2" }] };
    expect(checkAnswer(match, [{ left: "b", right: "2" }, { left: "a", right: "1" }])).toBe(true);
    expect(checkAnswer(match, [{ left: "a", right: "2" }, { left: "b", right: "1" }])).toBe(false);
  });

  it("assembles the same mock for the same seed with no AI, honoring length and difficulty", () => {
    const big: Question[] = Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, topic: "t", prompt: "", answer: "", difficulty: ((i % 3) + 1) as 1 | 2 | 3 }));
    const a = assembleMock(big, 10, "hard", 7);
    expect(a).toHaveLength(10);
    expect(assembleMock(big, 10, "hard", 7).map(q => q.id)).toEqual(a.map(q => q.id));
    expect(a.filter(q => q.difficulty === 1).length).toBe(0);
  });

  it("grades a mock topic by topic and counts unanswered as missed", () => {
    const qs = bank;
    const rep = gradeMock("m", null, T0, qs, [
      { questionId: "a:q0", response: "A", correct: true, confidence: "sure", timedOut: false },
      { questionId: "a:q1", response: "x", correct: false, confidence: "sure", timedOut: false },
    ], 100, 300);
    expect(rep.correct).toBe(1);
    expect(rep.total).toBe(4);
    expect(rep.pct).toBe(25);
    expect(rep.missed).toEqual(["a:q1", "a:q2", "a:q3"]);
    expect(rep.topics.find(t => t.topic === "Cells")).toMatchObject({ total: 2, correct: 1 });
  });
});

describe("plan, Finals Mode and notifications", () => {
  const course = (items: object[]) => ({ id: "c1", name: "BIO 201", items: items as never });
  const exam = (id: string, date: string, weight: number | null, kind = "exam") => ({ id, kind, label: id, date, weight, detail: "", include: true });

  it("lays the plan out day by day to the exam, heavier test first when days are equal", () => {
    const courses = [course([exam("Final", "2026-11-14", 40), exam("Quiz", "2026-11-14", 5, "quiz")])];
    const days = buildDayPlan(planTargets(courses, T0), ["Cells", "Genes"], T0, 60);
    expect(days).toHaveLength(6);
    expect(days[0].targets[0].id).toBe("Final");
    expect(days[0].targets[0].minutes).toBeGreaterThan(days[0].targets[1].minutes);
    expect(days[0].topics).toEqual(["Cells", "Genes"]);
    expect(days.at(-1)!.date).toBe("2026-11-13");
  });

  it("adds a nearer, lighter quiz to the plan only on the days before it", () => {
    const courses = [course([exam("Final", "2026-11-20", 40), exam("Quiz", "2026-11-10", 5, "quiz")])];
    const days = buildDayPlan(planTargets(courses, T0), [], T0, 60);
    expect(days[0].targets).toHaveLength(2);
    expect(days.find(d => d.date === "2026-11-12")!.targets).toHaveLength(1);
  });

  it("Finals Mode turns on inside 72 hours and lays out review-only blocks with sleep and breaks", () => {
    const soon = [course([exam("Final", "2026-11-10", 40)])]; // 9 AM Nov 10, about 47 hours away
    expect(finalsTarget(soon, T0)?.item.id).toBe("Final");
    const later = [course([exam("Final", "2026-11-20", 40)])];
    expect(finalsTarget(later, T0)).toBeNull();
    const blocks = finalsBlocks(T0, finalsTarget(soon, T0)!.at, ["Cells"]);
    expect(blocks.some(b => b.activity === "sleep")).toBe(true);
    expect(blocks.some(b => b.activity === "rest")).toBe(true);
    expect(blocks.every(b => ["drill", "cards", "mistakes", "facts", "rest", "sleep"].includes(b.activity))).toBe(true);
    expect(blocks.at(-1)!.endsAt).toBeLessThanOrEqual(finalsTarget(soon, T0)!.at);
  });

  it("schedules exam warnings three and one days out, never in the past, and daily local reminders", () => {
    const courses = [course([exam("Final", "2026-11-20", 40), exam("Quiz", "2026-11-09", 5, "quiz"), exam("Old", "2026-10-01", 5, "quiz"), exam("Lab", "2026-11-12", null, "assignment")])];
    const dated = planDatedNotifications(courses, T0);
    const fin = dated.filter(d => d.id.includes(":Final:"));
    expect(fin.map(f => f.id.split(":").pop()).sort()).toEqual(["0", "1", "3"]);
    expect(dated.some(d => d.id.includes(":Old:"))).toBe(false);
    expect(dated.every(d => d.at > T0)).toBe(true);
    expect(dated.some(d => d.id.includes(":Lab:"))).toBe(true);
    expect(planDailyNotifications({ warmupEnabled: true, warmupHour: 18, hasUpcomingTest: true }).map(d => d.id)).toHaveLength(2);
    expect(planDailyNotifications({ warmupEnabled: false, warmupHour: 18, hasUpcomingTest: false })).toHaveLength(0);
  });

  it("counts calendar days, not 24 hour blocks", () => {
    expect(daysUntil(new Date(2026, 10, 9, 0, 5).getTime(), new Date(2026, 10, 8, 23, 55).getTime())).toBe(1);
  });
});

describe("purchase results become the Entitlement value", () => {
  const future = T0 + 30 * DAY;
  it("a subscription purchase sets Pro until its expiry, monthly and annual alike", () => {
    for (const sku of [PLAN_MONTHLY, PLAN_ANNUAL]) {
      const out = applyPurchase(NO_ENTITLEMENT, { productId: sku, transactionId: "t", expirationDateIOS: future }, T0);
      expect(out.entitlement.until).toBe(future);
      expect(isPro(out.entitlement, T0)).toBe(true);
      expect(isPro(out.entitlement, future + 1)).toBe(false);
    }
  });
  it("an already expired subscription is ignored", () => {
    expect(applyPurchase(NO_ENTITLEMENT, { productId: PLAN_ANNUAL, expirationDateIOS: T0 - 1 }, T0).kind).toBe("ignored");
  });
  it("a Boost adds ten builds once per transaction and needs a transaction id", () => {
    const a = applyPurchase(NO_ENTITLEMENT, { productId: BOOST_TEN, transactionId: "b" }, T0);
    expect(a.entitlement.boosts).toBe(10);
    expect(applyPurchase(a.entitlement, { productId: BOOST_TEN, transactionId: "b" }, T0).changed).toBe(false);
    expect(applyPurchase(a.entitlement, { productId: BOOST_TEN, transactionId: "c" }, T0).entitlement.boosts).toBe(20);
    expect(applyPurchase(NO_ENTITLEMENT, { productId: BOOST_TEN }, T0).kind).toBe("ignored");
  });
  it("an unknown product changes nothing", () => {
    expect(applyPurchase(NO_ENTITLEMENT, { productId: "other", transactionId: "z" }, T0).changed).toBe(false);
  });
  it("restore is authoritative: it ends Pro when the store shows nothing active, and leaves boosts alone", () => {
    const e = { until: future, boosts: 7 };
    expect(applyActiveSubscriptions(e, [], T0)).toMatchObject({ until: null, boosts: 7 });
    expect(applyActiveSubscriptions(e, [{ productId: PLAN_ANNUAL, isActive: true, expirationDateIOS: future + DAY }], T0).until).toBe(future + DAY);
  });
  it("the allowance counts down for Pro and for free, with boosts on top", () => {
    const pro = { until: future, boosts: 0 };
    expect(monthlyBuildsLeft(0, pro, T0)).toBeGreaterThan(monthlyBuildsLeft(5, pro, T0));
    expect(monthlyBuildsLeft(1, NO_ENTITLEMENT, T0)).toBe(2);
    expect(monthlyBuildsLeft(3, { until: null, boosts: 4 }, T0)).toBe(4);
  });
});

describe("study set validation", () => {
  const ctx = { id: "h1", hash: "h1", courseId: null, courseName: "", now: T0, origin: "generated" as const };
  it("accepts the five question kinds and keeps answer, reason and a pointer on each", () => {
    const b = normalizeBuild(goodBuild({ courseName: "BIO", examDate: null, fingerprint: "", text: "" }), ctx);
    expect(b.questions).toHaveLength(5);
    for (const q of b.questions) { expect(q.answer).toBeTruthy(); expect(q.reason).toBeTruthy(); expect(q.source?.label).toBeTruthy(); }
    expect(b.questions.find(q => q.kind === "tf")!.answer).toBe("True");
    expect(b.questions.find(q => q.kind === "match")!.answer).toContain("ATP");
    expect(new Set(b.questions.map(q => q.id)).size).toBe(5);
  });
  it("maps a letter answer onto its option and drops a multiple choice with no valid answer", () => {
    const b = normalizeBuild({ summary: "s", questions: [
      { kind: "mcq", prompt: "p", options: ["x", "y"], answer: "B", topic: "t" },
      { kind: "mcq", prompt: "p2", options: ["x", "y"], answer: "zzz", topic: "t" },
    ] }, ctx);
    expect(b.questions).toHaveLength(1);
    expect(b.questions[0].answer).toBe("y");
  });
  it("rejects a reply with no summary or nothing to study", () => {
    expect(() => normalizeBuild({ summary: "", cards: [{ front: "a", back: "b" }] }, ctx)).toThrow(BuildResponseError);
    expect(() => normalizeBuild({ summary: "s" }, ctx)).toThrow(BuildResponseError);
    expect(() => normalizeBuild(null, ctx)).toThrow(BuildResponseError);
  });
  it("flags predictions separately from the question bank", () => {
    const b = normalizeBuild(goodBuild({ courseName: "", examDate: null, fingerprint: "", text: "" }), ctx);
    expect(b.likely).toHaveLength(1);
    expect(b.questions.some(q => q.prompt.includes("Describe how a cell"))).toBe(false);
  });
  it("splits the summary into sections and finds a source passage", () => {
    expect(summarySections("intro\n## A\nalpha\n## B\nbeta").map(s => s.heading)).toEqual(["Overview", "A", "B"]);
    const p = passageFor("Cells use ATP. Mitochondria make ATP. Done.", { label: "L", quote: "Mitochondria make ATP" }, 5);
    expect(p?.hit).toBe("Mitochondria make ATP");
    expect(passageFor(null, { label: "L" })).toBeNull();
  });
});

describe("deck sharing", () => {
  const b = normalizeBuild(goodBuild({ courseName: "BIO", examDate: null, fingerprint: "", text: "" }), { id: "h", hash: "h", courseId: "c", courseName: "BIO", now: T0, origin: "generated" });
  it("round trips and the opened deck is valid", async () => {
    const file = await exportDeck(b, T0, sha256);
    const read = await readDeck(file, sha256);
    const copy = normalizeBuild(read.payload, { id: "i1", hash: read.checksum, courseId: null, courseName: "", now: T0, origin: "imported" });
    expect(copy.questions).toHaveLength(5);
    expect(copy.cards).toHaveLength(2);
    expect(file).not.toContain("com.gatheringmoss");
  });
  it("refuses a tampered or foreign file", async () => {
    const file = await exportDeck(b, T0, sha256);
    await expect(readDeck(file.replace("Mitochondria", "Nucleus"), sha256)).rejects.toThrow(DeckError);
    await expect(readDeck("not json", sha256)).rejects.toThrow(DeckError);
    await expect(readDeck(JSON.stringify({ format: "other" }), sha256)).rejects.toThrow(DeckError);
  });
});

describe("api client", () => {
  const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
  const mk = (f: typeof fetch, token: string | null = "tok") => createApi({ base: "https://x.test", getToken: async () => token, fetchImpl: f });

  it("posts JSON with the Apple identity token as a Bearer header", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const api = mk((async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("{\"items\":[]}"); }) as never);
    await api.syllabus("hello");
    expect(seen!.url).toBe("https://x.test/v1/syllabus");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(seen!.init.body as string)).toEqual({ text: "hello" });
  });
  it("sends no Authorization header before sign in", async () => {
    let headers: Record<string, string> = {};
    await mk((async (_u: string, init: RequestInit) => { headers = init.headers as Record<string, string>; return new Response("{\"items\":[]}"); }) as never, null).syllabus("x");
    expect(headers.Authorization).toBeUndefined();
  });
  it("maps failures to honest kinds", async () => {
    await expect(mk((async () => { throw new TypeError("net"); }) as never).build({ fingerprint: "", text: "", courseName: "", examDate: null })).rejects.toMatchObject({ kind: "unreachable" });
    await expect(mk(ok({}, 401) as never).syllabus("x")).rejects.toMatchObject({ kind: "unauthorized" });
    await expect(mk(ok({}, 429) as never).syllabus("x")).rejects.toMatchObject({ kind: "limit" });
    await expect(mk(ok({}, 500) as never).syllabus("x")).rejects.toMatchObject({ kind: "server" });
    await expect(mk((async () => new Response("<html>", { status: 200 })) as never).syllabus("x")).rejects.toMatchObject({ kind: "bad-response" });
  });
  it("ask returns the answer and normalized pointers, and rejects an empty answer", async () => {
    const r = await mk(ok({ answer: " Yes. ", sourcePointers: ["Line 4", { quote: "ATP", label: "p2" }] }) as never).ask({ mode: "tutor", question: "q", chunks: [] });
    expect(r.answer).toBe("Yes.");
    expect(r.sourcePointers.map(p => p.label)).toEqual(["Line 4", "p2"]);
    await expect(mk(ok({ answer: "" }) as never).ask({ mode: "tutor", question: "q", chunks: [] })).rejects.toBeInstanceOf(ApiError);
  });
  it("tells the student plainly when the server cannot be reached", () => {
    expect(describeApiError(new ApiError("unreachable", ""), "ask")).toContain("can't reach");
    expect(describeApiError(new ApiError("unreachable", ""), "syllabus")).toContain("No Study Build");
  });
});

describe("small pieces", () => {
  it("allows the dev mock only in a development build with the flag", () => {
    expect(mockAllowed(true, "1")).toBe(true);
    expect(mockAllowed(false, "1")).toBe(false);
    expect(mockAllowed(true, undefined)).toBe(false);
    expect(mockAllowed(true, "0")).toBe(false);
  });
  it("reads a JWT expiry and flags a stale token", () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const tok = `${b64({ alg: "none" })}.${b64({ exp: 2000000000 })}.sig`;
    expect(jwtExpiry(tok)).toBe(2000000000_000);
    expect(tokenStale(tok, 1999999990_000)).toBe(true);
    expect(tokenStale(tok, 1999990000_000)).toBe(false);
    expect(tokenStale("garbage", 0)).toBe(true);
  });
  it("caps long material at a clean break and says so", () => {
    const long = ("Sentence number one is here. ").repeat(100);
    const c = capText(long, 500);
    expect(c.truncated).toBe(true);
    expect(c.text.length).toBeLessThanOrEqual(500);
    expect(capText("short", 500).truncated).toBe(false);
  });
  it("retrieves only the few most relevant passages", () => {
    const chunks = chunkText("Mitochondria make ATP.\n\nThe Roman Empire fell in 476.\n\nGolgi packages proteins.\n\nPhotosynthesis happens in chloroplasts.");
    const top = topChunks(chunks, "Who makes ATP in the cell? mitochondria", 2);
    expect(top[0]).toContain("Mitochondria");
    expect(top.length).toBeLessThanOrEqual(2);
    expect(topChunks(chunks, "quantum chromodynamics", 2)).toEqual([]);
  });
  it("files new material under the matching course by the name it already holds", () => {
    const cs = [{ id: "a", name: "BIO 201 Cell Biology" }, { id: "b", name: "CHEM 101 General Chemistry" }];
    expect(guessCourseForText("Notes for CHEM 101 lecture 4", cs)).toBe("b");
    expect(guessCourseForText("random notes", cs)).toBeNull();
    expect(guessCourseForText("anything", [cs[0]])).toBe("a");
    expect(matchTopic("Cellular respiration basics", ["Week 3: Respiration", "Week 4: Genetics"])).toBe("Week 3: Respiration");
    expect(matchTopic("Quantum", ["Week 3: Respiration"])).toBe("Quantum");
  });
  it("rolls the time constants forward without drifting", () => {
    expect(HOUR * 24).toBe(DAY);
  });
});

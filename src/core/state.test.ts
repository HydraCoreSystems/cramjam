import { describe, expect, it } from "vitest";
import { COUNTER_KEY, loadCounter, saveCounter } from "./counterStore";
import { ApiError } from "./api";
import { BOOST_TEN, PLAN_ANNUAL, PLAN_MONTHLY, PRO_MONTHLY_BUILDS, monthlyBuildsLeft } from "./entitlement";
import { SyllabusDraft } from "./syllabus";
import { MemKV, goodBuild, harness, material, rawKV } from "./testkit";

const draftOf = (name: string): SyllabusDraft => ({ courseName: name, confirmed: false, items: [{ id: "i1", kind: "exam", label: "Final", date: "2026-12-10", weight: 40, detail: "", include: true }] });

describe("counter persistence used by the state layer", () => {
  it("merges the Keychain and app copies with the larger value winning, and heals both", async () => {
    const chain = new MemKV(); const app = new MemKV();
    chain.data.set(COUNTER_KEY, JSON.stringify({ builds: 3, courses: 0, mocks: 1 }));
    app.data.set(COUNTER_KEY, JSON.stringify({ builds: 1, courses: 1, mocks: 0 }));
    const merged = await loadCounter(rawKV(chain), rawKV(app));
    expect(merged).toEqual({ builds: 3, courses: 1, mocks: 1 });
    expect(JSON.parse(chain.data.get(COUNTER_KEY)!)).toEqual(merged);
    expect(JSON.parse(app.data.get(COUNTER_KEY)!)).toEqual(merged);
  });

  it("survives losing one copy, as after clearing app storage", async () => {
    const chain = new MemKV(); const app = new MemKV();
    await saveCounter(rawKV(chain), rawKV(app), { builds: 2, courses: 1, mocks: 0 });
    const fresh = new MemKV();
    expect(await loadCounter(rawKV(chain), rawKV(fresh))).toEqual({ builds: 2, courses: 1, mocks: 0 });
  });

  it("reads at launch and writes on every change through the real store", async () => {
    const h = harness();
    h.chain.data.set(COUNTER_KEY, JSON.stringify({ builds: 2, courses: 0, mocks: 0 }));
    await h.store.init();
    expect(h.store.getState().counter.builds).toBe(2);
    const out = await h.store.runBuild({ text: material("one"), courseId: null });
    expect(out.status).toBe("ok");
    expect(h.store.getState().counter.builds).toBe(3);
    expect(JSON.parse(h.chain.data.get(COUNTER_KEY)!).builds).toBe(3);
    expect(JSON.parse(h.app.data.get(COUNTER_KEY)!).builds).toBe(3);
  });

  it("relaunch keeps the count: a new store on the same storage sees it", async () => {
    const a = harness();
    await a.store.init();
    await a.store.runBuild({ text: material("persist"), courseId: null });
    await a.store.flush();
    const b = harness({ app: a.app, chain: a.chain });
    await b.store.init();
    expect(b.store.getState().counter.builds).toBe(1);
    expect(Object.keys(b.store.getState().builds)).toHaveLength(1);
  });

  it("a failing write to one copy never loses the other", async () => {
    const h = harness();
    await h.store.init();
    h.app.failWrites = true;
    await h.store.runBuild({ text: material("keychain only"), courseId: null });
    expect(JSON.parse(h.chain.data.get(COUNTER_KEY)!).builds).toBe(1);
    expect(h.store.getState().saveFailed).toBe(true); // and the student is told
    expect(Object.keys(h.store.getState().builds)).toHaveLength(1); // the build is still in memory
  });
});

describe("the paywall gate inside the wired state layer", () => {
  it("opens on the fourth build and not before", async () => {
    const h = harness();
    await h.store.init();
    for (let i = 1; i <= 3; i++) expect((await h.store.runBuild({ text: material(`n${i}`), courseId: null })).status).toBe("ok");
    expect(h.buildCalls).toHaveLength(3);
    const fourth = await h.store.runBuild({ text: material("n4"), courseId: null });
    expect(fourth).toEqual({ status: "paywall", reason: "build" });
    expect(h.buildCalls).toHaveLength(3); // no call, nothing spent
    expect(h.store.getState().counter.builds).toBe(3);
  });

  it("opens on the second course and not on the first", async () => {
    const h = harness();
    await h.store.init();
    expect((await h.store.confirmCourse(draftOf("BIO 201"))).ok).toBe(true);
    const second = await h.store.confirmCourse(draftOf("CHEM 101"));
    expect(second).toEqual({ ok: false, reason: "paywall" });
    expect(h.store.getState().courses).toHaveLength(1);
  });

  it("opens on the second mock exam and not on the first", async () => {
    const h = harness();
    await h.store.init();
    await h.store.runBuild({ text: material("mock"), courseId: null });
    const bank = Object.values(h.store.getState().builds).flatMap(b => b.questions);
    expect((await h.store.startMock(bank, null, 10, "mixed")).ok).toBe(true);
    h.store.finishMock(bank);
    expect(await h.store.startMock(bank, null, 10, "mixed")).toEqual({ ok: false, reason: "paywall" });
  });

  it("identical material is free and returns the cached build on any tier, even when gated", async () => {
    const h = harness();
    await h.store.init();
    for (let i = 1; i <= 3; i++) await h.store.runBuild({ text: material(`c${i}`), courseId: null });
    const again = await h.store.runBuild({ text: `  ${material("c1").toUpperCase()}  `, courseId: null });
    expect(again.status).toBe("cached");
    expect(h.buildCalls).toHaveLength(3);
    expect(h.store.getState().counter.builds).toBe(3);
  });

  it("syllabus parsing spends no Study Build, even once the free builds are gone", async () => {
    const h = harness({ api: { syllabus: async () => ({ items: [{ kind: "exam", label: "Final", date: "2026-12-10", weight: "40%" }] }) } });
    await h.store.init();
    for (let i = 1; i <= 3; i++) await h.store.runBuild({ text: material(`s${i}`), courseId: null });
    const out = await h.store.parseSyllabusText("BIO 201 Syllabus\nFinal exam December 10 worth 40%");
    expect(out.ok).toBe(true);
    expect(out.buildsSpent).toBe(0);
    expect(h.store.getState().counter.builds).toBe(3);
  });
});

describe("sign in, honest failures, and spending only on success", () => {
  it("gates the first build on Sign in with Apple, then goes through", async () => {
    const h = harness({ signedIn: false });
    await h.store.init();
    expect((await h.store.runBuild({ text: material("x"), courseId: null })).status).toBe("needs-signin");
    expect(h.buildCalls).toHaveLength(0);
    await h.store.signIn();
    expect((await h.store.runBuild({ text: material("x"), courseId: null })).status).toBe("ok");
  });

  it("an unreachable server says so plainly and spends nothing", async () => {
    const h = harness({ api: { build: async () => { throw new ApiError("unreachable", "x"); } } });
    await h.store.init();
    const out = await h.store.runBuild({ text: material("down"), courseId: null });
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.message).toContain("can't reach its server");
    expect(h.store.getState().counter.builds).toBe(0);
  });

  it("a malformed server reply spends nothing", async () => {
    const h = harness({ api: { build: async () => ({ summary: "", cards: [] }) } });
    await h.store.init();
    const out = await h.store.runBuild({ text: material("bad"), courseId: null });
    expect(out.status).toBe("error");
    expect(h.store.getState().counter.builds).toBe(0);
    expect(Object.keys(h.store.getState().builds)).toHaveLength(0);
  });

  it("a server allowance limit opens the paywall and spends nothing", async () => {
    const h = harness({ api: { build: async () => { throw new ApiError("limit", "x", 429); } } });
    await h.store.init();
    expect(await h.store.runBuild({ text: material("lim"), courseId: null })).toEqual({ status: "paywall", reason: "server-limit" });
    expect(h.store.getState().counter.builds).toBe(0);
  });

  it("sends the contract body: fingerprint, text, courseName, examDate", async () => {
    const h = harness();
    await h.store.init();
    const c = await h.store.confirmCourse(draftOf("BIO 201"));
    if (!c.ok) throw new Error("course");
    await h.store.runBuild({ text: material("body"), courseId: c.course.id });
    expect(Object.keys(h.buildCalls[0]).sort()).toEqual(["courseName", "examDate", "fingerprint", "text"]);
    expect(h.buildCalls[0].courseName).toBe("BIO 201");
    expect(h.buildCalls[0].examDate).toBe("2026-12-10");
    expect(h.buildCalls[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the development mock skips the Apple gate only when the mock flag is on", async () => {
    const h = harness({ signedIn: false, mock: true });
    await h.store.init();
    expect((await h.store.runBuild({ text: material("m"), courseId: null })).status).toBe("ok");
  });
});

describe("purchases become entitlement and the Pro allowance counts down", () => {
  const future = () => new Date(2026, 11, 8).getTime();

  it("an annual purchase makes the student Pro and lifts the gate", async () => {
    const h = harness();
    await h.store.init();
    for (let i = 1; i <= 3; i++) await h.store.runBuild({ text: material(`p${i}`), courseId: null });
    expect((await h.store.runBuild({ text: material("p4"), courseId: null })).status).toBe("paywall");
    const out = await h.store.recordPurchase({ productId: PLAN_ANNUAL, transactionId: "t1", expirationDateIOS: future() });
    expect(out.kind).toBe("subscription");
    expect(h.store.isPro()).toBe(true);
    expect((await h.store.runBuild({ text: material("p4"), courseId: null })).status).toBe("ok");
  });

  it("the Pro allowance counts down as builds are spent, and the entitlement survives relaunch", async () => {
    const h = harness();
    await h.store.init();
    await h.store.recordPurchase({ productId: PLAN_MONTHLY, transactionId: "t2", expirationDateIOS: future() });
    await h.store.runBuild({ text: material("pro1"), courseId: null });
    await h.store.runBuild({ text: material("pro2"), courseId: null });
    const s = h.store.getState();
    expect(s.proUsage.used).toBe(2);
    expect(s.counter.builds).toBe(0); // Pro builds do not eat the free allowance
    expect(monthlyBuildsLeft(s.proUsage.used, s.entitlement, h.clock.now)).toBe(PRO_MONTHLY_BUILDS - 2);
    await h.store.flush();
    const again = harness({ app: h.app, chain: h.chain });
    await again.store.init();
    expect(again.store.isPro()).toBe(true);
    expect(again.store.getState().proUsage.used).toBe(2);
  });

  it("at the Pro bound the gate closes, and a Boost reopens it and is spent first-in", async () => {
    const h = harness();
    await h.store.init();
    await h.store.recordPurchase({ productId: PLAN_MONTHLY, transactionId: "t3", expirationDateIOS: future() });
    for (let i = 0; i < PRO_MONTHLY_BUILDS; i++) {
      const r = await h.store.runBuild({ text: material(`b${i}`), courseId: null });
      if (r.status !== "ok") throw new Error(`build ${i} was ${r.status}`);
    }
    expect(await h.store.runBuild({ text: material("over"), courseId: null })).toEqual({ status: "paywall", reason: "pro-exhausted" });
    await h.store.recordPurchase({ productId: BOOST_TEN, transactionId: "b1" });
    expect(h.store.getState().entitlement.boosts).toBe(10);
    const r = await h.store.runBuild({ text: material("over"), courseId: null });
    expect(r.status === "ok" && r.spent).toBe("boost");
    expect(h.store.getState().entitlement.boosts).toBe(9);
  }, 30000);

  it("a Boost lets a free student past the fourth build, once, per transaction", async () => {
    const h = harness();
    await h.store.init();
    for (let i = 1; i <= 3; i++) await h.store.runBuild({ text: material(`f${i}`), courseId: null });
    await h.store.recordPurchase({ productId: BOOST_TEN, transactionId: "same" });
    await h.store.recordPurchase({ productId: BOOST_TEN, transactionId: "same" }); // redelivered
    expect(h.store.getState().entitlement.boosts).toBe(10);
    expect((await h.store.runBuild({ text: material("f4"), courseId: null })).status).toBe("ok");
  });

  it("delete everything keeps purchases and the free count", async () => {
    const h = harness();
    await h.store.init();
    await h.store.runBuild({ text: material("keep"), courseId: null });
    await h.store.recordPurchase({ productId: BOOST_TEN, transactionId: "kept" });
    await h.store.deleteEverything();
    const s = h.store.getState();
    expect(Object.keys(s.builds)).toHaveLength(0);
    expect(s.counter.builds).toBe(1);
    expect(s.entitlement.boosts).toBe(10);
    expect(h.auth.user).toBeNull();
  });
});

describe("goodBuild fixture is accepted", () => {
  it("normalizes into all five question kinds", async () => {
    const h = harness();
    await h.store.init();
    const out = await h.store.runBuild({ text: material("kinds"), courseId: null });
    if (out.status !== "ok") throw new Error(out.status);
    expect(out.build.questions.map(q => q.kind).sort()).toEqual(["fill", "match", "mcq", "short", "tf"]);
    expect(out.build.likely).toHaveLength(1);
    expect(goodBuild({ courseName: "", examDate: null, fingerprint: "", text: "" }).facts).toHaveLength(1);
  });
});

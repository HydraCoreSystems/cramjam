import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Card } from "../components/Card";
import { openPaywall } from "../components/Paywall";
import { QuestionInput, Response, hasResponse } from "../components/QuestionInput";
import { ResultCard, ViewHandle } from "../components/ResultCard";
import { SourceBox } from "../components/SourceBox";
import { Bar, Body, Btn, Chip, Empty, H1, Kicker, Label, Note, Ring, Row, Screen } from "../components/ui";
import { bankOf } from "../core/selectors";
import { MISTAKE_REASONS, MOCK_LENGTHS, MockDifficulty, MockReport, Question, SECONDS_PER_QUESTION, checkAnswer } from "../core/study";
import { shareView } from "../services/share";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

const mmss = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.max(0, Math.floor(sec) % 60)).padStart(2, "0")}`;

export default function Mock() {
  const params = useLocalSearchParams<{ scope?: string; report?: string }>();
  const { store, state } = useApp();
  const scope = params.scope ?? "all";
  const active = state.mock.active;
  const bank = bankOf(state, scope === "all" ? "all" : scope);
  const activeBank = active ? bankOf(state, active.courseId ?? "all") : bank;
  const [length, setLength] = useState<number>(10);
  const [difficulty, setDifficulty] = useState<MockDifficulty>("mixed");
  const [idx, setIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, { resp: Response | null; conf: "sure" | "guessing" | null }>>({});
  const [phase, setPhase] = useState<"sit" | "grade">("sit");
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<MockReport | null>(() => state.mock.reports.find(r => r.id === params.report) ?? null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const expired = useRef(false);
  const cardRef = useRef<ViewHandle>(null);

  const qs: Question[] = active ? active.questionIds.map(id => activeBank.find(q => q.id === id)).filter((q): q is Question => !!q) : [];
  const remaining = active ? active.limitSec - (nowMs - active.startedAt) / 1000 : 0;

  useEffect(() => {
    if (!active || phase !== "sit") return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, phase]);

  // What the student is entering for this question: an unsaved draft, else what was saved before.
  const q = qs[idx];
  const saved = q ? active?.results[q.id] : undefined;
  const resp: Response | null = (q && drafts[q.id]?.resp) ?? ((saved?.response as Response | null) ?? null);
  const conf: "sure" | "guessing" | null = (q && drafts[q.id]?.conf) ?? saved?.confidence ?? null;
  const setResp = (r: Response) => q && setDrafts(d => ({ ...d, [q.id]: { resp: r, conf: d[q.id]?.conf ?? saved?.confidence ?? null } }));
  const setConf = (c: "sure" | "guessing") => q && setDrafts(d => ({ ...d, [q.id]: { resp: d[q.id]?.resp ?? (saved?.response as Response | null) ?? null, conf: c } }));

  const saveCurrent = () => {
    if (!q || !conf || !resp || !hasResponse(q, resp)) return;
    const ok = checkAnswer(q, resp);
    store.answerMock(q.id, resp, ok === true, conf);
  };

  const needsMarking = (): Question[] => {
    if (!active) return [];
    return qs.filter(x => {
      const r = active.results[x.id];
      if (!r || r.response == null) return false;
      return x.kind === "short" || (x.kind === "fill" && !r.correct);
    });
  };

  function toGrade() {
    saveCurrent();
    setPhase("grade");
  }

  // The clock running out ends the sitting. Whatever is answered counts; the rest is marked as time.
  useEffect(() => {
    if (active && phase === "sit" && remaining <= 0 && !expired.current) { expired.current = true; toGrade(); }
  });

  const finish = () => {
    const fresh = store.getState().mock.active;
    if (!fresh) return;
    const unanswered = qs.filter(x => fresh.results[x.id]?.response == null);
    for (const [id, ok] of Object.entries(marks)) {
      const r = fresh.results[id];
      if (r) store.answerMock(id, r.response, ok, r.confidence);
    }
    const timeUp = expired.current;
    const rep = store.finishMock(qs);
    if (rep && timeUp) for (const x of unanswered) store.markMistake(x.id, "time");
    expired.current = false;
    setPhase("sit");
    setIdx(0);
    setMarks({});
    setReport(rep);
  };

  const start = async () => {
    const out = await store.startMock(bank, scope === "all" ? null : scope, length, difficulty);
    if (!out.ok) { if (out.reason === "paywall") openPaywall("mock"); return; }
    expired.current = false;
    setIdx(0);
  };

  // Report -------------------------------------------------------------------
  if (report) {
    const missed = report.missed.map(id => bankOf(state, "all").find(x => x.id === id)).filter((x): x is Question => !!x);
    return (
      <Screen>
        <Kicker color={C.green}>MOCK EXAM REPORT</Kicker>
        <Row gap={16}>
          <Ring value={report.pct} label="SCORE" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.white, fontSize: 24, fontWeight: "900" }}>{report.correct} of {report.total} right</Text>
            <Body>Time used {mmss(report.timeUsedSec)} of {mmss(report.limitSec)}</Body>
          </View>
        </Row>
        <Card title="TOPIC BY TOPIC">
          {report.topics.map(t => (
            <View key={t.topic} style={{ gap: 4 }}>
              <Row><Text style={{ color: C.white, fontWeight: "800", flex: 1 }}>{t.topic}</Text><Text style={{ color: C.lavender }}>{t.correct}/{t.total} · {t.pct}%</Text></Row>
              <Bar pct={t.pct} color={t.pct >= 70 ? C.green : t.pct >= 40 ? C.yellow : C.red} />
            </View>
          ))}
        </Card>
        {report.calibrationGap > 0 ? <Note tone="warn" title="CALIBRATION">Some answers you marked sure did not hold up. See the calibration view for the full picture.</Note> : null}
        {missed.length ? <Label>WHAT YOU MISSED, EXPLAINED</Label> : <Note tone="good">No misses. Nicely done.</Note>}
        {missed.map(m => {
          const tagged = state.mistakes.find(x => x.questionId === m.id);
          return (
            <Card key={m.id} accent={C.red}>
              <Label>{m.topic.toUpperCase()}</Label>
              <Text style={{ color: C.white, fontWeight: "800", fontSize: 16 }}>{m.prompt}</Text>
              <Text style={{ color: C.green, fontWeight: "800" }}>Answer: {m.answer}</Text>
              {m.reason ? <Body color={C.white}>{m.reason}</Body> : null}
              <SourceBox buildId={m.id.split(":")[0]} pointer={m.source} />
              {tagged && !tagged.clearedAt ? (
                <Note tone="info">In your Mistake Book as: {MISTAKE_REASONS.find(r => r.id === tagged.reason)?.label}</Note>
              ) : (
                <>
                  <Label>WHY DID YOU MISS IT?</Label>
                  <Row wrap gap={8}>{MISTAKE_REASONS.map(r => <Chip key={r.id} label={r.label} onPress={() => store.tagMockMiss(m.id, r.id)} />)}</Row>
                </>
              )}
            </Card>
          );
        })}
        <Label>SHARE YOUR RESULT</Label>
        <ResultCard viewRef={cardRef} headline="MOCK EXAM" big={`${report.pct}%`} foot={`${report.correct} of ${report.total} right`} />
        <Btn kind="violet" label="SHARE RESULT CARD" onPress={async () => { try { await shareView(cardRef); } catch { Alert.alert("Could not share", "The result card could not be shared."); } }} />
        <Btn label="DRILL MY MISSES" onPress={() => router.replace({ pathname: "/study", params: { mode: "drill", scope: report.courseId ?? "all" } })} />
        <Btn kind="ghost" label="DONE" onPress={() => { setReport(null); router.replace("/"); }} />
      </Screen>
    );
  }

  // Grade the answers only the student can judge -------------------------------
  if (active && phase === "grade") {
    const list = needsMarking();
    const allMarked = list.every(x => marks[x.id] !== undefined);
    return (
      <Screen back={false}>
        <Kicker>BEFORE YOUR REPORT</Kicker>
        <H1>Mark your written answers</H1>
        <Body>Compare each with the model answer. Only you know what you meant.</Body>
        {!list.length ? <Note tone="good">Nothing needs marking. Everything else was checked automatically.</Note> : null}
        {list.map(x => {
          const r = active.results[x.id];
          return (
            <Card key={x.id} accent={marks[x.id] === undefined ? C.yellow : marks[x.id] ? C.green : C.red}>
              <Text style={{ color: C.white, fontWeight: "800" }}>{x.prompt}</Text>
              <Body>You wrote: {typeof r?.response === "string" ? r.response : ""}</Body>
              <Text style={{ color: C.green, fontWeight: "800" }}>Answer: {x.answer}</Text>
              <Row>
                <View style={{ flex: 1 }}><Btn small kind={marks[x.id] === false ? "danger" : "ghost"} label="I MISSED IT" onPress={() => setMarks(m => ({ ...m, [x.id]: false }))} /></View>
                <View style={{ flex: 1 }}><Btn small kind={marks[x.id] === true ? "green" : "ghost"} label="I GOT IT" onPress={() => setMarks(m => ({ ...m, [x.id]: true }))} /></View>
              </Row>
            </Card>
          );
        })}
        <Btn label="SEE MY REPORT" disabled={!allMarked} onPress={finish} />
      </Screen>
    );
  }
  // Sitting the exam -----------------------------------------------------------
  if (active && q) {
    const answered = qs.filter(x => active.results[x.id]?.response != null).length;
    const canSave = !!resp && hasResponse(q, resp) && !!conf;
    const goNext = () => { saveCurrent(); if (idx + 1 < qs.length) setIdx(idx + 1); };
    const end = () => {
      saveCurrent();
      const left = qs.length - answered - (canSave && active.results[q.id]?.response == null ? 1 : 0);
      if (left > 0) Alert.alert("Finish the exam?", `${left} question${left === 1 ? " is" : "s are"} unanswered and will count as missed.`, [{ text: "Keep going", style: "cancel" }, { text: "Finish", onPress: toGrade }]);
      else toGrade();
    };
    return (
      <Screen back={false}>
        <Row>
          <View style={{ flex: 1 }}><Kicker>{`QUESTION ${idx + 1} OF ${qs.length}`}</Kicker></View>
          <Text style={{ color: remaining < 60 ? C.red : C.yellow, fontSize: 28, fontWeight: "900" }} accessibilityLabel={`Time left ${mmss(remaining)}`}>{mmss(remaining)}</Text>
        </Row>
        <Bar pct={((idx + 1) / qs.length) * 100} color={C.violet} />
        <Label>{q.topic.toUpperCase()}</Label>
        <View style={{ backgroundColor: C.paper, borderWidth: 4, borderColor: C.violet, borderRadius: 28, padding: 22 }}>
          <Text style={{ color: C.white, fontSize: 21, fontWeight: "800", lineHeight: 30 }}>{q.prompt}</Text>
        </View>
        <QuestionInput q={q} value={resp} onChange={setResp} />
        <Label>HOW CERTAIN ARE YOU?</Label>
        <Row><Chip label="GUESSING" selected={conf === "guessing"} onPress={() => setConf("guessing")} /><Chip label="SURE" selected={conf === "sure"} onPress={() => setConf("sure")} /></Row>
        <Row>
          <View style={{ flex: 1 }}><Btn kind="ghost" label="BACK" disabled={idx === 0} onPress={() => { saveCurrent(); setIdx(idx - 1); }} /></View>
          <View style={{ flex: 1 }}><Btn label={idx + 1 < qs.length ? "SAVE & NEXT" : "SAVE"} disabled={!canSave} onPress={goNext} /></View>
        </Row>
        <Btn kind="violet" label={`FINISH EXAM (${answered} ANSWERED)`} onPress={end} />
        <Note tone="info">No feedback until the report. Answers you save count; the clock is running.</Note>
      </Screen>
    );
  }

  // Setup ----------------------------------------------------------------------
  const free = !store.isPro();
  const used = state.counter.mocks >= 1;
  return (
    <Screen>
      <Kicker>TIMED MOCK EXAM</Kicker>
      <H1>Sit a mock exam</H1>
      <Body>Built from your own questions, so it costs no Study Build. You get a graded report card topic by topic.</Body>
      {!bank.length ? (
        <Empty title="No questions yet" body="Make a Study Build first. A mock exam is assembled from its questions." action={<Btn label="MAKE A STUDY BUILD" onPress={() => router.replace("/build")} />} />
      ) : (
        <>
          <Label>LENGTH</Label>
          <Row wrap>{MOCK_LENGTHS.map(n => <Chip key={n} label={`${n} QUESTIONS`} selected={Math.min(length, bank.length) === Math.min(n, bank.length)} onPress={() => setLength(n)} />)}</Row>
          <Label>DIFFICULTY</Label>
          <Row wrap>{(["easy", "mixed", "hard"] as MockDifficulty[]).map(d => <Chip key={d} label={d.toUpperCase()} selected={difficulty === d} onPress={() => setDifficulty(d)} />)}</Row>
          <Body>{`${Math.min(length, bank.length)} questions, ${mmss(Math.min(length, bank.length) * SECONDS_PER_QUESTION[difficulty])} on the clock.`}</Body>
          {free ? <Note tone={used ? "warn" : "info"}>{used ? "You've used your free mock exam. More mock exams are part of CramJam Pro." : "Your first mock exam is free. Unlimited mock exams are part of CramJam Pro."}</Note> : null}
          <Btn label="START THE CLOCK" onPress={start} />
        </>
      )}
      {state.mock.reports.length ? (
        <>
          <Label>PAST REPORTS</Label>
          {[...state.mock.reports].reverse().slice(0, 5).map(r => (
            <Btn key={r.id} kind="ghost" label={`${new Date(r.at).toLocaleDateString()} · ${r.pct}% · ${r.correct}/${r.total}`} onPress={() => setReport(r)} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

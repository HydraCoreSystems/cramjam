import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "../components/Card";
import { QuestionInput, Response, hasResponse } from "../components/QuestionInput";
import { SourceBox } from "../components/SourceBox";
import { Badge, Body, Btn, Chip, Empty, Kicker, Label, Note, Row, Screen } from "../components/ui";
import { bankOf, courseReadiness, weakFor } from "../core/selectors";
import { MISTAKE_REASONS, Question, assembleMock, checkAnswer, dueRetests, drillQueue, openMistakes } from "../core/study";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

type Mode = "drill" | "warmup" | "retest" | "practice";
const TITLE: Record<Mode, string> = { drill: "WEAK SPOT", warmup: "DAILY FIVE", retest: "RETEST", practice: "PRACTICE" };
type Stage = "answer" | "selfmark" | "feedback";

/**
 * One question at a time, answer then confidence. Runs off the local question bank, so no AI
 * and no Study Build is ever spent here.
 */
export default function Study() {
  const params = useLocalSearchParams<{ mode?: string; scope?: string; build?: string; all?: string }>();
  const mode = (["drill", "warmup", "retest", "practice"].includes(params.mode ?? "") ? params.mode : "drill") as Mode;
  const scope = params.scope ?? "all";
  const { store, state } = useApp();

  // The queue is fixed when the screen opens, so it does not reshuffle while the student answers.
  const [qs] = useState<Question[]>(() => {
    const bank = params.build ? state.builds[params.build]?.questions ?? [] : bankOf(state, scope === "all" ? "all" : scope);
    const now = Date.now();
    if (mode === "drill") return drillQueue(bank, state.mistakes, weakFor(state, scope === "all" ? "all" : scope), 10);
    if (mode === "warmup") return assembleMock(bank, 5, "mixed", Math.floor(now / 86_400_000));
    if (mode === "retest") {
      const ids = new Set((params.all ? openMistakes(state.mistakes) : dueRetests(state.mistakes, now)).map(m => m.questionId));
      return bank.filter(q => ids.has(q.id));
    }
    return assembleMock(bank, Math.min(15, bank.length), "mixed", now);
  });

  const [i, setI] = useState(0);
  const [resp, setResp] = useState<Response | null>(null);
  const [stage, setStage] = useState<Stage>("answer");
  const [conf, setConf] = useState<"sure" | "guessing">("sure");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [needsReason, setNeedsReason] = useState(false);
  const [tagged, setTagged] = useState(false);
  const [score, setScore] = useState({ right: 0, total: 0 });

  const q = qs[i];
  const kind = q?.kind ?? "short";

  if (!qs.length) {
    return (
      <Screen>
        <Empty
          title={mode === "retest" ? "No retests due" : "Nothing to drill yet"}
          body={mode === "retest" ? "Missed questions retest themselves a week after you miss them. Nothing is waiting right now." : "Make a Study Build and its questions will be here. Drills run on your own questions and cost nothing."}
          action={<Btn label={mode === "retest" ? "BACK" : "MAKE A STUDY BUILD"} onPress={() => (mode === "retest" ? router.back() : router.replace("/build"))} />}
        />
      </Screen>
    );
  }

  if (!q) {
    const ready = courseReadiness(state, scope === "all" ? "all" : scope);
    return (
      <Screen>
        <Kicker color={C.green}>{TITLE[mode]} DONE</Kicker>
        <Text style={s.big}>{score.right} of {score.total} right</Text>
        <Body>{ready == null ? "" : `Readiness is now ${ready}. It moves only with answers you actually get right.`}</Body>
        <Btn label="DRILL AGAIN" onPress={() => router.replace({ pathname: "/study", params: { mode: "drill", scope } })} />
        <Btn kind="ghost" label="MISTAKE BOOK" onPress={() => router.replace("/mistakes")} />
        <Btn kind="ghost" label="HOME" onPress={() => router.replace("/")} />
      </Screen>
    );
  }

  const record = (ok: boolean, c: "sure" | "guessing") => {
    const r = store.recordAnswer(q, ok, c, mode === "drill" ? "drill" : mode === "warmup" ? "warmup" : mode === "retest" ? "retest" : "practice");
    setCorrect(ok);
    setNeedsReason(r.needsReason);
    setTagged(false);
    setScore(x => ({ right: x.right + (ok ? 1 : 0), total: x.total + 1 }));
    setStage("feedback");
  };

  const submit = (c: "sure" | "guessing") => {
    setConf(c);
    if (kind === "short") { setStage("selfmark"); return; }
    const ok = checkAnswer(q, resp ?? "");
    if (ok) record(true, c);
    else if (kind === "fill") setStage("selfmark");
    else record(false, c);
  };

  const next = () => { setI(x => x + 1); setResp(null); setStage("answer"); setCorrect(null); setNeedsReason(false); };
  const canSubmit = hasResponse(q, resp) || kind === "short";

  return (
    <Screen backLabel="HOME">
      <Kicker>{`${TITLE[mode]} ${i + 1} OF ${qs.length}`}</Kicker>
      <Text style={s.topic}>{q.topic.toUpperCase()}</Text>
      <Row gap={8}>{q.kind ? <Badge text={{ mcq: "MULTIPLE CHOICE", tf: "TRUE OR FALSE", short: "SHORT ANSWER", fill: "FILL IN THE BLANK", match: "MATCHING" }[q.kind]} /> : null}</Row>
      <View style={s.card}>
        <Text style={s.q}>{q.prompt}</Text>
        {q.source && stage === "answer" ? <Text style={s.source}>Source: {q.source.label}</Text> : null}
      </View>

      {stage === "answer" ? (
        <>
          <QuestionInput q={q} value={resp} onChange={setResp} />
          <Label>HOW CERTAIN ARE YOU?</Label>
          <Row>
            <View style={{ flex: 1 }}><Btn kind="ghost" label="GUESSING" disabled={!canSubmit} onPress={() => submit("guessing")} /></View>
            <View style={{ flex: 1 }}><Btn label="SURE" disabled={!canSubmit} onPress={() => submit("sure")} /></View>
          </Row>
        </>
      ) : null}

      {stage === "selfmark" ? (
        <Card title={kind === "fill" ? "NOT AN EXACT MATCH" : "COMPARE WITH THE MODEL ANSWER"} accent={C.yellow}>
          {typeof resp === "string" && resp.trim() ? <Body>You wrote: {resp}</Body> : null}
          <Text style={s.ans}>Answer: {q.answer}</Text>
          {q.reason ? <Body>{q.reason}</Body> : null}
          <Body color={C.white}>{kind === "fill" ? "Different wording can still be right. You decide." : "Short answers are marked by you, because only you know what you meant."}</Body>
          <Row>
            <View style={{ flex: 1 }}><Btn kind="danger" label="I MISSED IT" onPress={() => record(false, conf)} /></View>
            <View style={{ flex: 1 }}><Btn kind="green" label={kind === "fill" ? "I HAD IT" : "I GOT IT"} onPress={() => record(true, conf)} /></View>
          </Row>
        </Card>
      ) : null}

      {stage === "feedback" ? (
        <>
          <Card title={correct ? "RIGHT" : "NOT QUITE"} accent={correct ? C.green : C.red}>
            <Text style={s.ans}>Answer: {q.answer}</Text>
            {q.reason ? <Body color={C.white}>{q.reason}</Body> : null}
            <SourceBox buildId={q.id.split(":")[0]} pointer={q.source} />
            {conf === "sure" && !correct ? <Note tone="warn">You were sure on this one. That is the gap to close.</Note> : null}
          </Card>
          {!correct && needsReason ? (
            <>
              <Label>WHY DID YOU MISS IT? THIS GOES IN YOUR MISTAKE BOOK.</Label>
              <Row wrap gap={8}>
                {MISTAKE_REASONS.map(r => <Chip key={r.id} label={r.label} selected={false} onPress={() => { store.markMistake(q.id, r.id); setTagged(true); setNeedsReason(false); }} />)}
              </Row>
            </>
          ) : null}
          {tagged ? <Note tone="info">Saved to your Mistake Book. It retests itself in a week.</Note> : null}
          <Btn label={i + 1 >= qs.length ? "FINISH" : "NEXT"} disabled={!correct && needsReason} onPress={next} />
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  big: { color: C.white, fontSize: 36, fontWeight: "900" },
  topic: { color: C.white, fontSize: 28, fontWeight: "900" },
  card: { backgroundColor: C.paper, borderWidth: 4, borderColor: C.violet, borderRadius: 28, padding: 22, gap: 14 },
  q: { color: C.white, fontSize: 22, fontWeight: "800", lineHeight: 31 },
  source: { color: C.lavender },
  ans: { color: C.green, fontWeight: "900", fontSize: 16 },
});

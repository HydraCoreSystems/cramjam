import { router } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { Card } from "../components/Card";
import { SourceBox } from "../components/SourceBox";
import { Badge, Body, Btn, Chip, Empty, H1, Kicker, Label, Note, Row, Screen } from "../components/ui";
import { formatDay } from "../core/dates";
import { bankOf } from "../core/selectors";
import { MISTAKE_REASONS, Mistake, dueRetests, openMistakes } from "../core/study";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

/** Every missed question, with the reason the student picked. The book retests itself weekly. */
export default function Mistakes() {
  const { store, state, now } = useApp();
  const bank = bankOf(state, "all");
  const byId = new Map(bank.map(q => [q.id, q]));
  const open = openMistakes(state.mistakes).filter(m => byId.has(m.questionId));
  const due = dueRetests(state.mistakes, now).filter(m => byId.has(m.questionId));
  const cleared = state.mistakes.filter(m => m.clearedAt).length;
  const [shown, setShown] = useState<string | null>(null);

  const row = (m: Mistake) => {
    const q = byId.get(m.questionId)!;
    const isDue = m.retestAt <= now;
    return (
      <Card key={m.questionId} accent={isDue ? C.yellow : C.violet}>
        <Row gap={8}>
          <Badge text={MISTAKE_REASONS.find(r => r.id === m.reason)?.label ?? ""} />
          <Badge text={isDue ? "RETEST DUE" : `RETEST ${formatDay(m.retestAt).toUpperCase()}`} color={isDue ? C.yellow : C.dim} ink={isDue ? C.ink : C.white} />
        </Row>
        <Label>{q.topic.toUpperCase()}</Label>
        <Text style={{ color: C.white, fontWeight: "800", fontSize: 16 }}>{q.prompt}</Text>
        {shown === m.questionId ? (
          <>
            <Text style={{ color: C.green, fontWeight: "800" }}>Answer: {q.answer}</Text>
            {q.reason ? <Body color={C.white}>{q.reason}</Body> : null}
            <SourceBox buildId={q.id.split(":")[0]} pointer={q.source} />
            <Label>CHANGE THE REASON</Label>
            <Row wrap gap={8}>{MISTAKE_REASONS.map(r => <Chip key={r.id} label={r.label} selected={m.reason === r.id} onPress={() => store.markMistake(m.questionId, r.id)} />)}</Row>
          </>
        ) : null}
        <Btn small kind="ghost" label={shown === m.questionId ? "HIDE" : "SHOW ANSWER"} onPress={() => setShown(shown === m.questionId ? null : m.questionId)} />
      </Card>
    );
  };

  return (
    <Screen>
      <Kicker>MISTAKE BOOK</Kicker>
      <H1>What you've missed</H1>
      <Body>Each miss comes back for a retest a week later. Get it right and it leaves the book. Always free.</Body>
      {!state.mistakes.length ? (
        <Empty title="No mistakes yet" body="When you miss a question in a drill or mock exam, you pick why, and it lands here." action={<Btn label="START A DRILL" onPress={() => router.replace({ pathname: "/study", params: { mode: "drill" } })} />} />
      ) : (
        <>
          {due.length ? <Btn label={`RETEST WHAT'S DUE (${due.length})`} onPress={() => router.push({ pathname: "/study", params: { mode: "retest" } })} /> : <Note tone="good">Nothing is due for a retest right now.</Note>}
          {open.length ? <Btn kind="ghost" label={`RETEST ALL OPEN (${open.length})`} onPress={() => router.push({ pathname: "/study", params: { mode: "retest", all: "1" } })} /> : null}
          {cleared ? <Label>{`${cleared} CLEARED`}</Label> : null}
          {open.length ? <Label>{`OPEN (${open.length})`}</Label> : null}
          {[...open].sort((a, b) => a.retestAt - b.retestAt).map(row)}
          {!open.length ? <Note tone="good">Every mistake is cleared. Nice.</Note> : null}
        </>
      )}
    </Screen>
  );
}

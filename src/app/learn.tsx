import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Card } from "../components/Card";
import { openPaywall } from "../components/Paywall";
import { SignIn } from "../components/SignIn";
import { Body, Btn, Chip, Field, H1, Kicker, Label, Note, Row, Screen } from "../components/ui";
import { weakFor } from "../core/selectors";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

type Result = { answer: string; pointers: { label: string; quote?: string }[] };

/**
 * Teach Back and Ask My Notes. Both go through CramJam's server. When it can't be reached the app
 * says so. Nothing here imitates grading or tutoring on the device.
 */
export default function Learn() {
  const params = useLocalSearchParams<{ mode?: string; scope?: string }>();
  const { store, state } = useApp();
  const [mode, setMode] = useState<"teachback" | "tutor">(params.mode === "tutor" ? "tutor" : "teachback");
  const [scope, setScope] = useState<string>(params.scope ?? (state.courses.length === 1 ? state.courses[0].id : "all"));
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);

  const course = state.courses.find(c => c.id === scope);
  const topics = [...new Set([...weakFor(state, scope === "all" ? "all" : scope), ...(course?.items.filter(i => i.kind === "topic").map(i => i.label) ?? [])])].slice(0, 8);
  const hasMaterial = Object.values(state.builds).length > 0;
  const ready = mode === "teachback" ? text.trim().length > 20 && topic.trim().length > 1 : text.trim().length > 3;

  const run = async () => {
    setBusy(true); setErr(null); setRes(null); setNeedSignIn(false);
    const out = await store.ask(mode, { text: text.trim(), topic: topic.trim(), courseId: scope === "all" ? null : scope });
    setBusy(false);
    if (out.status === "ok") setRes({ answer: out.answer, pointers: out.pointers });
    else if (out.status === "needs-signin") setNeedSignIn(true);
    else if (out.status === "paywall") openPaywall(out.reason);
    else setErr(out.message);
  };

  return (
    <Screen>
      <Kicker>LEARNING MODES</Kicker>
      <H1>{mode === "teachback" ? "Teach it back" : "Ask my notes"}</H1>
      <Row>
        <Chip label="TEACH BACK" selected={mode === "teachback"} onPress={() => { setMode("teachback"); setRes(null); setErr(null); }} />
        <Chip label="ASK MY NOTES" selected={mode === "tutor"} onPress={() => { setMode("tutor"); setRes(null); setErr(null); }} />
      </Row>
      {!hasMaterial ? <Note tone="warn">Build a study set first. Both modes work from your own material.</Note> : null}
      {state.courses.length > 1 ? (
        <>
          <Label>WHICH CLASS</Label>
          <Row wrap><Chip label="ALL" selected={scope === "all"} onPress={() => setScope("all")} />{state.courses.map(c => <Chip key={c.id} label={c.name} selected={scope === c.id} onPress={() => setScope(c.id)} />)}</Row>
        </>
      ) : null}

      {mode === "teachback" ? (
        <>
          <Body>Explain a topic in your own words, the Feynman way. CramJam checks it against your material and tells you what you left out. To explain out loud, use the microphone key on your keyboard.</Body>
          {topics.length ? <Row wrap>{topics.map(t => <Chip key={t} label={t} selected={topic === t} onPress={() => setTopic(t)} />)}</Row> : null}
          <Field label="TOPIC" value={topic} onChangeText={setTopic} placeholder="What are you explaining?" />
          <Field label="YOUR EXPLANATION" value={text} onChangeText={setText} multiline placeholder="Explain it as if teaching a friend" style={{ minHeight: 180 }} />
        </>
      ) : (
        <>
          <Body>A tutor that answers only from your own material and points to the passage. If your notes don't cover it, it says so.</Body>
          <Field label="YOUR QUESTION" value={text} onChangeText={setText} multiline placeholder="Ask about something in your notes" />
        </>
      )}

      <Note tone="info" title="WHERE THIS GOES">{mode === "teachback" ? "Your explanation and the matching passages of your notes are sent to CramJam's AI service to be checked. They are processed for that request and not kept on our server afterward." : "Your question and the few most relevant passages of your notes are sent to CramJam's AI service. They are processed for that request and not kept on our server afterward."}</Note>
      {needSignIn ? <SignIn onDone={run} /> : null}
      {err ? <Note tone="bad" title="NOT ANSWERED">{err}</Note> : null}
      <Btn label={mode === "teachback" ? "GRADE MY EXPLANATION" : "ASK"} onPress={run} busy={busy} disabled={!ready || !hasMaterial} />

      {res ? (
        <Card title={mode === "teachback" ? "HOW YOU DID" : "ANSWER"} accent={C.green}>
          <Text style={{ color: C.white, fontSize: 16, lineHeight: 25 }}>{res.answer}</Text>
          {res.pointers.length ? (
            <View style={{ gap: 8 }}>
              <Label>FROM YOUR NOTES</Label>
              {res.pointers.map((p, i) => (
                <View key={i} style={{ backgroundColor: C.ink, borderRadius: 14, padding: 12, borderWidth: 2, borderColor: C.dim }}>
                  <Text style={{ color: C.yellow, fontWeight: "800", fontSize: 12 }}>{p.label.toUpperCase()}</Text>
                  {p.quote ? <Text style={{ color: C.lavender, lineHeight: 21 }}>“{p.quote}”</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

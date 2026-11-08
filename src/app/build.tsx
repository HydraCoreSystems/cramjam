import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Text } from "react-native";
import { Card } from "../components/Card";
import { openPaywall } from "../components/Paywall";
import { SignIn } from "../components/SignIn";
import { Body, Btn, Chip, Field, H1, Kicker, Label, Note, Row, Screen } from "../components/ui";
import { guessCourseForText } from "../core/intakeMatch";
import { MAX_BUILD_CHARS, MIN_BUILD_CHARS, capText } from "../core/limits";
import { allowanceView } from "../core/selectors";
import { fromFile, fromPhoto } from "../services/intake";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

export default function Build() {
  const { store, state, now } = useApp();
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [label, setLabel] = useState("");
  const [courseId, setCourseId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "warn" | "info"; text: string } | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);

  const topicOnly = text.trim().length === 0 && topic.trim().length > 1;
  const material = topicOnly ? `Topic: ${topic.trim()}` : text;
  const capped = useMemo(() => capText(material, MAX_BUILD_CHARS), [material]);
  const guess = useMemo(() => guessCourseForText(material, state.courses), [material, state.courses]);
  const chosen = courseId === undefined ? guess : courseId;
  const needsPick = state.courses.length > 1 && chosen == null;
  const enough = topicOnly || capped.text.length >= MIN_BUILD_CHARS;
  const allowance = allowanceView(state, now);

  const take = async (r: Awaited<ReturnType<typeof fromFile>>) => {
    if (!r.ok) { if (!r.cancelled) setMsg({ tone: "warn", text: r.message }); return; }
    setMsg(null);
    setText(prev => (prev.trim() ? `${prev.trim()}\n\n${r.text}` : r.text));
    setLabel(r.label);
  };

  const go = async () => {
    setBusy(true);
    setMsg(null);
    setNeedSignIn(false);
    const out = await store.runBuild({ text: material, courseId: chosen ?? null });
    setBusy(false);
    switch (out.status) {
      case "ok":
      case "cached": router.replace({ pathname: "/builds/[id]", params: { id: out.build.id } }); return;
      case "paywall": openPaywall(out.reason); return;
      case "needs-signin": setNeedSignIn(true); return;
      case "busy": return;
      default: setMsg({ tone: out.status === "invalid" ? "warn" : "bad", text: out.message });
    }
  };

  return (
    <Screen>
      <Kicker>STUDY BUILD</Kicker>
      <H1>Make a Study Build</H1>
      <Body>One source becomes a summary, flashcards, a practice quiz, likely questions, and a facts sheet. One build, one pass.</Body>

      {state.courses.length === 0 ? (
        <Note tone="info" title="NO CLASS YET">Builds can stand alone, but your course dates, plan and weak spot report work best once you add a syllabus. Syllabus setup is free.</Note>
      ) : (
        <>
          <Label>FILE IT UNDER</Label>
          <Row wrap>
            {state.courses.map(c => <Chip key={c.id} label={c.name} selected={chosen === c.id} onPress={() => setCourseId(c.id)} />)}
            <Chip label="NO CLASS" selected={chosen === null && courseId === null} onPress={() => setCourseId(null)} color={C.violet} />
          </Row>
          {guess && courseId === undefined ? <Body>Filed under your class automatically. Change it above if that is wrong.</Body> : null}
          {needsPick ? <Note tone="warn">Pick which class this belongs to.</Note> : null}
        </>
      )}

      <Card title="ADD YOUR MATERIAL" accent={C.yellow}>
        <Btn label="PHOTO OF NOTES" onPress={async () => take(await fromPhoto("camera"))} />
        <Btn kind="violet" label="PHOTOS FROM LIBRARY" onPress={async () => take(await fromPhoto("library"))} />
        <Btn kind="ghost" label="TEXT FILE OR SCREENSHOT" onPress={async () => take(await fromFile())} />
        <Body>Text is read on your device. Only the text is sent, never the photo.</Body>
      </Card>
      <Card title="PASTE TEXT">
        <Field multiline value={text} onChangeText={t => { setText(t); setLabel(""); }} placeholder="Paste your notes or slide text" style={{ minHeight: 160 }} />
        {label ? <Label>{`LOADED: ${label.toUpperCase()}`}</Label> : null}
      </Card>
      <Card title="OR TYPE A TOPIC">
        <Field value={topic} onChangeText={setTopic} placeholder="Example: the Krebs cycle" />
        {topicOnly ? <Note tone="warn">With a topic and no material, the set comes from general knowledge, not from your class. Add your notes for questions that match your exam.</Note> : null}
      </Card>
      <Card title="COMING LATER">
        <Text style={{ color: C.lavender, lineHeight: 21 }}>PDF and slide files need a reader CramJam does not have yet. Photograph the pages or paste the text. Lecture audio recording is not in this version.</Text>
      </Card>

      <Note tone="info" title="WHERE YOUR MATERIAL GOES">To make your study set, the text of your material is sent to CramJam's AI service. It is processed for that request and not kept on our server afterward.</Note>
      {capped.truncated ? <Note tone="warn">Your material is {capped.originalLength.toLocaleString()} characters. CramJam uses the first {capped.text.length.toLocaleString()}. Split the rest into a second build.</Note> : null}
      {msg ? <Note tone={msg.tone} title={msg.tone === "bad" ? "NOTHING WAS SPENT" : undefined}>{msg.text}</Note> : null}
      {needSignIn ? <SignIn onDone={go} /> : null}
      <Btn label={allowance.pro ? "BUILD IT" : "BUILD IT (USES 1 STUDY BUILD)"} onPress={go} busy={busy} disabled={!enough || needsPick} />
      <Label>{allowance.text.toUpperCase()}</Label>
      <Body>Identical material you have already built opens instantly and costs nothing.</Body>
    </Screen>
  );
}

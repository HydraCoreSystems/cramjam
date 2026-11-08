import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Card } from "../../components/Card";
import { openPaywall } from "../../components/Paywall";
import { SignIn } from "../../components/SignIn";
import { SourceBox } from "../../components/SourceBox";
import { Badge, Body, Btn, Chip, Empty, H1, Kicker, Label, Md, Note, Row, Screen } from "../../components/ui";
import { Fact, speakableSummary, summarySections } from "../../core/build";
import { QuestionKind } from "../../core/study";
import { printHtml, shareDeckFile } from "../../services/share";
import { speak, stopSpeaking } from "../../services/speech";
import { useApp } from "../../state/AppProvider";
import { C } from "../../theme";

type Tab = "summary" | "cards" | "quiz" | "facts" | "likely";
const KIND: Record<QuestionKind, string> = { mcq: "MULTIPLE CHOICE", tf: "TRUE OR FALSE", short: "SHORT ANSWER", fill: "FILL IN THE BLANK", match: "MATCHING" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const factsHtml = (title: string, facts: Fact[]) =>
  `<html><body style="font-family:-apple-system,Helvetica;padding:24px"><h1>${esc(title)}: facts and formulas</h1>${(["formula", "date", "definition", "name", "fact"] as const)
    .map(k => { const g = facts.filter(f => f.kind === k); return g.length ? `<h2>${k.toUpperCase()}S</h2><table style="width:100%;border-collapse:collapse">${g.map(f => `<tr><td style="border-bottom:1px solid #ccc;padding:6px;width:35%"><b>${esc(f.label)}</b></td><td style="border-bottom:1px solid #ccc;padding:6px">${esc(f.value)}</td></tr>`).join("")}</table>` : ""; })
    .join("")}</body></html>`;

export default function BuildView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, state } = useApp();
  const build = state.builds[String(id)];
  const [tab, setTab] = useState<Tab>("summary");
  const [simpler, setSimpler] = useState<Record<number, string[]>>({});
  const [busySec, setBusySec] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => () => stopSpeaking(), []);

  if (!build) return <Screen><Empty title="That study set isn't here" body="It may have been deleted." action={<Btn label="GO HOME" onPress={() => router.replace("/")} />} /></Screen>;

  const sections = summarySections(build.summary);
  const course = state.courses.find(c => c.id === build.courseId);

  const makeSimpler = async (i: number) => {
    setBusySec(i);
    setErr(null);
    setNeedSignIn(null);
    const levels = simpler[i] ?? [];
    const current = levels.length ? levels[levels.length - 1] : sections[i].body;
    const out = await store.ask("simpler", { text: current, courseId: build.courseId });
    setBusySec(null);
    if (out.status === "ok") setSimpler(p => ({ ...p, [i]: [...(p[i] ?? []), out.answer] }));
    else if (out.status === "needs-signin") setNeedSignIn(i);
    else if (out.status === "paywall") openPaywall(out.reason);
    else setErr(out.message);
  };

  const audio = () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    speak(speakableSummary(build.summary), () => setSpeaking(false));
  };

  const share = async () => {
    const json = await store.exportDeckFile(build.id);
    if (!json) return;
    const ok = await shareDeckFile(build.title, json).catch(() => false);
    if (!ok) Alert.alert("Sharing isn't available", "This device can't open the share sheet.");
  };

  const del = () => Alert.alert("Delete this study set?", "Its cards, questions and source text are removed from this device. Your Study Build count does not change.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { store.deleteBuild(build.id); router.replace("/"); } },
  ]);

  return (
    <Screen>
      <Kicker>{build.origin === "imported" ? "SHARED DECK" : "STUDY SET"}</Kicker>
      <H1>{build.title}</H1>
      {course ? <Body>{course.name}</Body> : null}
      <Row wrap gap={8}>
        {(["summary", "cards", "quiz", "facts", "likely"] as Tab[]).map(t => (
          <Chip key={t} selected={tab === t} onPress={() => setTab(t)} label={t === "summary" ? "SUMMARY" : t === "cards" ? `CARDS ${build.cards.length}` : t === "quiz" ? `QUIZ ${build.questions.length}` : t === "facts" ? `FACTS ${build.facts.length}` : `LIKELY ${build.likely.length}`} />
        ))}
      </Row>

      {tab === "summary" ? (
        <>
          <Btn kind={speaking ? "danger" : "violet"} label={speaking ? "STOP AUDIO" : "AUDIO REVIEW (READ ALOUD)"} onPress={audio} />
          {sections.map((sec, i) => (
            <Card key={i} title={sec.heading} accent={C.violet}>
              <Md text={sec.body} />
              {(simpler[i] ?? []).map((t, k) => (
                <View key={k} style={{ gap: 6, backgroundColor: C.ink, borderRadius: 14, padding: 12 }}>
                  <Label>{k === 0 ? "SIMPLER" : `SIMPLER STILL ${k}`}</Label>
                  <Text style={{ color: C.white, lineHeight: 22 }}>{t}</Text>
                </View>
              ))}
              {needSignIn === i ? <SignIn onDone={() => makeSimpler(i)} /> : null}
              <Btn small kind="ghost" label={(simpler[i] ?? []).length ? "SIMPLER STILL" : "EXPLAIN IT SIMPLER"} busy={busySec === i} onPress={() => makeSimpler(i)} />
            </Card>
          ))}
          {err ? <Note tone="bad">{err}</Note> : null}
          <Note tone="info">Explain It Simpler sends that section to CramJam's AI service. It is processed for that request and not kept.</Note>
        </>
      ) : null}

      {tab === "cards" ? (
        <>
          <Btn label="REVIEW THESE CARDS" onPress={() => router.push({ pathname: "/review", params: { build: build.id } })} />
          {build.cards.slice(0, 60).map(c => (
            <Card key={c.id}>
              <Label>{c.topic.toUpperCase()}</Label>
              <Text style={{ color: C.white, fontWeight: "800", fontSize: 16 }}>{c.front}</Text>
              <Text style={{ color: C.lavender, lineHeight: 21 }}>{c.back}</Text>
            </Card>
          ))}
          {build.cards.length > 60 ? <Body>Showing 60 of {build.cards.length}. Review mode covers them all.</Body> : null}
          {!build.cards.length ? <Empty title="No cards in this set" body="This study set came back without flashcards." /> : null}
        </>
      ) : null}

      {tab === "quiz" ? (
        <>
          <Btn label="PRACTICE THIS QUIZ" onPress={() => router.push({ pathname: "/study", params: { mode: "practice", build: build.id } })} />
          {build.questions.map(q => (
            <Card key={q.id}>
              <Row wrap gap={6}><Badge text={KIND[q.kind ?? "short"]} /><Label>{q.topic.toUpperCase()}</Label></Row>
              <Text style={{ color: C.white, fontWeight: "800", fontSize: 16 }}>{q.prompt}</Text>
              {open === q.id ? (
                <>
                  <Text style={{ color: C.green, fontWeight: "800" }}>Answer: {q.answer}</Text>
                  {q.reason ? <Text style={{ color: C.lavender, lineHeight: 21 }}>{q.reason}</Text> : null}
                  <SourceBox buildId={build.origin === "imported" ? null : build.id} pointer={q.source} />
                </>
              ) : null}
              <Btn small kind="ghost" label={open === q.id ? "HIDE ANSWER" : "SHOW ANSWER"} onPress={() => setOpen(open === q.id ? null : q.id)} />
            </Card>
          ))}
          {!build.questions.length ? <Empty title="No questions in this set" body="This study set came back without practice questions." /> : null}
        </>
      ) : null}

      {tab === "facts" ? (
        <>
          {build.facts.length ? <Btn kind="violet" label="PRINT OR SAVE AS PDF" onPress={() => void printHtml(factsHtml(build.title, build.facts))} /> : null}
          {(["formula", "date", "definition", "name", "fact"] as const).map(k => {
            const g = build.facts.filter(f => f.kind === k);
            return g.length ? (
              <Card key={k} title={`${k.toUpperCase()}S`}>
                {g.map(f => <View key={f.id} style={{ gap: 2 }}><Text style={{ color: C.yellow, fontWeight: "900" }}>{f.label}</Text><Text style={{ color: C.white, lineHeight: 21 }}>{f.value}</Text></View>)}
              </Card>
            ) : null;
          })}
          {!build.facts.length ? <Empty title="No formulas or facts found" body="Your material did not have formulas, dates or named definitions to pull out. That is normal for some subjects." /> : null}
        </>
      ) : null}

      {tab === "likely" ? (
        <>
          <Note tone="warn" title="PREDICTIONS, NOT REAL EXAM CONTENT">These are questions a professor could plausibly write from your material. They are study aids. Your actual exam may ask different things.</Note>
          {build.likely.map(l => (
            <Card key={l.id} accent={C.yellow}>
              <Row gap={8}><Badge text="PREDICTION" color={C.yellow} ink={C.ink} /><Label>{l.topic.toUpperCase()}</Label></Row>
              <Text style={{ color: C.white, fontWeight: "800", fontSize: 16 }}>{l.prompt}</Text>
              {l.outline ? <Text style={{ color: C.lavender, lineHeight: 21 }}>{l.outline}</Text> : null}
              <SourceBox buildId={build.origin === "imported" ? null : build.id} pointer={l.source} />
            </Card>
          ))}
          {!build.likely.length ? <Empty title="No predictions in this set" body="This study set came back without likely exam questions." /> : null}
        </>
      ) : null}

      <Row wrap gap={8}>
        <Btn small kind="ghost" label="SHARE DECK FILE" onPress={share} />
        <Btn small kind="danger" label="DELETE" onPress={del} />
      </Row>
    </Screen>
  );
}

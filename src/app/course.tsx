import { router } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { Card } from "../components/Card";
import { DraftEditor } from "../components/DraftEditor";
import { openPaywall } from "../components/Paywall";
import { Body, Btn, Field, H1, Kicker, Label, Note, Screen } from "../components/ui";
import { SyllabusDraft, draftProblems, parseSyllabus } from "../core/syllabus";
import { fromFile, fromPhoto } from "../services/intake";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";
import * as Crypto from "expo-crypto";

type Phase = "input" | "parsing" | "review";

/** Syllabus First. Pick or paste, read, confirm every item, then the course exists. Never uses a Study Build. */
export default function Course() {
  const { store, state } = useApp();
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<SyllabusDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const free = !store.isPro();
  const hasCourse = state.courses.length >= 1;

  const take = async (r: Awaited<ReturnType<typeof fromFile>>) => {
    if (!r.ok) { if (!r.cancelled) setMessage(r.message); return; }
    setMessage(null);
    setText(r.text);
    setSource(r.label);
  };

  const read = async () => {
    setPhase("parsing");
    setMessage(null);
    const out = await store.parseSyllabusText(text);
    setDraft(out.draft);
    if (!out.ok) setMessage(out.message);
    else {
      setNotice(out.draft.items.length ? `${out.draft.items.length} items found.${out.dropped ? ` ${out.dropped} unreadable lines were skipped.` : ""}${out.truncated ? " Only the first part of a very long syllabus was read." : ""}` : "The reader found nothing it could use. Add what you know by hand.");
    }
    setPhase("review");
  };

  const byHand = () => { setDraft(parseSyllabus("").draft); setNotice(null); setPhase("review"); };

  const save = async () => {
    if (!draft) return;
    const probs = draftProblems(draft);
    setProblems(probs.map(p => p.message));
    if (probs.length) return;
    setSaving(true);
    const out = await store.confirmCourse(draft);
    setSaving(false);
    if (out.ok) { router.replace({ pathname: "/courses/[id]", params: { id: out.course.id } }); return; }
    if (out.reason === "paywall") { openPaywall("course"); return; }
    setProblems(out.problems);
  };

  if (phase === "parsing") {
    return <Screen back={false}><Kicker>READING YOUR SYLLABUS</Kicker><H1>One moment</H1><Body>Finding exam dates, quiz dates, due dates, grading weights, materials, office hours and weekly topics. This uses no Study Build.</Body></Screen>;
  }

  if (phase === "review" && draft) {
    return (
      <Screen backLabel="BACK" >
        <Kicker>CONFIRM YOUR COURSE</Kicker>
        <H1>Check every item</H1>
        <Body>Nothing is saved until you tap Save. Fix anything that is wrong, turn off what you don't want, and add what was missed.</Body>
        {message ? <Note tone="warn" title="COULD NOT READ THE SYLLABUS">{message}</Note> : null}
        {notice ? <Note tone="info">{notice}</Note> : null}
        <Field label="COURSE NAME" value={draft.courseName} onChangeText={t => setDraft({ ...draft, courseName: t })} placeholder="BIO 201 Cell Biology" />
        <DraftEditor items={draft.items} onChange={items => setDraft({ ...draft, items })} newId={() => Crypto.randomUUID()} />
        {problems.length ? <Note tone="bad" title="FIX THESE FIRST">{problems.join("\n")}</Note> : null}
        {hasCourse && free ? <Note tone="warn">Free includes one course. You can finish reading this syllabus now, but saving a second course needs CramJam Pro.</Note> : null}
        <Btn label="SAVE THIS COURSE" onPress={save} busy={saving} />
        <Text style={{ color: C.green, fontWeight: "900", textAlign: "center", fontSize: 12, letterSpacing: 1 }}>SYLLABUS SETUP NEVER SPENDS A STUDY BUILD</Text>
      </Screen>
    );
  }

  const ready = text.trim().length >= 40;
  return (
    <Screen>
      <Kicker>SYLLABUS FIRST</Kicker>
      <H1>Start with the syllabus</H1>
      <Body>Upload it free. Confirm every date and weight before CramJam creates your course.</Body>
      {hasCourse && free ? <Note tone="info">You already have your free course. You can read another syllabus, but saving it as a second course needs CramJam Pro.</Note> : null}
      <Card title="DROP IN YOUR SYLLABUS" accent={C.yellow}>
        <Btn label="CHOOSE A FILE" onPress={async () => take(await fromFile())} />
        <Btn kind="violet" label="TAKE A PHOTO" onPress={async () => take(await fromPhoto("camera"))} />
        <Btn kind="ghost" label="PHOTOS FROM YOUR LIBRARY" onPress={async () => take(await fromPhoto("library"))} />
        <Body>Text files and photos are read on your device. For a PDF, take a photo of the pages or paste the text below.</Body>
      </Card>
      {message ? <Note tone="warn">{message}</Note> : null}
      <Card title="OR PASTE THE TEXT">
        <Field multiline value={text} onChangeText={t => { setText(t); setSource(""); }} placeholder="Paste the syllabus text here" style={{ minHeight: 150 }} />
        {source ? <Label>{`LOADED: ${source.toUpperCase()}`}</Label> : null}
        <Btn label="READ MY SYLLABUS" onPress={read} disabled={!ready} />
        {!ready && text.length > 0 ? <Body>That looks short. Paste the whole syllabus for the best result.</Body> : null}
      </Card>
      <Note tone="info" title="WHERE YOUR SYLLABUS GOES">The text of your syllabus is sent to CramJam's AI service to find the dates and weights. It is processed for that request and not kept on our server afterward.</Note>
      <Btn kind="ghost" label="ADD THE DATES BY HAND INSTEAD" onPress={byHand} />
    </Screen>
  );
}

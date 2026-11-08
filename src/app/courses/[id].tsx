import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Card } from "../../components/Card";
import { DraftEditor } from "../../components/DraftEditor";
import { Badge, Body, Btn, Empty, H1, Kicker, Label, Note, Ring, Row, Screen } from "../../components/ui";
import { countdownLabel, formatDay, parseItemDate } from "../../core/dates";
import { gradeMath, upcomingItems } from "../../core/plan";
import { buildsOf, courseReadiness, dueInfo } from "../../core/selectors";
import { SkeletonItem, isTestKind } from "../../core/syllabus";
import { useApp } from "../../state/AppProvider";
import { C } from "../../theme";

export default function CoursePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, state, now } = useApp();
  const course = state.courses.find(c => c.id === id);
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<SkeletonItem[]>([]);

  if (!course) return <Screen><Empty title="That class isn't here" body="It may have been removed." action={<Btn label="GO HOME" onPress={() => router.replace("/")} />} /></Screen>;

  const ready = courseReadiness(state, course.id);
  const info = dueInfo(state, course.id, now);
  const builds = buildsOf(state, course.id);
  const dated = upcomingItems([course], now);
  const topics = course.items.filter(i => i.kind === "topic");
  const others = course.items.filter(i => ["material", "officeHours", "grading", "note"].includes(i.kind));

  const save = () => {
    const bad = items.find(i => i.date && !parseItemDate(i.date));
    if (bad) { Alert.alert("Fix a date", `${bad.label || "An item"} has a date CramJam can't read. Use YYYY-MM-DD.`); return; }
    store.updateCourseItems(course.id, items.filter(i => i.label.trim()));
    setEditing(false);
  };
  const del = () => Alert.alert(`Remove ${course.name}?`, "Its study sets stay on your device as standalone decks. Your free course count does not go back down.", [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: () => { store.deleteCourse(course.id); router.replace("/"); } },
  ]);

  if (editing) {
    return (
      <Screen backLabel="CANCEL">
        <Kicker>EDIT COURSE</Kicker>
        <H1>{course.name}</H1>
        <DraftEditor items={items} onChange={setItems} newId={() => Crypto.randomUUID()} />
        <Btn label="SAVE CHANGES" onPress={save} />
        <Btn kind="ghost" label="DISCARD" onPress={() => { setItems(course.items); setEditing(false); }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Kicker>COURSE</Kicker>
      <H1>{course.name}</H1>
      <Row gap={16}>
        <Ring value={ready} />
        <View style={{ flex: 1 }}>
          <Body color={C.white}>{ready == null ? "Readiness starts after your first practice answer." : `Readiness ${ready}, from the answers you've given.`}</Body>
          <Body>{info.dueCards + info.newCards} cards · {info.openMistakes} missed questions</Body>
        </View>
      </Row>
      <Row wrap>
        <Btn small label="STUDY BUILD" onPress={() => router.push("/build")} />
        <Btn small kind="violet" label="DRILL" onPress={() => router.push({ pathname: "/study", params: { mode: "drill", scope: course.id } })} />
        <Btn small kind="violet" label="PLAN" onPress={() => router.push({ pathname: "/plan", params: { scope: course.id } })} />
        <Btn small kind="violet" label="MOCK" onPress={() => router.push({ pathname: "/mock", params: { scope: course.id } })} />
      </Row>

      <Label>COUNTDOWNS</Label>
      {dated.length ? dated.map(d => {
        const g = isTestKind(d.item.kind) ? gradeMath(d.item) : null;
        return (
          <Card key={d.item.id} accent={d.item.kind === "exam" ? C.yellow : C.violet}>
            <Row gap={8}><Badge text={countdownLabel(d.at, now)} color={d.item.kind === "exam" ? C.yellow : C.violet} ink={d.item.kind === "exam" ? C.ink : C.white} /><Text style={{ color: C.white, fontWeight: "900", flex: 1 }}>{d.item.label}</Text></Row>
            <Body>{formatDay(d.at)}{d.item.weight != null ? ` · ${d.item.weight}% of your grade` : ""}</Body>
            {g && !g.assumed ? <Body>Every 10 points on it moves your course grade {g.per10} points.</Body> : null}
          </Card>
        );
      }) : <Note tone="info">No dated items ahead. Edit the course to add exam, quiz or due dates.</Note>}

      {topics.length ? <><Label>WEEKLY TOPICS</Label><Card>{topics.map(t => <Text key={t.id} style={{ color: C.lavender, lineHeight: 22 }}>• {t.label}{t.detail ? `: ${t.detail}` : ""}</Text>)}</Card></> : null}
      {others.length ? <><Label>GRADING, MATERIALS, OFFICE HOURS</Label><Card>{others.map(t => <Text key={t.id} style={{ color: C.lavender, lineHeight: 22 }}>• {t.label}{t.weight != null ? ` (${t.weight}%)` : ""}{t.detail ? `: ${t.detail}` : ""}</Text>)}</Card></> : null}

      <Label>STUDY SETS</Label>
      {builds.length ? builds.map(b => <Btn key={b.id} kind="ghost" label={`${b.title} · ${b.cards.length} cards · ${b.questions.length} questions`} onPress={() => router.push({ pathname: "/builds/[id]", params: { id: b.id } })} />) : <Note tone="info">No study sets for this class yet.</Note>}

      <Btn kind="ghost" label="EDIT DATES AND ITEMS" onPress={() => { setItems(course.items); setEditing(true); }} />
      <Btn small kind="danger" label="REMOVE THIS CLASS" onPress={del} />
    </Screen>
  );
}

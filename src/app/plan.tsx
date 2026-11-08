import { router, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { Card } from "../components/Card";
import { Badge, Body, Btn, Empty, H1, Kicker, Label, Note, Row, Screen } from "../components/ui";
import { formatDay, formatTime } from "../core/dates";
import { buildDayPlan, finalsBlocks, finalsTarget, gradeMath, planTargets, upcomingTests } from "../core/plan";
import { weakFor } from "../core/selectors";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

/** weightPlan laid out day by day to the exam date. Heaviest on the weakest topics. */
export default function Plan() {
  const { scope = "all" } = useLocalSearchParams<{ scope?: string }>();
  const { store, state, now } = useApp();
  const courseId = scope === "all" ? undefined : scope;
  const tests = upcomingTests(courseId ? state.courses.filter(c => c.id === courseId) : state.courses, now);
  const targets = planTargets(state.courses, now, courseId);
  const weak = weakFor(state, scope === "all" ? "all" : scope);
  const days = buildDayPlan(targets, weak, now, state.settings.dailyMinutes);
  const finals = finalsTarget(courseId ? state.courses.filter(c => c.id === courseId) : state.courses, now);
  const adjust = (d: number) => store.setSettings({ dailyMinutes: Math.min(180, Math.max(30, state.settings.dailyMinutes + d)) });

  return (
    <Screen>
      <Kicker>EXAM PLAN</Kicker>
      <H1>Day by day</H1>
      <Body>Bigger tests get more of your time, and the closer they are the more it matters. Weak topics come first.</Body>
      {!targets.length ? (
        <Empty title="No dated exam or quiz yet" body="Add an exam or quiz date to a course. The plan builds itself from the dates and grading weights." action={state.courses[0] ? <Btn label="EDIT COURSE DATES" onPress={() => router.replace({ pathname: "/courses/[id]", params: { id: state.courses[0].id } })} /> : <Btn label="ADD A SYLLABUS" onPress={() => router.replace("/course")} />} />
      ) : (
        <>
          <Card title="WHAT'S AT STAKE" accent={C.yellow}>
            {tests.map(t => {
              const g = gradeMath(t.item);
              return (
                <View key={t.item.id} style={{ gap: 2 }}>
                  <Text style={{ color: C.white, fontWeight: "900" }}>{t.item.label} · {formatDay(t.at)}</Text>
                  <Text style={{ color: C.lavender }}>{g.assumed ? `No weight in the syllabus, planned as ${g.weight}%` : `${g.weight}% of your grade. Every 10 points moves your course grade ${g.per10}.`}</Text>
                </View>
              );
            })}
          </Card>
          <Label>STUDY MINUTES PER DAY</Label>
          <Row>
            <Btn small kind="ghost" label="− 15" onPress={() => adjust(-15)} />
            <Text style={{ color: C.yellow, fontSize: 28, fontWeight: "900", flex: 1, textAlign: "center" }}>{state.settings.dailyMinutes}</Text>
            <Btn small kind="ghost" label="+ 15" onPress={() => adjust(15)} />
          </Row>
          {finals ? (
            <>
              <Note tone="warn" title="FINALS MODE">{finals.item.label} is inside 72 hours. Review only, hour by hour. {finals.hasTime ? "" : "The syllabus gave no time, so this plans for 9:00 AM."}</Note>
              {finalsBlocks(now, finals.at, weak).map(b => (
                <View key={b.startsAt} style={{ flexDirection: "row", gap: 14, backgroundColor: C.paper, borderRadius: 14, padding: 10, opacity: b.activity === "sleep" ? 0.6 : 1 }}>
                  <Text style={{ color: C.yellow, fontWeight: "900", width: 130 }}>{formatDay(b.startsAt)} {formatTime(b.startsAt)}</Text>
                  <Text style={{ color: C.white, flex: 1 }}>{b.label}{b.topic ? ` · ${b.topic}` : ""}</Text>
                </View>
              ))}
            </>
          ) : null}
          <Label>THE DAYS AHEAD</Label>
          {days.map((d, i) => (
            <Card key={d.date} accent={i === 0 ? C.yellow : C.violet}>
              <Row gap={8}><Text style={{ color: C.white, fontWeight: "900", fontSize: 16, flex: 1 }}>{i === 0 ? "TODAY" : formatDay(d.dayMs).toUpperCase()}</Text><Badge text={`${d.total} MIN`} color={C.green} ink={C.ink} /></Row>
              {d.targets.map(t => <Text key={t.id} style={{ color: C.lavender }}>{t.minutes} min · {t.title} ({t.daysLeft} day{t.daysLeft === 1 ? "" : "s"} left, {t.weight}%)</Text>)}
              {d.topics.length ? <Text style={{ color: C.yellow, fontWeight: "800" }}>Focus: {d.topics.join(", ")}</Text> : null}
            </Card>
          ))}
          <Note tone="info">Reminders for your exams and due dates are local notifications on this device.</Note>
        </>
      )}
    </Screen>
  );
}

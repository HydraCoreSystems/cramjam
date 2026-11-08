import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "../components/Card";
import { openPaywall } from "../components/Paywall";
import { Badge, Body, Btn, Empty, Kicker, Label, Note, Ring, Screen, Spinner, Sticker } from "../components/ui";
import { countdownLabel, formatDay, formatTime } from "../core/dates";
import { finalsBlocks, gradeMath } from "../core/plan";
import { allowanceView, dueInfo, homeModel, courseReadiness, streakOf, weakFor } from "../core/selectors";
import { pickDeckText } from "../services/intake";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

const Tile = ({ icon, title, sub, onPress }: { icon: string; title: string; sub: string; onPress: () => void }) => (
  <Pressable style={s.mini} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
    <Text style={s.icon}>{icon}</Text>
    <Text style={s.miniTitle}>{title}</Text>
    <Text style={s.miniSub}>{sub}</Text>
  </Pressable>
);

export default function Home() {
  const { store, state, now } = useApp();
  const [busy, setBusy] = useState(false);
  const model = homeModel(state, now);
  const streak = streakOf(state, now);
  const allowance = allowanceView(state, now);

  const importDeck = async () => {
    setBusy(true);
    try {
      const picked = await pickDeckText();
      if (!picked.ok) { if (!picked.cancelled) Alert.alert("Could not open that file", "CramJam could not read the file."); return; }
      const r = await store.importDeckFile(picked.text);
      if (!r.ok) { Alert.alert("Could not open that deck", r.message); return; }
      router.push({ pathname: "/builds/[id]", params: { id: r.build.id } });
    } finally { setBusy(false); }
  };

  const scope = model.kind === "normal" && model.next ? model.next.courseId : model.kind === "finals" ? model.target.courseId : "all";
  const info = dueInfo(state, scope, now);
  const weak = weakFor(state, scope);
  const header = (
    <View style={s.head}>
      <View style={{ flex: 1 }}>
        <Text style={s.brand}>CRAMJAM</Text>
        <Text style={s.hello} numberOfLines={1}>{state.courses.length === 1 ? state.courses[0].name : state.courses.length > 1 ? "YOUR CLASSES" : "LET'S START"}</Text>
      </View>
      <Pressable onPress={() => router.push("/settings")} accessibilityLabel="Settings" hitSlop={10}><Text style={s.gear}>⚙</Text></Pressable>
      <Sticker top={streak.todayDone ? "STREAK" : "STREAK"} big={String(streak.streak)} color={streak.streak > 0 ? C.violet : C.dim} />
    </View>
  );

  const saveWarn = state.saveFailed ? <Note tone="bad" title="NOT SAVED">CramJam couldn't save your latest changes on this device. Free up some storage; it will try again on your next change.</Note> : null;

  if (model.kind === "loading") return <Screen back={false}>{header}<Spinner /></Screen>;

  if (model.kind === "empty") {
    return (
      <Screen back={false}>
        {header}
        {saveWarn}
        <Card title="START WITH YOUR SYLLABUS" accent={C.yellow}>
          <Body>Upload the syllabus for a class. CramJam finds the exam dates, quiz dates, due dates and grading weights, you confirm them, and your course is ready. It never uses a Study Build.</Body>
          <Btn label="ADD A SYLLABUS" onPress={() => router.push("/course")} />
        </Card>
        <Card title="HAVE A FRIEND'S DECK?">
          <Body>Open a CramJam deck file and study it right away. It costs you no Study Builds.</Body>
          <Btn label="OPEN A DECK FILE" kind="ghost" busy={busy} onPress={importDeck} />
        </Card>
        <Note tone="info">Nothing here yet, and nothing is made up. Your streak, readiness and plan fill in from what you actually study.</Note>
        <Label>{allowance.text.toUpperCase()}</Label>
      </Screen>
    );
  }

  if (model.kind === "finals") {
    const t = model.target;
    const hours = Math.max(0, Math.round((t.at - now) / 3_600_000));
    const blocks = finalsBlocks(now, t.at, weak).slice(0, 8);
    return (
      <Screen back={false}>
        {header}
        <Card title="FINALS MODE" accent={C.red}>
          <Text style={s.days}>{hours} HOURS</Text>
          <Body color={C.white}>{t.item.label} · {t.courseName}</Body>
          <Body>{formatDay(t.at)}{t.hasTime ? ` at ${formatTime(t.at)}` : ", planned for 9:00 AM since the syllabus gave no time"}. Review only from here. No new material.</Body>
        </Card>
        <Card title="DO THIS NOW" accent={C.yellow}>
          {info.openMistakes > 0 || weak.length > 0 ? <Btn label="WEAK SPOT DRILL" onPress={() => router.push({ pathname: "/study", params: { mode: "drill", scope: t.courseId } })} /> : null}
          {info.dueCards + info.newCards > 0 ? <Btn kind="violet" label={`REVIEW CARDS (${info.dueCards + info.newCards})`} onPress={() => router.push({ pathname: "/review", params: { scope: t.courseId } })} /> : null}
          {info.openMistakes > 0 ? <Btn kind="ghost" label={`MISTAKE BOOK (${info.openMistakes})`} onPress={() => router.push("/mistakes")} /> : null}
          {!info.openMistakes && !weak.length && !(info.dueCards + info.newCards) ? <Body>You are caught up. Take the daily five or read your facts sheet.</Body> : null}
          <Btn kind="ghost" label="DAILY FIVE" onPress={() => router.push({ pathname: "/study", params: { mode: "warmup", scope: t.courseId } })} />
        </Card>
        <Label>HOUR BY HOUR</Label>
        {blocks.map(b => (
          <View key={b.startsAt} style={[s.block, b.activity === "sleep" && { opacity: 0.6 }]}>
            <Text style={s.blockTime}>{formatTime(b.startsAt)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.blockTitle}>{b.label}</Text>
              {b.topic ? <Text style={s.miniSub}>{b.topic.toUpperCase()}</Text> : null}
            </View>
          </View>
        ))}
        <Btn kind="ghost" label="SEE THE FULL PLAN" onPress={() => router.push({ pathname: "/plan", params: { scope: t.courseId } })} />
      </Screen>
    );
  }

  const next = model.next;
  const ready = courseReadiness(state, next?.courseId ?? "all");
  const g = next ? gradeMath(next.item) : null;
  const mainAction = info.openMistakes > 0 || weak.length > 0
    ? { label: "START WEAK SPOT DRILL", go: () => router.push({ pathname: "/study", params: { mode: "drill", scope } }) }
    : info.dueCards + info.newCards > 0
      ? { label: `REVIEW CARDS (${info.dueCards + info.newCards})`, go: () => router.push({ pathname: "/review", params: { scope } }) }
      : null;
  const hasBank = Object.values(state.builds).length > 0;

  return (
    <Screen back={false}>
      {header}
      {saveWarn}
      {next && g ? (
        <Card title={next.item.label.toUpperCase()} accent={C.yellow}>
          <View style={s.hero}>
            <View style={{ flex: 1 }}>
              <Text style={s.days}>{countdownLabel(next.at, now)}</Text>
              <Text style={s.sub}>{next.courseName} · {formatDay(next.at)}</Text>
              <Text style={s.sub}>{g.assumed ? "Weight not in the syllabus" : `${g.weight}% of your grade`}</Text>
              {!g.assumed ? <Text style={s.sub}>Every 10 points on it moves your course grade {g.per10} points.</Text> : null}
            </View>
            <Ring value={ready} />
          </View>
          {ready == null ? <Body>Readiness starts after you answer your first practice question.</Body> : null}
          {mainAction ? <Btn label={mainAction.label} onPress={mainAction.go} /> : null}
        </Card>
      ) : (
        <Card title="NO DATED TEST YET" accent={C.yellow}>
          <Body>Add an exam or quiz date to a course and the countdown, plan and Finals Mode switch on by themselves.</Body>
          {state.courses[0] ? <Btn kind="ghost" label="EDIT COURSE DATES" onPress={() => router.push({ pathname: "/courses/[id]", params: { id: state.courses[0].id } })} /> : null}
        </Card>
      )}

      <Kicker color={C.lavender}>TODAY</Kicker>
      {hasBank ? (
        <Card title={info.openMistakes + info.dueCards + info.newCards > 0 ? "Your queue" : "You're caught up"} accent={C.green}>
          <Body>
            {info.dueCards} card{info.dueCards === 1 ? "" : "s"} due · {info.newCards} new · {info.openMistakes} missed question{info.openMistakes === 1 ? "" : "s"} waiting{info.retestsDue ? ` · ${info.retestsDue} retest${info.retestsDue === 1 ? "" : "s"} due` : ""}
          </Body>
          {weak.length ? <Body>Weak spots: {weak.slice(0, 3).join(", ")}</Body> : null}
          <Btn kind="violet" label="DAILY FIVE" onPress={() => router.push({ pathname: "/study", params: { mode: "warmup", scope } })} />
          <Text style={s.mini2}>{streak.todayDone ? "Today counts toward your streak." : `${Math.max(0, 5 - streak.todayCount)} more cards or questions makes today count.`}</Text>
        </Card>
      ) : (
        <Empty title="Nothing to study yet" body="Make your first Study Build from notes, a photo, or pasted text. It turns one body of material into cards, a quiz and a summary." action={<Btn label="MAKE A STUDY BUILD" onPress={() => router.push("/build")} />} />
      )}

      <View style={s.row}>
        <Tile icon="＋" title="STUDY BUILD" sub="Notes to a full set" onPress={() => router.push("/build")} />
        <Tile icon="⌁" title="NEW CLASS" sub="Syllabus, free" onPress={() => router.push("/course")} />
      </View>
      <View style={s.row}>
        <Tile icon="⏱" title="MOCK EXAM" sub="Timed, graded" onPress={() => router.push("/mock")} />
        <Tile icon="✎" title="MISTAKE BOOK" sub={`${info.openMistakes} to clear`} onPress={() => router.push("/mistakes")} />
      </View>
      <View style={s.row}>
        <Tile icon="▦" title="EXAM PLAN" sub="Day by day" onPress={() => router.push({ pathname: "/plan", params: { scope } })} />
        <Tile icon="◔" title="FOCUS" sub="Timer" onPress={() => router.push("/focus")} />
      </View>
      <View style={s.row}>
        <Tile icon="✦" title="TEACH BACK" sub="Tutor & notes chat" onPress={() => router.push("/learn")} />
        <Tile icon="◎" title="CALIBRATION" sub="Sure vs right" onPress={() => router.push({ pathname: "/calibration", params: { scope } })} />
      </View>
      <Btn kind="ghost" label="OPEN A FRIEND'S DECK FILE" busy={busy} onPress={importDeck} />

      {state.courses.length ? (
        <>
          <Kicker color={C.lavender}>YOUR CLASSES</Kicker>
          {state.courses.map(c => (
            <Pressable key={c.id} style={s.course} onPress={() => router.push({ pathname: "/courses/[id]", params: { id: c.id } })} accessibilityRole="button">
              <Text style={s.courseName}>{c.name}</Text>
              <Text style={s.miniSub}>{courseReadiness(state, c.id) == null ? "READINESS NOT STARTED" : `READINESS ${courseReadiness(state, c.id)}`}</Text>
            </Pressable>
          ))}
        </>
      ) : null}

      {model.upcoming.length ? (
        <>
          <Kicker color={C.lavender}>COUNTDOWNS</Kicker>
          {model.upcoming.map(i => (
            <View key={`${i.courseId}${i.item.id}`} style={s.count}>
              <Badge text={countdownLabel(i.at, now)} color={i.item.kind === "exam" ? C.yellow : C.violet} ink={i.item.kind === "exam" ? C.ink : C.white} />
              <View style={{ flex: 1 }}>
                <Text style={s.courseName}>{i.item.label}</Text>
                <Text style={s.miniSub}>{i.courseName} · {formatDay(i.at)}{i.item.weight != null ? ` · ${i.item.weight}%` : ""}</Text>
              </View>
            </View>
          ))}
        </>
      ) : null}

      <Pressable onPress={() => (allowance.pro ? router.push("/settings") : openPaywall("build"))}>
        <Text style={[s.allow, allowance.low && { color: C.yellow }]}>{allowance.text.toUpperCase()}</Text>
      </Pressable>
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  brand: { color: C.yellow, fontSize: 16, fontWeight: "900", letterSpacing: 3 },
  hello: { color: C.white, fontSize: 28, fontWeight: "900" },
  gear: { color: C.lavender, fontSize: 26 },
  hero: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  days: { color: C.yellow, fontSize: 38, fontWeight: "900" },
  sub: { color: C.lavender, fontWeight: "700", marginTop: 2 },
  row: { flexDirection: "row", gap: 12 },
  mini: { flex: 1, backgroundColor: C.paper, borderRadius: 22, borderWidth: 3, borderColor: C.violet, padding: 14, gap: 4 },
  icon: { color: C.yellow, fontSize: 26, fontWeight: "900" },
  miniTitle: { color: C.white, fontWeight: "900", fontSize: 14 },
  miniSub: { color: C.lavender, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  mini2: { color: C.lavender, fontSize: 12 },
  course: { backgroundColor: C.paper, borderRadius: 18, borderWidth: 3, borderColor: C.violet, padding: 14, gap: 4 },
  courseName: { color: C.white, fontWeight: "900", fontSize: 16 },
  count: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.paper, borderRadius: 18, padding: 12 },
  allow: { color: C.lavender, textAlign: "center", fontWeight: "900", fontSize: 11, letterSpacing: 1.5, marginTop: 8 },
  block: { flexDirection: "row", gap: 14, backgroundColor: C.paper, borderRadius: 16, padding: 12, borderWidth: 2, borderColor: C.dim },
  blockTime: { color: C.yellow, fontWeight: "900", width: 74 },
  blockTitle: { color: C.white, fontWeight: "900" },
});

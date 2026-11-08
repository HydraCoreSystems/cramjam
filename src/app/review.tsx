import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Btn, Empty, Kicker, Label, Note, Row, Screen } from "../components/ui";
import { Card as CardT } from "../core/build";
import { formatDay, formatTime } from "../core/dates";
import { cardsOf, streakOf } from "../core/selectors";
import { NEW_PER_DAY, RATING_LABEL, Rating, dailyQueue, previewInterval } from "../core/srs";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

/** Daily review queue with spaced repetition. Always free. Runs entirely on the device. */
export default function Review() {
  const params = useLocalSearchParams<{ scope?: string; build?: string }>();
  const { store, state } = useApp();
  const scope = params.scope ?? "all";
  const cards = params.build ? state.builds[params.build]?.cards ?? [] : cardsOf(state, scope === "all" ? "all" : scope);
  const byId = new Map<string, CardT>(cards.map(c => [c.id, c]));
  // The queue is fixed when the screen opens, so it does not reshuffle while the student works.
  const [queue, setQueue] = useState<string[]>(() => dailyQueue(cards.map(c => c.id), state.srs, Date.now(), params.build ? 1000 : NEW_PER_DAY).map(q => q.id));
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [requeued, setRequeued] = useState<string[]>([]);
  const [now] = useState(() => Date.now());

  if (!cards.length) return <Screen><Empty title="No cards yet" body="Make a Study Build and its flashcards will wait here." action={<Btn label="MAKE A STUDY BUILD" onPress={() => router.replace("/build")} />} /></Screen>;

  const id = queue[i];
  const card = id ? byId.get(id) : undefined;

  if (!card) {
    const nextDue = Object.values(state.srs).filter(c => byId.has(c.id)).map(c => c.due).filter(d => d > now).sort((a, b) => a - b)[0];
    const st = streakOf(state, now);
    return (
      <Screen>
        <Kicker color={C.green}>{done ? "SESSION DONE" : "NOTHING DUE"}</Kicker>
        <Text style={s.big}>{done ? `${done} card${done === 1 ? "" : "s"} reviewed` : "You're caught up"}</Text>
        {nextDue ? <Note tone="info">Next card is due {formatDay(nextDue)} at {formatTime(nextDue)}.</Note> : null}
        <Note tone={st.todayDone ? "good" : "info"}>{st.streak > 0 ? `${st.streak}-day streak. ` : ""}{st.todayDone ? "Today counts." : `${Math.max(0, 5 - st.todayCount)} more reviews or answers makes today count.`}</Note>
        <Btn label="WEAK SPOT DRILL" onPress={() => router.replace({ pathname: "/study", params: { mode: "drill", scope } })} />
        <Btn kind="ghost" label="HOME" onPress={() => router.replace("/")} />
      </Screen>
    );
  }

  const prev = state.srs[card.id] ?? null;
  const rate = (g: Rating) => {
    store.reviewCard(card.id, g);
    // A card marked Again comes back once more in this session.
    if (g === 1 && !requeued.includes(card.id)) { setRequeued(r => [...r, card.id]); setQueue(q => [...q, card.id]); }
    setDone(d => d + 1);
    setShown(false);
    setI(x => x + 1);
  };

  return (
    <Screen back>
      <Kicker>{`CARD ${i + 1} OF ${queue.length}`}</Kicker>
      <Label>{card.topic.toUpperCase()}</Label>
      <Pressable style={s.card} onPress={() => setShown(true)} accessibilityRole="button" accessibilityLabel={shown ? "Answer shown" : "Show answer"}>
        <Text style={s.q}>{card.front}</Text>
        {shown ? <Text style={s.a}>{card.back}</Text> : <Text style={s.hint}>Tap to show the answer</Text>}
        {shown && card.source ? <Text style={s.hint}>From your material · {card.source.label}</Text> : null}
      </Pressable>
      {shown ? (
        <>
          <Label>HOW DID THAT GO?</Label>
          <Row gap={8}>
            {([1, 2, 3, 4] as Rating[]).map(g => (
              <View key={g} style={{ flex: 1 }}>
                <Btn small label={RATING_LABEL[g]} kind={g === 1 ? "danger" : g === 3 ? "primary" : g === 4 ? "green" : "violet"} onPress={() => rate(g)} style={{ paddingHorizontal: 4 }} />
                <Text style={s.iv}>{previewInterval(prev, card.id, g, now)}</Text>
              </View>
            ))}
          </Row>
        </>
      ) : (
        <Btn label="SHOW ANSWER" onPress={() => setShown(true)} />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  big: { color: C.white, fontSize: 32, fontWeight: "900" },
  card: { minHeight: 280, backgroundColor: C.paper, borderWidth: 4, borderColor: C.violet, borderRadius: 28, padding: 26, justifyContent: "center", gap: 18 },
  q: { color: C.white, fontSize: 26, fontWeight: "800", lineHeight: 34 },
  a: { color: C.yellow, fontSize: 20, lineHeight: 28, fontWeight: "700" },
  hint: { color: C.lavender },
  iv: { color: C.lavender, textAlign: "center", fontSize: 11, fontWeight: "800", marginTop: 4 },
});

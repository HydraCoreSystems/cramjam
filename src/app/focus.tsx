import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Bar, Body, Btn, Chip, Field, H1, Kicker, Label, Note, Row, Screen } from "../components/ui";
import { dayKey } from "../core/dates";
import { cancelSessionEnd, scheduleSessionEnd } from "../services/notifications";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

const KEEP_AWAKE_TAG = "cramjam-focus";
const mmss = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.max(0, Math.floor(sec) % 60)).padStart(2, "0")}`;

/** Focus timer with a session goal. Always free. The end time is fixed when you start, so it survives leaving the app. */
export default function Focus() {
  const { store, state } = useApp();
  const [minutes, setMinutes] = useState(25);
  const [goal, setGoal] = useState("");
  const [endAt, setEndAt] = useState<number | null>(null);
  const [startedMin, setStartedMin] = useState(25);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const logged = useRef(false);

  useEffect(() => {
    if (!endAt) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => { clearInterval(t); deactivateKeepAwake(KEEP_AWAKE_TAG); };
  }, [endAt]);

  const left = endAt ? (endAt - nowMs) / 1000 : 0;
  const finished = !!endAt && left <= 0;
  useEffect(() => {
    if (finished && !logged.current) { logged.current = true; store.logFocus(startedMin, goal.trim()); }
  }, [finished, startedMin, goal, store]);

  const start = async () => {
    logged.current = false;
    setStartedMin(minutes);
    setNowMs(Date.now());
    setEndAt(Date.now() + minutes * 60_000);
    await scheduleSessionEnd(minutes * 60, goal.trim());
  };
  const stop = async () => { setEndAt(null); await cancelSessionEnd(); };

  const today = dayKey(nowMs);
  const todays = state.sessions.filter(x => dayKey(x.at) === today);
  const total = todays.reduce((n, x) => n + x.minutes, 0);

  return (
    <Screen>
      <Kicker>FOCUS TIMER</Kicker>
      <H1>{endAt ? (finished ? "Session done" : "Stay on it") : "Pick a session"}</H1>
      {!endAt ? (
        <>
          <Label>LENGTH</Label>
          <Row wrap>{[15, 25, 45, 60].map(m => <Chip key={m} label={`${m} MIN`} selected={minutes === m} onPress={() => setMinutes(m)} />)}</Row>
          <Field label="SESSION GOAL" value={goal} onChangeText={setGoal} placeholder="Example: finish chapter 6 cards" />
          <Btn label="START FOCUS" onPress={start} />
        </>
      ) : (
        <>
          <View style={{ alignItems: "center", gap: 14, paddingVertical: 20 }}>
            <Text style={{ color: finished ? C.green : C.yellow, fontSize: 80, fontWeight: "900" }} accessibilityLabel={`Time left ${mmss(left)}`}>{finished ? "0:00" : mmss(left)}</Text>
            {goal.trim() ? <Body color={C.white}>{goal.trim()}</Body> : null}
          </View>
          <Bar pct={finished ? 100 : (1 - left / (startedMin * 60)) * 100} color={C.green} />
          {finished ? <Note tone="good">{startedMin} minutes logged. Take a break.</Note> : <Note tone="info">You'll get a notification when time is up, even if you leave the app.</Note>}
          <Btn kind={finished ? "primary" : "ghost"} label={finished ? "DONE" : "STOP"} onPress={stop} />
        </>
      )}
      <Label>TODAY</Label>
      <Body>{todays.length ? `${todays.length} session${todays.length === 1 ? "" : "s"} · ${total} minutes focused` : "No focus sessions yet today."}</Body>
    </Screen>
  );
}

import { useLocalSearchParams } from "expo-router";
import { Card } from "../components/Card";
import { Bar, Body, Empty, H1, Kicker, Note, Screen } from "../components/ui";
import { Text } from "react-native";
import { answersOf } from "../core/selectors";
import { calibration } from "../core/study";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

/** What the student thinks they know against what the answers prove. */
export default function Calibration() {
  const { scope = "all" } = useLocalSearchParams<{ scope?: string }>();
  const { state } = useApp();
  const cal = calibration(answersOf(state, scope === "all" ? "all" : scope));
  const sureRight = cal.sure ? Math.round((cal.sureCorrect / cal.sure) * 100) : 0;
  const guessRight = cal.guessing ? Math.round((cal.guessingCorrect / cal.guessing) * 100) : 0;
  return (
    <Screen>
      <Kicker>CALIBRATION</Kicker>
      <H1>Sure vs. right</H1>
      <Body>Every practice answer carries a tag, sure or guessing. This is how well your confidence matches your results.</Body>
      {cal.total < 5 ? (
        <Empty title="Not enough answers yet" body={`Answer at least 5 practice questions with a confidence tag. You've answered ${cal.total}.`} />
      ) : (
        <>
          <Card title="WHEN YOU SAID SURE" accent={C.yellow}>
            <Text style={{ color: C.white, fontSize: 40, fontWeight: "900" }}>{cal.sure ? `${sureRight}%` : "–"}</Text>
            <Body>{cal.sure ? `of your ${cal.sure} sure answers were right.` : "You haven't marked any answer sure yet."}</Body>
            <Bar pct={sureRight} color={sureRight >= 85 ? C.green : C.yellow} />
          </Card>
          <Card title="WHEN YOU SAID GUESSING">
            <Text style={{ color: C.white, fontSize: 40, fontWeight: "900" }}>{cal.guessing ? `${guessRight}%` : "–"}</Text>
            <Body>{cal.guessing ? `of your ${cal.guessing} guesses were right.` : "You haven't marked any answer as a guess yet."}</Body>
            <Bar pct={guessRight} color={C.violet} />
          </Card>
          <Card title="THE GAP" accent={cal.gap > 25 ? C.red : C.green}>
            <Body color={C.white}>{`You marked ${cal.confidencePct}% of answers sure, and ${cal.accuracyPct}% of all answers were right.`}</Body>
            {cal.sure ? (
              <Note tone={cal.gap > 25 ? "bad" : cal.gap > 10 ? "warn" : "good"} title={cal.gap > 25 ? "OVERCONFIDENT" : cal.gap > 10 ? "SLIGHTLY OVERCONFIDENT" : "WELL CALIBRATED"}>
                {cal.gap > 10 ? `${cal.gap} points of your sure answers did not hold up. Those are the topics to slow down on.` : "Your sure answers hold up. Trust them."}
              </Note>
            ) : null}
            {cal.guessing && guessRight >= 70 ? <Note tone="info">You know more than you think. Your guesses are right most of the time.</Note> : null}
          </Card>
        </>
      )}
    </Screen>
  );
}

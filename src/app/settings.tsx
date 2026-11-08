import { router } from "expo-router";
import { Alert, Linking, Switch, Text, View } from "react-native";
import Constants from "expo-constants";
import { SignIn } from "../components/SignIn";
import { Body, Btn, Chip, H1, Kicker, Label, Note, Row, Screen } from "../components/ui";
import { PRIVACY_URL, SUPPORT_URL, TERMS_URL } from "../core/links";
import { mockGenerationEnabled } from "../core/mockGate";
import { allowanceView } from "../core/selectors";
import { iapAvailable, restore } from "../services/iap";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";
import brand from "../core/brand.json";

export default function Settings() {
  const { store, state, now } = useApp();
  const a = allowanceView(state, now);
  const confirmDelete = () =>
    Alert.alert("Delete everything on this device?", "Your classes, study sets, cards, answers, mistakes, plans and sign in are removed from this device. Your purchases and your free Study Build count stay, so deleting can't lose what you paid for or reset what was used.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete everything", style: "destructive", onPress: async () => { await store.deleteEverything(); router.replace("/"); } },
    ]);
  const doRestore = async () => {
    try { await store.recordActiveSubscriptions(await restore()); Alert.alert("Restore finished", "Your purchases were checked with the App Store."); }
    catch { Alert.alert("Could not restore", "The App Store can't be reached right now. Try again in a moment."); }
  };
  return (
    <Screen>
      <Kicker>SETTINGS</Kicker>
      <H1>Settings</H1>
      {mockGenerationEnabled() ? <Note tone="warn" title="DEVELOPMENT MOCK ON">Study sets, syllabus reading and tutoring are being faked by a development mock. This never ships.</Note> : null}

      <Label>YOUR PLAN</Label>
      <Body color={C.white}>{a.text}</Body>
      <Row wrap>
        {!a.pro ? <Btn small label="SEE PRO" onPress={() => router.push({ pathname: "/paywall", params: { reason: "build" } })} /> : null}
        {iapAvailable() ? <Btn small kind="ghost" label="RESTORE PURCHASES" onPress={doRestore} /> : null}
      </Row>

      <Label>SIGN IN WITH APPLE</Label>
      {state.user || mockGenerationEnabled() ? (
        <Row><Body color={C.white}>{state.user ? "Signed in." : "Skipped in development mock."}</Body>{state.user ? <Btn small kind="ghost" label="SIGN OUT" onPress={() => void store.signOut()} /> : null}</Row>
      ) : <SignIn onDone={() => undefined} />}

      <Label>REMINDERS</Label>
      <Row>
        <View style={{ flex: 1 }}><Text style={{ color: C.white, fontWeight: "800" }}>Daily five warm up</Text><Text style={{ color: C.lavender }}>Five questions from your own decks</Text></View>
        <Switch value={state.settings.warmupEnabled} onValueChange={v => store.setSettings({ warmupEnabled: v })} trackColor={{ true: C.green, false: C.dim }} />
      </Row>
      {state.settings.warmupEnabled ? <Row wrap>{[8, 12, 18, 21].map(h => <Chip key={h} label={`${h > 12 ? h - 12 : h}${h >= 12 ? " PM" : " AM"}`} selected={state.settings.warmupHour === h} onPress={() => store.setSettings({ warmupHour: h })} />)}</Row> : null}
      <Body>Exam, quiz and due date reminders are set from your syllabus. All reminders are local notifications on this device. There is no push server.</Body>

      <Label>PRIVACY</Label>
      <Note tone="info">Your material is sent to CramJam's AI service only to make your study material, find your syllabus dates, or answer a tutor or Teach Back request. It is processed for that request and not kept on our server afterward. Purchases run through Apple. There are no advertising trackers and your data is never sold. Everything you build is stored on this device.</Note>
      <Row wrap>
        <Btn small kind="ghost" label="PRIVACY POLICY" onPress={() => void Linking.openURL(PRIVACY_URL)} />
        <Btn small kind="ghost" label="TERMS" onPress={() => void Linking.openURL(TERMS_URL)} />
        <Btn small kind="ghost" label="SUPPORT" onPress={() => void Linking.openURL(SUPPORT_URL)} />
      </Row>

      <Label>DELETE EVERYTHING</Label>
      <Body>Wipes your classes, study sets, cards, answers and sign in from this device.</Body>
      <Btn kind="danger" label="DELETE EVERYTHING ON THIS DEVICE" onPress={confirmDelete} />
      <Body>{`${brand.name} ${Constants.expoConfig?.version ?? ""}`}</Body>
    </Screen>
  );
}

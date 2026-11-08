import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { Card } from "../components/Card";
import { Badge, Body, Btn, H1, Kicker, Label, Note, Screen, Spinner } from "../components/ui";
import { BOOST_TEN, PLAN_ANNUAL, PLAN_MONTHLY, isPro } from "../core/entitlement";
import { PRIVACY_URL, TERMS_URL } from "../core/links";
import { PaywallReason } from "../core/store";
import { StoreProduct, buy, iapAvailable, loadCatalog, restore } from "../services/iap";
import { useApp } from "../state/AppProvider";
import { C } from "../theme";

const HEAD: Record<PaywallReason, { title: string; body: string }> = {
  build: { title: "You've used your free Study Builds", body: "Pro makes new study sets from any notes, all season. Everything you've already built stays free forever." },
  "pro-exhausted": { title: "You've used this month's builds", body: "A Finals Boost adds more Study Builds right now, and they never expire. Everything you've already built stays free." },
  course: { title: "One course is free", body: "Pro adds every class you take. Reading a syllabus never costs anything, and your first course stays yours." },
  mock: { title: "Your free mock exam is used", body: "Pro gives you as many timed mock exams as you want. Your first report card stays in your history." },
  "server-limit": { title: "You've reached an allowance", body: "Your allowance for now is used. Pro raises it, and a Finals Boost adds Study Builds that never expire." },
};
const PERKS = ["More Study Builds every month", "Unlimited courses", "Unlimited timed mock exams", "Every learning mode, including Teach Back and Ask My Notes"];

export default function Paywall() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const r = (reason && reason in HEAD ? reason : "build") as PaywallReason;
  const { store, state, now } = useApp();
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [startBoosts] = useState(state.entitlement.boosts);
  const [startPro] = useState(isPro(state.entitlement, now));

  const load = useCallback(async () => {
    if (!iapAvailable()) { setProblem("platform"); return; }
    try { setProducts(await loadCatalog()); setProblem(null); } catch { setProblem("store"); }
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      if (!iapAvailable()) { if (live) setProblem("platform"); return; }
      try { const p = await loadCatalog(); if (live) setProducts(p); } catch { if (live) setProblem("store"); }
    })();
    return () => { live = false; };
  }, []);

  // A purchase or restore turns into the entitlement through the app's purchase listener.
  const nowPro = isPro(state.entitlement, now);
  const purchased = (nowPro && !startPro) || state.entitlement.boosts > startBoosts;
  const done = purchased;
  useEffect(() => {
    if (purchased) {
      const t = setTimeout(() => router.back(), 1400);
      return () => clearTimeout(t);
    }
  }, [purchased]);

  const pick = async (sku: string) => {
    setPending(sku); setMsg(null);
    try { await buy(sku); } catch { setMsg("The purchase didn't start. Nothing was charged."); }
    setPending(null);
  };

  const doRestore = async () => {
    setPending("restore"); setMsg(null);
    try {
      const subs = await restore();
      await store.recordActiveSubscriptions(subs);
      setMsg(subs.some(s => s.isActive !== false) ? "Restored." : "No active subscription was found for this Apple account.");
    } catch { setMsg("The App Store can't be reached, so nothing could be restored. Try again in a moment."); }
    setPending(null);
  };

  const find = (sku: string) => products?.find(p => p.sku === sku);
  const showBoost = r === "build" || r === "pro-exhausted" || r === "server-limit";
  const head = HEAD[r];

  return (
    <Screen backLabel="NOT NOW">
      <Kicker>CRAMJAM PRO</Kicker>
      <H1>{head.title}</H1>
      <Body>{head.body}</Body>
      <View style={{ gap: 6 }}>{PERKS.map(p => <Text key={p} style={{ color: C.white, fontSize: 15 }}>✓  {p}</Text>)}</View>

      {done ? <Note tone="good" title="YOU'RE IN">Thank you. Your purchase is active.</Note> : null}
      {!products && !problem ? <Spinner /> : null}
      {problem === "platform" ? <Note tone="warn" title="PURCHASES ARE ON IPHONE AND IPAD">Subscriptions and Boost packs are sold in the iOS app. Everything you've already built keeps working here.</Note> : null}
      {problem === "store" ? (
        <>
          <Note tone="bad" title="THE APP STORE CAN'T BE REACHED">Prices can't be shown and nothing can be bought right now. Nothing was charged. Check your connection and try again.</Note>
          <Btn label="TRY AGAIN" onPress={load} />
        </>
      ) : null}

      {products ? (
        <>
          {[PLAN_ANNUAL, PLAN_MONTHLY].map(sku => {
            const p = find(sku);
            if (!p) return null;
            const annual = sku === PLAN_ANNUAL;
            return (
              <Card key={sku} title={annual ? "ANNUAL" : "MONTHLY"} accent={annual ? C.yellow : C.violet}>
                {annual ? <Badge text="BEST VALUE" color={C.green} ink={C.ink} /> : null}
                <Text style={{ color: C.white, fontSize: 30, fontWeight: "900" }}>{p.price}<Text style={{ fontSize: 15, color: C.lavender }}>{annual ? " per year" : " per month"}</Text></Text>
                {annual && p.trial ? <Text style={{ color: C.green, fontWeight: "900" }}>FREE TRIAL INCLUDED</Text> : null}
                <Btn label={annual && p.trial ? "START FREE TRIAL" : "CHOOSE " + (annual ? "ANNUAL" : "MONTHLY")} kind={annual ? "primary" : "violet"} busy={pending === sku} disabled={!!pending || done} onPress={() => pick(sku)} />
              </Card>
            );
          })}
          {showBoost && find(BOOST_TEN) ? (
            <Card title="FINALS BOOST" accent={C.green}>
              <Text style={{ color: C.white, fontSize: 26, fontWeight: "900" }}>{find(BOOST_TEN)!.price}</Text>
              <Body>A pack of extra Study Builds that never expire. It works on the free plan or on Pro.</Body>
              <Btn kind="green" label="GET A BOOST PACK" busy={pending === BOOST_TEN} disabled={!!pending || done} onPress={() => pick(BOOST_TEN)} />
            </Card>
          ) : null}
        </>
      ) : null}

      {msg ? <Note tone="info">{msg}</Note> : null}
      {iapAvailable() ? <Btn kind="ghost" label="RESTORE PURCHASES" busy={pending === "restore"} disabled={!!pending} onPress={doRestore} /> : null}
      <Label>SUBSCRIPTION TERMS</Label>
      <Body>Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period. Payment is charged to your Apple ID. Manage or cancel any time in Settings, then Apple ID, then Subscriptions. Studying material you've already built is always free.</Body>
      <Btn small kind="ghost" label="TERMS OF USE" onPress={() => void Linking.openURL(TERMS_URL)} />
      <Btn small kind="ghost" label="PRIVACY POLICY" onPress={() => void Linking.openURL(PRIVACY_URL)} />
    </Screen>
  );
}

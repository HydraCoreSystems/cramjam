import { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";
import { C } from "../theme";

export function Card({ title, children, accent = C.violet }: PropsWithChildren<{ title?: string; accent?: string }>) {
  return (
    <View style={[s.card, { borderColor: accent }]}>
      {title ? <Text style={s.title}>{title}</Text> : null}
      {children}
    </View>
  );
}
const s = StyleSheet.create({
  card: { backgroundColor: C.paper, borderWidth: 3, borderRadius: 22, padding: 18, gap: 10 },
  title: { color: C.white, fontSize: 19, fontWeight: "900" },
});

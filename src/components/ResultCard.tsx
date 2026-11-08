import { ComponentRef, Ref } from "react";
import { Text, View } from "react-native";
import { C } from "../theme";

export type ViewHandle = ComponentRef<typeof View>;

/** Square card for social posts. Carries the CramJam name and a score, nothing private. */
export function ResultCard({ headline, big, foot, viewRef }: { headline: string; big: string; foot: string; viewRef: Ref<ViewHandle> }) {
  return (
    <View ref={viewRef} collapsable={false} style={{ backgroundColor: C.ink, borderRadius: 28, borderWidth: 6, borderColor: C.yellow, padding: 26, gap: 8, aspectRatio: 1, justifyContent: "space-between" }}>
      <Text style={{ color: C.yellow, fontWeight: "900", letterSpacing: 4, fontSize: 16 }}>CRAMJAM</Text>
      <View>
        <Text style={{ color: C.lavender, fontWeight: "900", letterSpacing: 2, fontSize: 13 }}>{headline}</Text>
        <Text style={{ color: C.white, fontWeight: "900", fontSize: 84, lineHeight: 92 }}>{big}</Text>
      </View>
      <Text style={{ color: C.green, fontWeight: "900", fontSize: 14 }}>{foot}</Text>
    </View>
  );
}

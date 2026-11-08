import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { passageFor } from "../core/build";
import { SourcePointer } from "../core/study";
import { useStore } from "../state/AppProvider";
import { C } from "../theme";
import { Label } from "./ui";

/** Shows where in the student's own material an answer comes from. */
export function SourceBox({ buildId, pointer }: { buildId: string | null; pointer?: SourcePointer }) {
  const store = useStore();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (buildId) store.sourceText(buildId).then(t => { if (live) setSrc(t); });
    return () => { live = false; };
  }, [store, buildId]);
  if (!pointer) return <Text style={{ color: C.lavender, fontSize: 12 }}>No source pointer came with this one.</Text>;
  const p = passageFor(src, pointer);
  return (
    <View style={{ gap: 4, backgroundColor: C.ink, borderRadius: 14, padding: 12, borderWidth: 2, borderColor: C.dim }}>
      <Label>{`FROM YOUR MATERIAL · ${pointer.label.toUpperCase()}`}</Label>
      {p ? (
        <Text style={{ color: C.lavender, lineHeight: 21 }}>
          {p.before ? `…${p.before}` : ""}<Text style={{ color: C.ink, backgroundColor: C.yellow, fontWeight: "800" }}>{p.hit}</Text>{p.after ? `${p.after}…` : ""}
        </Text>
      ) : pointer.quote ? (
        <Text style={{ color: C.white, lineHeight: 21 }}>“{pointer.quote}”</Text>
      ) : null}
    </View>
  );
}

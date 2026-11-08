import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Question } from "../core/study";
import { C } from "../theme";
import { Chip, Field, Label } from "./ui";

export type Response = string | { left: string; right: string }[];

/** Stable shuffle so the right column of a matching question does not jump around on re-render. */
function shuffled<T>(xs: T[], seed: string): T[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { h = (h * 1664525 + 1013904223) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const hasResponse = (q: Question, r: Response | null): boolean =>
  r != null && (typeof r === "string" ? r.trim().length > 0 : q.kind === "match" ? r.length === (q.pairs?.length ?? 0) : true);

export function QuestionInput({ q, value, onChange, disabled }: { q: Question; value: Response | null; onChange: (r: Response) => void; disabled?: boolean }) {
  const kind = q.kind ?? "short";
  const [pickLeft, setPickLeft] = useState<string | null>(null);
  const rights = useMemo(() => shuffled((q.pairs ?? []).map(p => p.right), q.id), [q]);

  if (kind === "mcq" || kind === "tf") {
    return (
      <View style={{ gap: 10 }}>
        {(q.options ?? ["True", "False"]).map(o => <Chip key={o} label={o} selected={value === o} onPress={() => !disabled && onChange(o)} />)}
      </View>
    );
  }
  if (kind === "match") {
    const pairs = Array.isArray(value) ? value : [];
    const rightTaken = (r: string) => pairs.some(p => p.right === r);
    return (
      <View style={{ gap: 12 }}>
        <Label>TAP A TERM, THEN ITS MATCH. TAP A PAIR TO UNDO.</Label>
        {(q.pairs ?? []).map(p => {
          const made = pairs.find(x => x.left === p.left);
          return (
            <Pressable key={p.left} disabled={disabled} onPress={() => made ? onChange(pairs.filter(x => x.left !== p.left)) : setPickLeft(p.left)} style={{ borderWidth: 3, borderRadius: 14, padding: 12, borderColor: pickLeft === p.left ? C.yellow : made ? C.green : C.violet, backgroundColor: C.paper }}>
              <Text style={{ color: C.white, fontWeight: "800" }}>{p.left}</Text>
              {made ? <Text style={{ color: C.green, marginTop: 4 }}>→ {made.right}</Text> : null}
            </Pressable>
          );
        })}
        <Label>MATCHES</Label>
        {rights.map(r => (
          <Pressable key={r} disabled={disabled || rightTaken(r) || !pickLeft} onPress={() => { if (pickLeft) { onChange([...pairs, { left: pickLeft, right: r }]); setPickLeft(null); } }} style={{ borderWidth: 3, borderRadius: 14, padding: 12, borderColor: C.violet, backgroundColor: C.paper, opacity: rightTaken(r) ? 0.35 : 1 }}>
            <Text style={{ color: C.white }}>{r}</Text>
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <Field
      value={typeof value === "string" ? value : ""}
      onChangeText={onChange}
      editable={!disabled}
      multiline={kind === "short"}
      placeholder={kind === "fill" ? "Type the missing word or phrase" : "Write your answer"}
      autoCapitalize="none"
    />
  );
}

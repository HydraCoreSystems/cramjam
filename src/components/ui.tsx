import { router } from "expo-router";
import { PropsWithChildren, ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { C } from "../theme";

export function Screen({ children, scroll = true, back = true, backLabel = "HOME", pad = true }: PropsWithChildren<{ scroll?: boolean; back?: boolean; backLabel?: string; pad?: boolean }>) {
  const body = (
    <>
      {back ? (
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={u.back}>{`‹ ${backLabel}`}</Text>
        </Pressable>
      ) : null}
      {children}
    </>
  );
  return (
    <SafeAreaView style={u.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {scroll ? (
          <ScrollView contentContainerStyle={[u.page, !pad && { padding: 0 }]} keyboardShouldPersistTaps="handled">{body}</ScrollView>
        ) : (
          <View style={[u.page, { flex: 1 }]}>{body}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export const Kicker = ({ children, color = C.yellow }: { children: ReactNode; color?: string }) => <Text style={[u.kicker, { color }]}>{children}</Text>;
export const H1 = ({ children, color = C.yellow }: { children: ReactNode; color?: string }) => <Text style={[u.h1, { color }]}>{children}</Text>;
export const Body = ({ children, color = C.lavender, style }: { children: ReactNode; color?: string; style?: object }) => <Text style={[u.body, { color }, style]}>{children}</Text>;
export const Label = ({ children }: { children: ReactNode }) => <Text style={u.label}>{children}</Text>;

type BtnKind = "primary" | "violet" | "green" | "ghost" | "danger";
export function Btn({ label, onPress, kind = "primary", disabled, busy, small, style }: { label: string; onPress: () => void; kind?: BtnKind; disabled?: boolean; busy?: boolean; small?: boolean; style?: ViewStyle }) {
  const bg = kind === "primary" ? C.yellow : kind === "violet" ? C.violet : kind === "green" ? C.green : kind === "danger" ? C.red : "transparent";
  const fg = kind === "violet" ? C.white : kind === "ghost" ? C.white : C.ink;
  const border = kind === "ghost" ? C.violet : kind === "violet" ? C.white : C.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy) }}
      style={({ pressed }) => [u.btn, small && u.btnSmall, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[u.btnText, { color: fg }, small && { fontSize: 13 }]}>{label}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, color = C.yellow }: { label: string; selected?: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }} style={[u.chip, selected && { backgroundColor: color, borderColor: C.white }]}>
      <Text style={[u.chipText, selected && { color: C.ink }]}>{label}</Text>
    </Pressable>
  );
}
export const Row = ({ children, gap = 10, wrap }: PropsWithChildren<{ gap?: number; wrap?: boolean }>) => <View style={{ flexDirection: "row", gap, flexWrap: wrap ? "wrap" : "nowrap", alignItems: "center" }}>{children}</View>;

export function Sticker({ top, big, color = C.violet }: { top: string; big: string; color?: string }) {
  return (
    <View style={[u.sticker, { backgroundColor: color }]}>
      <Text style={u.stickerTop}>{top}</Text>
      <Text style={u.stickerNum}>{big}</Text>
    </View>
  );
}

export function Badge({ text, color = C.violet, ink = C.white }: { text: string; color?: string; ink?: string }) {
  return <View style={[u.badge, { backgroundColor: color }]}><Text style={[u.badgeText, { color: ink }]}>{text}</Text></View>;
}

/** Honest state notes: the app saying plainly what is true. */
export function Note({ tone = "info", children, title }: { tone?: "info" | "good" | "warn" | "bad"; children: ReactNode; title?: string }) {
  const color = tone === "good" ? C.green : tone === "warn" ? C.yellow : tone === "bad" ? C.red : C.violet;
  return (
    <View style={[u.note, { borderColor: color }]} accessibilityRole={tone === "bad" ? "alert" : undefined}>
      {title ? <Text style={[u.noteTitle, { color }]}>{title}</Text> : null}
      <Text style={u.noteBody}>{children}</Text>
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <View style={u.empty}>
      <Text style={u.emptyTitle}>{title}</Text>
      <Text style={u.body}>{body}</Text>
      {action}
    </View>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput placeholderTextColor="#8C7BA6" {...rest} style={[u.input, rest.multiline && { minHeight: 120, textAlignVertical: "top" }, style]} />
    </View>
  );
}

export function Bar({ pct, color = C.green }: { pct: number; color?: string }) {
  return <View style={u.barTrack}><View style={[u.barFill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }]} /></View>;
}

export function Ring({ value, label = "READY" }: { value: number | null; label?: string }) {
  return (
    <View style={u.ring} accessibilityLabel={value == null ? "Readiness not started" : `Readiness ${value} out of 100`}>
      <Text style={u.ringNum}>{value == null ? "–" : value}</Text>
      <Text style={u.ringLabel}>{label}</Text>
    </View>
  );
}

/** Tiny markdown: ## headings, - bullets, **bold** terms. */
export function Md({ text }: { text: string }) {
  const lines = text.split("\n");
  const inline = (s: string, key: number) => (
    <Text key={key} style={u.mdLine}>
      {s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <Text key={i} style={u.mdBold}>{p.slice(2, -2)}</Text> : p))}
    </Text>
  );
  return (
    <View style={{ gap: 6 }}>
      {lines.map((l, i) => {
        if (!l.trim()) return null;
        if (/^#{1,3}\s/.test(l)) return <Text key={i} style={u.mdH}>{l.replace(/^#+\s*/, "")}</Text>;
        if (/^[-*]\s/.test(l)) return <View key={i} style={{ flexDirection: "row", gap: 8 }}><Text style={u.mdLine}>•</Text><View style={{ flex: 1 }}>{inline(l.replace(/^[-*]\s+/, ""), i)}</View></View>;
        return inline(l, i);
      })}
    </View>
  );
}

export const Spinner = () => <ActivityIndicator color={C.yellow} size="large" style={{ marginTop: 40 }} />;

export const u = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ink },
  page: { padding: 20, gap: 16, paddingBottom: 60 },
  back: { color: C.lavender, fontWeight: "900", marginTop: 8, letterSpacing: 1 },
  kicker: { fontWeight: "900", letterSpacing: 2, fontSize: 12 },
  h1: { fontSize: 32, fontWeight: "900", lineHeight: 38 },
  body: { fontSize: 15, lineHeight: 22, color: C.lavender },
  label: { color: C.lavender, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  btn: { paddingVertical: 16, paddingHorizontal: 18, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 3, minHeight: 54 },
  btnSmall: { paddingVertical: 10, minHeight: 42, borderRadius: 14 },
  btnText: { fontWeight: "900", fontSize: 15, letterSpacing: 0.5 },
  chip: { borderWidth: 3, borderColor: C.violet, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: C.paper },
  chipText: { color: C.white, fontWeight: "900", fontSize: 13 },
  sticker: { borderRadius: 40, borderWidth: 3, borderColor: C.white, width: 72, height: 72, alignItems: "center", justifyContent: "center", transform: [{ rotate: "8deg" }] },
  stickerTop: { color: C.white, fontSize: 9, fontWeight: "900" },
  stickerNum: { color: C.yellow, fontSize: 26, fontWeight: "900" },
  badge: { alignSelf: "flex-start", borderRadius: 10, paddingVertical: 4, paddingHorizontal: 9, transform: [{ rotate: "-2deg" }] },
  badgeText: { fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  note: { borderWidth: 3, borderRadius: 18, padding: 14, gap: 4, backgroundColor: C.paper },
  noteTitle: { fontWeight: "900", fontSize: 12, letterSpacing: 1.5 },
  noteBody: { color: C.white, fontSize: 14, lineHeight: 21 },
  empty: { borderWidth: 3, borderStyle: "dashed", borderColor: C.violet, borderRadius: 22, padding: 22, gap: 10 },
  emptyTitle: { color: C.white, fontSize: 20, fontWeight: "900" },
  input: { backgroundColor: C.paper, borderWidth: 3, borderColor: C.violet, borderRadius: 16, color: C.white, padding: 14, fontSize: 16 },
  barTrack: { height: 12, borderRadius: 8, backgroundColor: C.dim, overflow: "hidden" },
  barFill: { height: 12, borderRadius: 8 },
  ring: { borderWidth: 4, borderColor: C.green, borderRadius: 50, width: 84, height: 84, alignItems: "center", justifyContent: "center" },
  ringNum: { color: C.white, fontSize: 30, fontWeight: "900" },
  ringLabel: { color: C.green, fontSize: 10, fontWeight: "900" },
  mdLine: { color: C.white, fontSize: 15, lineHeight: 23 },
  mdBold: { color: C.yellow, fontWeight: "900" },
  mdH: { color: C.yellow, fontSize: 17, fontWeight: "900", marginTop: 8 },
});

import { Switch, Text, View } from "react-native";
import { parseItemDate } from "../core/dates";
import { ITEM_KIND_LABEL, ItemKind, SkeletonItem, isDatedKind } from "../core/syllabus";
import { C } from "../theme";
import { Badge, Btn, Field, Label, Row } from "./ui";

const ORDER: ItemKind[] = ["exam", "quiz", "assignment", "grading", "material", "officeHours", "topic", "note"];
const ADD_LABEL: Partial<Record<ItemKind, string>> = { exam: "+ EXAM", quiz: "+ QUIZ", assignment: "+ DUE DATE", grading: "+ WEIGHT", material: "+ MATERIAL", officeHours: "+ OFFICE HOURS", topic: "+ TOPIC" };

/** Every extracted item, editable. Used on the syllabus confirmation screen and the course page. */
export function DraftEditor({ items, onChange, newId }: { items: SkeletonItem[]; onChange: (items: SkeletonItem[]) => void; newId: () => string }) {
  const patch = (id: string, p: Partial<SkeletonItem>) => onChange(items.map(i => (i.id === id ? { ...i, ...p } : i)));
  const add = (kind: ItemKind) => onChange([...items, { id: newId(), kind, label: "", date: null, weight: null, detail: "", include: true }]);
  return (
    <View style={{ gap: 18 }}>
      {ORDER.map(kind => {
        const group = items.filter(i => i.kind === kind);
        if (!group.length && !ADD_LABEL[kind]) return null;
        return (
          <View key={kind} style={{ gap: 10 }}>
            <Row gap={8}>
              <View style={{ flex: 1 }}><Label>{`${ITEM_KIND_LABEL[kind]} (${group.length})`}</Label></View>
              {ADD_LABEL[kind] ? <Btn small kind="ghost" label={ADD_LABEL[kind]!} onPress={() => add(kind)} style={{ paddingHorizontal: 12 }} /> : null}
            </Row>
            {group.map(it => {
              const dated = isDatedKind(it.kind);
              const badDate = !!it.date && !parseItemDate(it.date);
              const missingDate = dated && !it.date;
              return (
                <View key={it.id} style={{ backgroundColor: C.paper, borderRadius: 18, borderWidth: 3, borderColor: it.include ? C.violet : C.dim, padding: 12, gap: 10, opacity: it.include ? 1 : 0.55 }}>
                  <Row>
                    <Badge text={ITEM_KIND_LABEL[it.kind]} color={it.kind === "exam" ? C.yellow : C.violet} ink={it.kind === "exam" ? C.ink : C.white} />
                    <View style={{ flex: 1 }} />
                    <Text style={{ color: C.lavender, fontSize: 11, fontWeight: "900" }}>{it.include ? "KEEP" : "SKIP"}</Text>
                    <Switch value={it.include} onValueChange={v => patch(it.id, { include: v })} trackColor={{ true: C.green, false: C.dim }} accessibilityLabel={`Include ${it.label || "item"}`} />
                  </Row>
                  <Field value={it.label} onChangeText={t => patch(it.id, { label: t })} placeholder={it.kind === "officeHours" ? "Who and where" : "Name"} />
                  {dated || it.kind === "grading" ? (
                    <Row>
                      {dated ? (
                        <View style={{ flex: 1.4 }}>
                          <Field value={it.date ?? ""} onChangeText={t => patch(it.id, { date: t.trim() ? t.trim() : null })} placeholder="YYYY-MM-DD" autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" />
                        </View>
                      ) : null}
                      <View style={{ flex: 1 }}>
                        <Field value={it.weight == null ? "" : String(it.weight)} onChangeText={t => patch(it.id, { weight: t.trim() === "" || isNaN(Number(t.replace("%", ""))) ? null : Number(t.replace("%", "")) })} placeholder="% of grade" keyboardType="decimal-pad" />
                      </View>
                    </Row>
                  ) : null}
                  {badDate ? <Text style={{ color: C.red, fontWeight: "800" }}>CramJam can't read that date. Use YYYY-MM-DD.</Text> : null}
                  {missingDate && it.include ? <Text style={{ color: C.yellow, fontWeight: "800" }}>No date found. Add one to get a countdown and reminders.</Text> : null}
                  {!dated && it.kind !== "grading" ? <Field value={it.detail} onChangeText={t => patch(it.id, { detail: t })} placeholder="Details" multiline style={{ minHeight: 60 }} /> : null}
                  {dated && it.detail ? <Text style={{ color: C.lavender }}>{it.detail}</Text> : null}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

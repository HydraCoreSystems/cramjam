import { parseItemDate } from "./dates";

export type ItemKind = "exam" | "quiz" | "assignment" | "grading" | "material" | "officeHours" | "topic" | "note";

export const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  exam: "EXAM",
  quiz: "QUIZ",
  assignment: "DUE",
  grading: "GRADING WEIGHT",
  material: "MATERIAL",
  officeHours: "OFFICE HOURS",
  topic: "WEEKLY TOPIC",
  note: "OTHER",
};

/** One line of the course skeleton. Dated kinds get a countdown once confirmed. */
export interface SkeletonItem {
  id: string;
  kind: ItemKind;
  label: string;
  /** YYYY-MM-DD, or a full ISO timestamp when the syllabus states a time. Null when none was found. */
  date: string | null;
  /** Percent of the course grade, 0 to 100. */
  weight: number | null;
  detail: string;
  /** The student can untick an item on the confirmation screen. Only included items are saved. */
  include: boolean;
}

export interface SyllabusDraft { courseName: string; items: SkeletonItem[]; confirmed: boolean }

export const isDatedKind = (k: ItemKind) => k === "exam" || k === "quiz" || k === "assignment";
export const isTestKind = (k: ItemKind) => k === "exam" || k === "quiz";

const KIND_ALIASES: Record<string, ItemKind | "course"> = {
  exam: "exam", exams: "exam", final: "exam", midterm: "exam", test: "exam",
  quiz: "quiz", quizzes: "quiz",
  assignment: "assignment", assignments: "assignment", due: "assignment", homework: "assignment", deadline: "assignment", project: "assignment", paper: "assignment", lab: "assignment",
  grading: "grading", weight: "grading", weights: "grading", grade: "grading", component: "grading", "grading weight": "grading", "grading weights": "grading",
  material: "material", materials: "material", textbook: "material", book: "material", reading: "material", readings: "material",
  officehours: "officeHours", office_hours: "officeHours", "office-hours": "officeHours", "office hours": "officeHours", office: "officeHours",
  topic: "topic", topics: "topic", week: "topic", weekly: "topic", weekly_topic: "topic", schedule: "topic",
  course: "course", course_name: "course", coursename: "course", title: "course",
};

const squash = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
const ALIAS_BY_SQUASHED = new Map(Object.entries(KIND_ALIASES).map(([k, v]) => [squash(k), v]));

export function normalizeKind(raw: unknown): ItemKind | "course" {
  if (typeof raw !== "string") return "note";
  return ALIAS_BY_SQUASHED.get(squash(raw.trim())) ?? "note";
}

export function normalizeWeight(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw >= 0 && raw <= 100 ? Math.round(raw * 10) / 10 : null;
  if (typeof raw === "string") {
    const m = /(\d+(?:\.\d+)?)\s*%?/.exec(raw);
    if (m) return normalizeWeight(Number(m[1]));
  }
  return null;
}

export class SyllabusResponseError extends Error {}

export interface SyllabusMapping { items: SkeletonItem[]; courseName: string | null; dropped: number }

/**
 * Maps the /v1/syllabus response into skeleton items. Nothing the server found is thrown away:
 * unknown kinds become OTHER, bad dates are blanked so the student can fix them on screen.
 */
export function mapSyllabusResponse(resp: unknown, newId: () => string): SyllabusMapping {
  const list = (resp as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) throw new SyllabusResponseError("The syllabus reader sent back something CramJam could not read.");
  const items: SkeletonItem[] = [];
  let courseName: string | null = null;
  let dropped = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") { dropped++; continue; }
    const r = raw as Record<string, unknown>;
    const kind = normalizeKind(r.kind);
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const detail = typeof r.detail === "string" ? r.detail.trim() : "";
    if (kind === "course") {
      if (label && !courseName) courseName = label;
      continue;
    }
    if (!label && !detail) { dropped++; continue; }
    const rawDate = typeof r.date === "string" ? r.date.trim() : "";
    const parsed = rawDate ? parseItemDate(rawDate) : null;
    items.push({
      id: newId(),
      kind,
      label: label || detail,
      date: parsed ? rawDate : null,
      weight: normalizeWeight(r.weight),
      detail: label ? detail : "",
      include: true,
    });
  }
  return { items, courseName, dropped };
}

/**
 * Builds the draft the confirmation screen shows. Given the endpoint response it carries every
 * extracted item. With no response it is an honest empty draft the student fills by hand.
 * Parsing never spends a Study Build, on either tier.
 */
export function parseSyllabus(courseName: string, mapped?: SyllabusMapping): { draft: SyllabusDraft; buildsSpent: 0 } {
  return {
    draft: { courseName: mapped?.courseName ?? courseName, items: mapped?.items ?? [], confirmed: false },
    buildsSpent: 0,
  };
}

/** The first line that looks like a course title, used only to prefill the editable name field. */
export function guessCourseName(text: string): string {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 25);
  const code = lines.find(l => /^[A-Z]{2,5}\s?-?\d{3,4}[A-Z]?\b/.test(l) && l.length <= 90);
  if (code) return code;
  const titled = lines.find(l => /^(course|class)\s*(title|name)?\s*:/i.test(l));
  if (titled) return titled.replace(/^[^:]*:\s*/, "").slice(0, 90);
  return "";
}

export interface DraftProblem { field: "name" | "item"; itemId?: string; message: string }

export function draftProblems(draft: SyllabusDraft): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!draft.courseName.trim()) out.push({ field: "name", message: "Name the course." });
  for (const it of draft.items) {
    if (!it.include) continue;
    if (it.date && !parseItemDate(it.date)) out.push({ field: "item", itemId: it.id, message: `Fix the date for ${it.label}. Use YYYY-MM-DD.` });
    if (it.weight != null && (it.weight < 0 || it.weight > 100)) out.push({ field: "item", itemId: it.id, message: `${it.label}: weight must be 0 to 100.` });
  }
  return out;
}

/** The course skeleton saves only after the student accepts it. */
export const confirmSkeleton = (draft: SyllabusDraft, accepted: boolean): SyllabusDraft | null =>
  accepted ? { ...draft, courseName: draft.courseName.trim(), items: draft.items.filter(i => i.include && i.label.trim()), confirmed: true } : null;

export interface PlanItem { title: string; daysLeft: number; weight: number; minutes: number }
export function weightPlan(items: Omit<PlanItem, "minutes">[]): PlanItem[] {
  const total = items.reduce((n, i) => n + i.weight / Math.max(1, i.daysLeft), 0) || 1;
  return items.map(i => ({ ...i, minutes: Math.round(120 * (i.weight / Math.max(1, i.daysLeft)) / total) }));
}

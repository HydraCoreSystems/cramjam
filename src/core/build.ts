import { Question, QuestionKind, SourcePointer, StudyBuild, fingerprint } from "./study";

export interface Card { id: string; front: string; back: string; topic: string; source?: SourcePointer }
export type FactKind = "formula" | "date" | "definition" | "name" | "fact";
export interface Fact { id: string; kind: FactKind; label: string; value: string; source?: SourcePointer }
/** A question the model thinks a professor could write. Always a prediction, never exam content. */
export interface LikelyQuestion { id: string; topic: string; prompt: string; outline: string; source?: SourcePointer }

/** The full Study Build: five products from one call, plus where it came from. */
export interface FullBuild extends StudyBuild {
  id: string;
  /** SHA-256 of the normalized source text. Cache key. */
  hash: string;
  courseId: string | null;
  courseName: string;
  title: string;
  createdAt: number;
  origin: "generated" | "imported";
  cards: Card[];
  facts: Fact[];
  likely: LikelyQuestion[];
}

/** What POST /v1/build must return. Documented for the server owner in docs/SERVER_CONTRACT.md. */
export class BuildResponseError extends Error {}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function normalizePointer(raw: unknown): SourcePointer | undefined {
  if (typeof raw === "string" && raw.trim()) return { label: raw.trim() };
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const label = str(r.label) || str(r.locator) || str(r.where) || str(r.location) || str(r.title);
  const quote = str(r.quote) || str(r.excerpt) || str(r.text) || str(r.snippet);
  const start = typeof r.start === "number" ? r.start : undefined;
  const end = typeof r.end === "number" ? r.end : undefined;
  if (!label && !quote && start == null) return undefined;
  return { label: label || (quote ? "From your material" : "From your material"), quote: quote || undefined, start, end };
}

const KIND_ALIASES: Record<string, QuestionKind> = {
  mcq: "mcq", mc: "mcq", multiplechoice: "mcq", multiple_choice: "mcq", "multiple-choice": "mcq", "multiple choice": "mcq",
  tf: "tf", truefalse: "tf", true_false: "tf", "true-false": "tf", "true or false": "tf", "true/false": "tf", boolean: "tf",
  short: "short", shortanswer: "short", short_answer: "short", "short-answer": "short", "short answer": "short", open: "short",
  fill: "fill", fillblank: "fill", fill_in_the_blank: "fill", "fill-in-the-blank": "fill", "fill in the blank": "fill", blank: "fill", cloze: "fill",
  match: "match", matching: "match",
};

export function normalizeQuestionKind(raw: unknown): QuestionKind | null {
  const k = str(raw).toLowerCase();
  return KIND_ALIASES[k] ?? KIND_ALIASES[k.replace(/[\s_-]/g, "")] ?? null;
}

function normalizeQuestion(raw: unknown, prefix: string, i: number): Question | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const prompt = str(r.prompt) || str(r.question);
  let answer = str(r.answer);
  if (!prompt) return null;
  let kind = normalizeQuestionKind(r.kind ?? r.type) ?? "short";
  const topic = str(r.topic) || "General";
  let options: string[] | undefined;
  let pairs: { left: string; right: string }[] | undefined;
  if (kind === "mcq") {
    options = Array.isArray(r.options) ? r.options.map(str).filter(Boolean) : [];
    if (options.length < 2) kind = "short";
    else if (/^[A-Za-z]$/.test(answer)) {
      const idx = answer.toUpperCase().charCodeAt(0) - 65;
      if (options[idx]) answer = options[idx];
    }
    if (kind === "mcq" && !options.includes(answer)) {
      // The answer must be one of the options, otherwise the question cannot be graded.
      const hit = options.find(o => o.toLowerCase() === answer.toLowerCase());
      if (hit) answer = hit; else return null;
    }
  }
  if (kind === "tf") {
    const a = answer.toLowerCase();
    if (a === "true" || a === "t" || a === "yes") answer = "True";
    else if (a === "false" || a === "f" || a === "no") answer = "False";
    else return null;
    options = ["True", "False"];
  }
  if (kind === "match") {
    const list = Array.isArray(r.pairs) ? r.pairs : [];
    pairs = list
      .map(p => (p && typeof p === "object" ? { left: str((p as Record<string, unknown>).left), right: str((p as Record<string, unknown>).right) } : null))
      .filter((p): p is { left: string; right: string } => !!p && !!p.left && !!p.right);
    if (pairs.length < 2) return null;
    if (!answer) answer = pairs.map(p => `${p.left} = ${p.right}`).join("; ");
  }
  if (!answer) return null;
  const diff = r.difficulty === 1 || r.difficulty === 2 || r.difficulty === 3 ? r.difficulty : undefined;
  return {
    id: `${prefix}:q${i}`,
    topic, prompt, answer, kind, options, pairs,
    reason: str(r.reason) || str(r.explanation) || undefined,
    source: normalizePointer(r.source ?? r.sourcePointer ?? r.pointer),
    difficulty: diff,
  };
}

export interface NormalizeContext { id: string; hash: string; courseId: string | null; courseName: string; now: number; origin: FullBuild["origin"] }

/**
 * Validates whatever the server sent and shapes it into a FullBuild. Malformed single entries are
 * dropped. A response with no summary or nothing to study is rejected, so a bad reply never
 * spends a build.
 */
export function normalizeBuild(raw: unknown, ctx: NormalizeContext): FullBuild {
  if (!raw || typeof raw !== "object") throw new BuildResponseError("The study set came back empty.");
  const r = raw as Record<string, unknown>;
  const summary = str(r.summary);
  if (!summary) throw new BuildResponseError("The study set came back without a summary.");
  const questions = (Array.isArray(r.questions) ? r.questions : []).map((q, i) => normalizeQuestion(q, ctx.id, i)).filter((q): q is Question => !!q);
  const cards: Card[] = (Array.isArray(r.cards) ? r.cards : r.flashcards && Array.isArray(r.flashcards) ? r.flashcards : [])
    .map((c: unknown, i: number): Card | null => {
      const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      const front = str(o.front) || str(o.term) || str(o.question);
      const back = str(o.back) || str(o.definition) || str(o.answer);
      return front && back ? { id: `${ctx.id}:c${i}`, front, back, topic: str(o.topic) || "General", source: normalizePointer(o.source ?? o.sourcePointer ?? o.pointer) } : null;
    })
    .filter((c: Card | null): c is Card => !!c);
  if (!cards.length && !questions.length) throw new BuildResponseError("The study set had no cards or questions.");
  const factRaw = Array.isArray(r.facts) ? r.facts : Array.isArray(r.formulas) ? r.formulas : [];
  const facts: Fact[] = factRaw
    .map((f: unknown, i: number): Fact | null => {
      const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      const label = str(o.label) || str(o.name) || str(o.term);
      const value = str(o.value) || str(o.definition) || str(o.formula);
      const k = str(o.kind).toLowerCase();
      const kind: FactKind = k === "formula" || k === "date" || k === "definition" || k === "name" ? k : "fact";
      return label && value ? { id: `${ctx.id}:f${i}`, kind, label, value, source: normalizePointer(o.source ?? o.sourcePointer ?? o.pointer) } : null;
    })
    .filter((f: Fact | null): f is Fact => !!f);
  const likelyRaw = Array.isArray(r.likely) ? r.likely : Array.isArray(r.likelyQuestions) ? r.likelyQuestions : Array.isArray(r.likelyExamQuestions) ? r.likelyExamQuestions : [];
  const likely: LikelyQuestion[] = likelyRaw
    .map((l: unknown, i: number): LikelyQuestion | null => {
      const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
      const prompt = str(o.prompt) || str(o.question);
      return prompt ? { id: `${ctx.id}:l${i}`, topic: str(o.topic) || "General", prompt, outline: str(o.outline) || str(o.answer) || str(o.reason), source: normalizePointer(o.source ?? o.sourcePointer ?? o.pointer) } : null;
    })
    .filter((l: LikelyQuestion | null): l is LikelyQuestion => !!l);
  return {
    id: ctx.id, hash: ctx.hash, fingerprint: ctx.hash,
    courseId: ctx.courseId, courseName: ctx.courseName,
    title: str(r.title) || ctx.courseName || "Study set",
    createdAt: ctx.now, origin: ctx.origin,
    summary, questions, cards, facts, likely,
  };
}

/** Splits the markdown summary into its `## ` sections so any one can be restated simpler. */
export function summarySections(summary: string): { heading: string; body: string }[] {
  const parts = summary.split(/^##\s+/m);
  const out: { heading: string; body: string }[] = [];
  const intro = parts.shift()?.replace(/^#\s+.*$/m, "").trim();
  if (intro) out.push({ heading: "Overview", body: intro });
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const heading = (nl < 0 ? p : p.slice(0, nl)).trim();
    const body = (nl < 0 ? "" : p.slice(nl + 1)).trim();
    if (heading || body) out.push({ heading: heading || "Notes", body });
  }
  return out.length ? out : [{ heading: "Summary", body: summary }];
}

/** Text a spoken summary should read: no markdown marks. */
export function speakableSummary(summary: string): string {
  return summary.replace(/^#+\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[-*]\s+/gm, "").replace(/`/g, "").trim();
}

/** Passage of the source around a pointer, for the "show me where" view. Null when unavailable. */
export function passageFor(source: string | null, p: SourcePointer | undefined, radius = 220): { before: string; hit: string; after: string } | null {
  if (!source || !p) return null;
  let start = typeof p.start === "number" && p.start >= 0 && p.start < source.length ? p.start : -1;
  let end = typeof p.end === "number" && p.end > start ? Math.min(p.end, source.length) : -1;
  if (start < 0 && p.quote) {
    const i = source.toLowerCase().indexOf(p.quote.toLowerCase().slice(0, 120));
    if (i >= 0) { start = i; end = Math.min(source.length, i + p.quote.length); }
  }
  if (start < 0) return null;
  if (end < 0) end = Math.min(source.length, start + 160);
  return { before: source.slice(Math.max(0, start - radius), start), hit: source.slice(start, end), after: source.slice(end, end + radius) };
}

export const cleanSource = (text: string) => fingerprint(text);

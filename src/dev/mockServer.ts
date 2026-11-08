import { Api, AskRequest, AskResponse, BuildRequest } from "../core/api";
import { chunkText, topChunks } from "../core/retrieve";

/**
 * DEVELOPMENT MOCK of the three server endpoints. It is loaded only when
 * EXPO_PUBLIC_MOCK_GENERATION=1 in a development build (see services/apiFactory.ts).
 * It is deliberately plain and labelled so it can never be mistaken for real output.
 */
const sentencesOf = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 25);
const pointer = (text: string, s: string, i: number) => {
  const start = text.indexOf(s.slice(0, 40));
  return { label: `Sentence ${i + 1}`, quote: s, start: start >= 0 ? start : undefined, end: start >= 0 ? start + s.length : undefined };
};

function mockBuild(req: BuildRequest): unknown {
  const text = req.text;
  const ss = sentencesOf(text);
  const base = ss.length ? ss : [text.slice(0, 200) || "No material."];
  const topics = ["Topic 1", "Topic 2", "Topic 3"];
  const topicOf = (i: number) => topics[Math.floor((i * topics.length) / base.length) % topics.length];
  const words = (s: string) => s.split(/\s+/).filter(w => /^[A-Za-z]{5,}$/.test(w));
  const summary = ["# DEV MOCK SUMMARY (not real AI output)"]
    .concat(topics.map((t, ti) => `## ${t}\n` + base.filter((_, i) => i % topics.length === ti).slice(0, 4).map(s => `- ${s.replace(/\b([A-Z][a-z]{4,})\b/, "**$1**")}`).join("\n")))
    .join("\n\n");
  const cards = base.slice(0, 24).map((s, i) => ({ front: `Complete the idea: ${s.split(" ").slice(0, 6).join(" ")}…`, back: s, topic: topicOf(i), source: pointer(text, s, i) }));
  const questions = base.slice(0, 15).flatMap((s, i) => {
    const ws = words(s);
    const key = ws.sort((a, b) => b.length - a.length)[0];
    const src = pointer(text, s, i);
    const t = topicOf(i);
    const kinds = ["mcq", "tf", "short", "fill", "match"] as const;
    const kind = kinds[i % 5];
    if (kind === "mcq" && key) {
      const others = base.flatMap(words).filter(w => w !== key).slice(i, i + 3);
      while (others.length < 3) others.push(`Option${others.length}`);
      return [{ kind, topic: t, difficulty: ((i % 3) + 1), prompt: `Which term fits: "${s.replace(key, "_____")}"`, options: [key, ...others], answer: key, reason: "The sentence in your material uses this term.", source: src }];
    }
    if (kind === "tf") return [{ kind, topic: t, prompt: i % 2 ? s : s.replace(/\b(is|are)\b/, "$1 not"), answer: i % 2 ? "true" : s.match(/\b(is|are)\b/) ? "false" : "true", reason: "Compare with the sentence in your material.", source: src }];
    if (kind === "fill" && key) return [{ kind, topic: t, prompt: s.replace(key, "_____"), answer: key, reason: "This word was removed from your material.", source: src }];
    if (kind === "match") {
      const trio = base.slice(i, i + 3);
      if (trio.length === 3) return [{ kind, topic: t, prompt: "Match each opening to its ending.", pairs: trio.map(x => ({ left: x.split(" ").slice(0, 3).join(" "), right: x.split(" ").slice(3).join(" ") })), answer: "", reason: "Each pair is one sentence from your material.", source: src }];
    }
    return [{ kind: "short", topic: t, prompt: `In your own words: ${s.split(" ").slice(0, 8).join(" ")}…`, answer: s, reason: "Model answer is the sentence from your material.", source: src }];
  });
  const facts = base.filter(s => /\d|=/.test(s)).slice(0, 8).map((s, i) => ({ kind: /=/.test(s) ? "formula" : "fact", label: `Item ${i + 1}`, value: s, source: pointer(text, s, i) }));
  const likely = base.slice(0, 4).map((s, i) => ({ topic: topicOf(i), prompt: `Explain: ${s.split(" ").slice(0, 10).join(" ")}…`, outline: s, source: pointer(text, s, i) }));
  return { title: req.courseName ? `${req.courseName} (dev mock)` : "Dev mock set", summary, cards, questions, facts, likely };
}

const MONTHS = "january february march april may june july august september october november december".split(" ");
function dateIn(line: string, year: number): string | null {
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(line);
  if (m) return m[0];
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(line);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = new RegExp(`\\b(${MONTHS.join("|")}|${MONTHS.map(x => x.slice(0, 3)).join("|")})\\.? (\\d{1,2})(?:,? (\\d{4}))?`, "i").exec(line);
  if (m) {
    const mi = MONTHS.findIndex(x => x.startsWith(m![1].toLowerCase().slice(0, 3)));
    return `${m[3] ?? year}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

function mockSyllabus(text: string): unknown {
  const year = new Date().getFullYear();
  const items: Record<string, unknown>[] = [];
  const first = text.split(/\r?\n/).map(l => l.trim()).find(l => /^[A-Z]{2,5}\s?\d{3}/.test(l));
  if (first) items.push({ kind: "course", label: first.slice(0, 80) });
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const date = dateIn(line, year);
    const pct = /(\d{1,3})\s?%/.exec(line);
    const w = pct ? Number(pct[1]) : null;
    if (/office hours/i.test(line)) items.push({ kind: "officeHours", label: "Office hours", date: null, weight: null, detail: line });
    else if (/final|midterm|exam/i.test(line)) items.push({ kind: "exam", label: line.replace(/\s+/g, " ").slice(0, 60), date, weight: w, detail: "" });
    else if (/quiz/i.test(line)) items.push({ kind: "quiz", label: line.slice(0, 60), date, weight: w, detail: "" });
    else if (date && /due|assignment|homework|paper|project|lab/i.test(line)) items.push({ kind: "assignment", label: line.slice(0, 60), date, weight: w, detail: "" });
    else if (/textbook|required|reading/i.test(line)) items.push({ kind: "material", label: line.slice(0, 80), date: null, weight: null, detail: "" });
    else if (/^week \d+/i.test(line)) items.push({ kind: "topic", label: line.slice(0, 80), date: null, weight: null, detail: "" });
    else if (w != null) items.push({ kind: "grading", label: line.slice(0, 60), date: null, weight: w, detail: "" });
  }
  return { items };
}

function mockAsk(req: AskRequest): AskResponse {
  const pool = req.chunks.length ? req.chunks : chunkText(req.question);
  const best = topChunks(pool, req.question, 1)[0] ?? pool[0] ?? "";
  const label = req.mode === "teachback" ? "Teach Back grading" : req.mode === "simpler" ? "Simpler wording" : "Tutor";
  return {
    answer: `[DEV MOCK, not real AI] ${label} is not generated in mock mode. Closest passage in your material:\n\n${best || "No passage found."}`,
    sourcePointers: best ? [{ label: "Closest passage", quote: best.slice(0, 160) }] : [],
  };
}

export function createMockApi(): Api {
  const wait = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 350));
  return {
    build: req => wait(mockBuild(req)),
    syllabus: text => wait(mockSyllabus(text)),
    ask: req => wait(mockAsk(req)),
  };
}

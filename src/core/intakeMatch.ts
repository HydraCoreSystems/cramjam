import { tokens } from "./retrieve";

/**
 * Files new material under a course by the name CramJam already holds. One course: that course.
 * Several: the course whose name or code appears in the material. No clear match: null, and the
 * student picks.
 */
export function guessCourseForText(text: string, courses: { id: string; name: string }[]): string | null {
  if (courses.length === 1) return courses[0].id;
  if (!courses.length) return null;
  const hay = text.toLowerCase().replace(/\s+/g, " ");
  const compact = hay.replace(/\s/g, "");
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const c of courses) {
    const name = c.name.toLowerCase().replace(/\s+/g, " ").trim();
    let score = 0;
    if (name && hay.includes(name)) score += 10;
    const code = /[a-z]{2,5}\s?-?\d{3,4}[a-z]?/.exec(name)?.[0].replace(/[\s-]/g, "");
    if (code && compact.includes(code)) score += 8;
    for (const t of tokens(name)) if (t.length > 3 && hay.includes(t)) score += 1;
    if (score > (best?.score ?? 0)) { best = { id: c.id, score }; tie = false; }
    else if (best && score === best.score && score > 0) tie = true;
  }
  return best && best.score >= 3 && !tie ? best.id : null;
}

/** Syllabus topics are the tags the drill reports against. Maps a build topic onto the closest one. */
export function matchTopic(topic: string, syllabusTopics: string[]): string {
  const t = new Set(tokens(topic));
  if (!t.size || !syllabusTopics.length) return topic;
  let best: { s: string; n: number } | null = null;
  for (const s of syllabusTopics) {
    const n = tokens(s).filter(x => t.has(x)).length;
    if (n > (best?.n ?? 0)) best = { s, n };
  }
  return best ? best.s : topic;
}

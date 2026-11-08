/** Only text goes up, capped per call. The server stays the authority on its own bounds. */
export const MAX_BUILD_CHARS = 60_000;
export const MAX_SYLLABUS_CHARS = 40_000;
/** Below this there is not enough material to build a study set from. */
export const MIN_BUILD_CHARS = 200;

export interface Capped { text: string; truncated: boolean; originalLength: number }

/** Cuts at the last paragraph or sentence break before the cap, never mid word. */
export function capText(text: string, max: number): Capped {
  const t = text.trim();
  if (t.length <= max) return { text: t, truncated: false, originalLength: t.length };
  const head = t.slice(0, max);
  const cut = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf(". "), head.lastIndexOf("\n"));
  return { text: (cut > max * 0.6 ? head.slice(0, cut + 1) : head).trim(), truncated: true, originalLength: t.length };
}

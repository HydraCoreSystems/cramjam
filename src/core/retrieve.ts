const STOP = new Set("a an and are as at be but by for from has have how i in is it its of on or that the this to was what when where which who why with you your do does did can".split(" "));

export const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 2 && !STOP.has(t));

/** Splits material into passages of roughly `size` characters on paragraph and sentence breaks. */
export function chunkText(text: string, size = 700): string[] {
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ""; };
  for (const p of paras) {
    const sentences = p.length > size ? p.split(/(?<=[.!?])\s+/) : [p];
    for (const s of sentences) {
      if (cur && cur.length + s.length > size) push();
      cur += (cur ? " " : "") + s;
    }
    if (cur.length > size * 0.6) push();
  }
  push();
  return chunks;
}

/** Top few passages for a question: term overlap weighted by how rare each term is across passages. */
export function topChunks(chunks: string[], question: string, k = 4): string[] {
  const q = [...new Set(tokens(question))];
  if (!q.length || !chunks.length) return [];
  const docs = chunks.map(c => new Set(tokens(c)));
  const idf = new Map(q.map(t => [t, Math.log(1 + chunks.length / (1 + docs.filter(d => d.has(t)).length))]));
  return chunks
    .map((c, i) => ({ c, score: q.reduce((n, t) => n + (docs[i].has(t) ? idf.get(t)! : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(x => x.c);
}

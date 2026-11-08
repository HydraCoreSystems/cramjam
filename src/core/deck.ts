import { FullBuild } from "./build";

export const DECK_FORMAT = "cramjam-deck";
export const DECK_VERSION = 1;

export interface DeckPayload {
  title: string;
  summary: string;
  cards: FullBuild["cards"];
  questions: FullBuild["questions"];
  facts: FullBuild["facts"];
  likely: FullBuild["likely"];
}

export interface DeckFile { format: typeof DECK_FORMAT; version: number; exportedAt: number; checksum: string; payload: DeckPayload }

export class DeckError extends Error {}

/** Only the study set travels. The source material and the student's progress stay on the device. */
export const deckPayload = (b: FullBuild): DeckPayload => ({ title: b.title, summary: b.summary, cards: b.cards, questions: b.questions, facts: b.facts, likely: b.likely });

export async function exportDeck(b: FullBuild, now: number, sha256: (s: string) => Promise<string>): Promise<string> {
  const payload = deckPayload(b);
  const file: DeckFile = { format: DECK_FORMAT, version: DECK_VERSION, exportedAt: now, checksum: await sha256(JSON.stringify(payload)), payload };
  return JSON.stringify(file);
}

/** Reads and verifies a deck file. Throws DeckError with a plain message. */
export async function readDeck(text: string, sha256: (s: string) => Promise<string>): Promise<DeckFile> {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new DeckError("That file is not a CramJam deck."); }
  const f = raw as Partial<DeckFile> | null;
  if (!f || f.format !== DECK_FORMAT || !f.payload || typeof f.checksum !== "string") throw new DeckError("That file is not a CramJam deck.");
  if (typeof f.version !== "number" || f.version > DECK_VERSION) throw new DeckError("This deck was made by a newer version of CramJam. Update the app to open it.");
  if ((await sha256(JSON.stringify(f.payload))) !== f.checksum) throw new DeckError("This deck file is damaged or was edited, so it was not opened.");
  return f as DeckFile;
}

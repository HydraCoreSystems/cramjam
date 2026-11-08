import { createHash } from "node:crypto";
import { Api, AskRequest, AskResponse, BuildRequest } from "./api";
import { StringKV } from "./counterStore";
import { AppStore, AuthPort, Deps, JsonKV, NotifierPort } from "./store";
import { DailyNotification, PlannedNotification } from "./notifPlan";

/** In memory stand ins for the phone, so the real state layer runs under vitest. */
export class MemKV implements JsonKV {
  data = new Map<string, string>();
  failWrites = false;
  async get<T>(key: string, fallback?: T): Promise<T> {
    const raw = this.data.get(key);
    if (raw == null) return fallback as T;
    try { return JSON.parse(raw) as T; } catch { return fallback as T; }
  }
  async set(key: string, value: unknown) {
    if (this.failWrites) throw new Error("write failed");
    this.data.set(key, JSON.stringify(value));
  }
  async remove(key: string) { this.data.delete(key); }
}

// StringKV.get must return the raw string, JsonKV.get parses it. Two small adapters keep both honest.
export const rawKV = (m: MemKV): StringKV => ({
  get: async k => m.data.get(k) ?? null,
  set: async (k, v) => { if (m.failWrites) throw new Error("write failed"); m.data.set(k, v); },
});

export const sha256 = async (s: string) => createHash("sha256").update(s).digest("hex");

export const goodBuild = (req: BuildRequest) => ({
  title: `Set for ${req.courseName || "notes"}`,
  summary: "# Summary\n## Cells\n- **Mitochondria** make ATP.\n## Genes\n- DNA codes proteins.",
  cards: [
    { front: "What makes ATP?", back: "Mitochondria", topic: "Cells", source: { label: "Line 1", quote: "Mitochondria make ATP" } },
    { front: "What codes proteins?", back: "DNA", topic: "Genes" },
  ],
  questions: [
    { kind: "multiple_choice", topic: "Cells", prompt: "Which organelle makes ATP?", options: ["Nucleus", "Mitochondria", "Golgi", "Ribosome"], answer: "Mitochondria", reason: "It is the powerhouse.", source: { label: "Line 1", quote: "Mitochondria make ATP" }, difficulty: 1 },
    { kind: "true_false", topic: "Genes", prompt: "DNA codes proteins.", answer: "true", reason: "Genes encode proteins.", source: "Line 2" },
    { kind: "short_answer", topic: "Cells", prompt: "Where is ATP made?", answer: "In the mitochondria", reason: "Respiration.", source: "Line 1" },
    { kind: "fill_in_the_blank", topic: "Genes", prompt: "_____ codes proteins.", answer: "DNA", reason: "Genes.", source: "Line 2" },
    { kind: "matching", topic: "Cells", prompt: "Match", pairs: [{ left: "Nucleus", right: "DNA storage" }, { left: "Mitochondria", right: "ATP" }], answer: "", reason: "Basics.", source: "Line 3" },
  ],
  facts: [{ kind: "formula", label: "Respiration", value: "C6H12O6 + 6O2 -> 6CO2 + 6H2O + ATP" }],
  likely: [{ topic: "Cells", prompt: "Describe how a cell makes ATP.", outline: "Glycolysis, Krebs, ETC." }],
});

export interface Harness {
  store: AppStore;
  deps: Deps;
  app: MemKV;
  chain: MemKV;
  buildCalls: BuildRequest[];
  askCalls: AskRequest[];
  notified: { dated: PlannedNotification[]; daily: DailyNotification[] }[];
  clock: { now: number };
  auth: { user: string | null };
}

export function harness(opts: { signedIn?: boolean; mock?: boolean; api?: Partial<Api>; app?: MemKV; chain?: MemKV; now?: number; clock?: { now: number } } = {}): Harness {
  const app = opts.app ?? new MemKV();
  const chain = opts.chain ?? new MemKV();
  const clock = opts.clock ?? { now: opts.now ?? new Date(2026, 10, 8, 10, 0, 0).getTime() };
  const auth = { user: opts.signedIn === false ? null : "apple-user-1" };
  const buildCalls: BuildRequest[] = [];
  const askCalls: AskRequest[] = [];
  const notified: Harness["notified"] = [];
  let n = 0;
  const api: Api = {
    build: async req => { buildCalls.push(req); return goodBuild(req); },
    syllabus: async () => ({ items: [] }),
    ask: async (req): Promise<AskResponse> => { askCalls.push(req); return { answer: "ok", sourcePointers: [] }; },
    ...opts.api,
  };
  const authPort: AuthPort = {
    supported: () => true,
    current: async () => (auth.user ? { user: auth.user } : null),
    signIn: async () => { auth.user = "apple-user-1"; return { user: auth.user }; },
    signOut: async () => { auth.user = null; },
  };
  const notifier: NotifierPort = { sync: async (dated, daily) => { notified.push({ dated, daily }); return true; } };
  const deps: Deps = { kv: app, keychain: rawKV(chain), appString: rawKV(app), api, sha256, now: () => clock.now, newId: () => `id${++n}`, auth: authPort, notifier, mock: !!opts.mock };
  return { store: new AppStore(deps), deps, app, chain, buildCalls, askCalls, notified, clock, auth };
}

/** Distinct material of enough length, so each call is a new fingerprint. */
export const material = (tag: string) => `${tag}. ` + "Mitochondria make ATP through cellular respiration in the cell. DNA codes proteins that run the cell. ".repeat(4);

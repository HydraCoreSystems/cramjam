import { SourcePointer } from "./study";
import { normalizePointer } from "./build";

export type ApiErrorKind = "unreachable" | "unauthorized" | "limit" | "server" | "bad-response";

export class ApiError extends Error {
  constructor(public kind: ApiErrorKind, message: string, public status?: number) {
    super(message);
  }
}

export interface BuildRequest { fingerprint: string; text: string; courseName: string; examDate: string | null }
export type AskMode = "teachback" | "tutor" | "simpler";
export interface AskRequest { mode: AskMode; question: string; chunks: string[] }
export interface AskResponse { answer: string; sourcePointers: SourcePointer[] }

export interface Api {
  /** POST /v1/build. One call per Study Build. Returns the raw object; normalizeBuild validates it. */
  build(req: BuildRequest): Promise<unknown>;
  /** POST /v1/syllabus. Returns the raw object; mapSyllabusResponse validates it. */
  syllabus(text: string): Promise<unknown>;
  /** POST /v1/ask. */
  ask(req: AskRequest): Promise<AskResponse>;
}

export interface ApiOptions {
  base: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: { build: number; syllabus: number; ask: number };
}

const DEFAULT_TIMEOUT = { build: 120_000, syllabus: 60_000, ask: 60_000 };

export function createApi(opts: ApiOptions): Api {
  const f: typeof fetch = opts.fetchImpl ?? ((...a) => fetch(...a));
  const timeouts = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  async function post(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      const token = await opts.getToken();
      res = await f(`${opts.base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as { name?: string })?.name === "AbortError";
      throw new ApiError("unreachable", aborted ? "The server took too long to answer." : "The server could not be reached.");
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new ApiError("unauthorized", "Sign in again to continue.", res.status);
    if (res.status === 402 || res.status === 429) throw new ApiError("limit", "An allowance has been reached.", res.status);
    if (!res.ok) throw new ApiError("server", `The server had a problem (${res.status}).`, res.status);
    try {
      return await res.json();
    } catch {
      throw new ApiError("bad-response", "The server sent back something CramJam could not read.", res.status);
    }
  }

  return {
    build: req => post("/v1/build", req, timeouts.build),
    syllabus: text => post("/v1/syllabus", { text }, timeouts.syllabus),
    async ask(req) {
      const raw = (await post("/v1/ask", req, timeouts.ask)) as { answer?: unknown; sourcePointers?: unknown } | null;
      const answer = typeof raw?.answer === "string" ? raw.answer.trim() : "";
      if (!answer) throw new ApiError("bad-response", "The answer came back empty.");
      const list = Array.isArray(raw?.sourcePointers) ? raw.sourcePointers : [];
      return { answer, sourcePointers: list.map(normalizePointer).filter((p): p is SourcePointer => !!p) };
    },
  };
}

/** Plain words for the student. Used wherever a call fails; nothing is spent on any failure. */
export function describeApiError(e: unknown, what: "build" | "syllabus" | "ask"): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Nothing was spent. Try again.";
  switch (e.kind) {
    case "unreachable":
      return what === "build"
        ? "CramJam can't reach its server right now, so a new study set can't be made. Nothing was spent. Everything you've already built still works."
        : what === "syllabus"
          ? "CramJam can't reach its server right now, so the syllabus can't be read. You can add the dates by hand instead. No Study Build is used."
          : "CramJam can't reach its server right now, so this can't be answered. Your saved material still works.";
    case "unauthorized":
      return "Your sign in has expired. Sign in with Apple again, then retry. Nothing was spent.";
    case "limit":
      return "You've reached an allowance for now. Nothing was spent.";
    case "bad-response":
      return "The server sent back something CramJam couldn't use. Nothing was spent. Try again in a moment.";
    default:
      return "The server had a problem. Nothing was spent. Try again in a moment.";
  }
}

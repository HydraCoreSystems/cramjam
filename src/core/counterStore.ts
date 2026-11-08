import { Counter, EMPTY_COUNTER, mergeCounters, readCounter } from "./counter";

/** One of the two homes for the counter: the Keychain copy or the app storage copy. */
export interface StringKV {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string): Promise<void>;
}

export const COUNTER_KEY = "cj.counter.v1";

async function readCopy(kv: StringKV): Promise<Counter> {
  try {
    const raw = await kv.get(COUNTER_KEY);
    return raw ? readCounter(JSON.parse(raw)) : EMPTY_COUNTER;
  } catch {
    return EMPTY_COUNTER;
  }
}

/** Writes both copies. One failing never blocks the other. */
export async function saveCounter(keychain: StringKV, app: StringKV, c: Counter): Promise<{ keychain: boolean; app: boolean }> {
  const body = JSON.stringify(c);
  const [k, a] = await Promise.allSettled([keychain.set(COUNTER_KEY, body), app.set(COUNTER_KEY, body)]);
  return { keychain: k.status === "fulfilled", app: a.status === "fulfilled" };
}

/** Read at launch: larger value wins per field, then both copies are healed to the merged value. */
export async function loadCounter(keychain: StringKV, app: StringKV): Promise<Counter> {
  const [a, b] = await Promise.all([readCopy(keychain), readCopy(app)]);
  const merged = mergeCounters(a, b);
  await saveCounter(keychain, app, merged);
  return merged;
}

/** In memory counter that writes through to both copies on every change. */
export class CounterStore {
  value: Counter = EMPTY_COUNTER;
  constructor(private keychain: StringKV, private app: StringKV) {}
  async load(): Promise<Counter> {
    this.value = await loadCounter(this.keychain, this.app);
    return this.value;
  }
  async bump(field: keyof Counter): Promise<Counter> {
    this.value = mergeCounters(this.value, { ...this.value, [field]: this.value[field] + 1 });
    await saveCounter(this.keychain, this.app, this.value);
    return this.value;
  }
}

import storage from "expo-sqlite/kv-store";
export const appStorage = {
  get: async <T>(key: string, fallback: T): Promise<T> => { const raw = await storage.getItem(key); if (!raw) return fallback; try { return JSON.parse(raw) as T } catch { return fallback } },
  set: async (key: string, value: unknown) => storage.setItem(key, JSON.stringify(value)),
  remove: (key: string) => storage.removeItem(key),
  /** Raw string copy, used by the counter so both of its homes hold the same text. */
  getString: (key: string) => storage.getItem(key),
  setString: (key: string, value: string) => storage.setItem(key, value),
};

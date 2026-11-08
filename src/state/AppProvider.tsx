import * as Crypto from "expo-crypto";
import { PropsWithChildren, createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { AppState, AppStore, Deps } from "../core/store";
import { mockGenerationEnabled } from "../core/mockGate";
import { appStorage } from "../lib/storage";
import { appleAuth } from "../services/auth";
import { makeApi } from "../services/apiFactory";
import { activeSubscriptions, iapAvailable, listenForPurchases } from "../services/iap";
import { keychain } from "../services/keychain";
import { notifier } from "../services/notifications";

const sha256 = (s: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);

function realDeps(): Deps {
  return {
    kv: appStorage,
    keychain: { get: k => keychain.get(k), set: (k, v) => keychain.set(k, v) },
    appString: { get: k => appStorage.getString(k), set: (k, v) => appStorage.setString(k, v) },
    api: makeApi(),
    sha256,
    now: () => Date.now(),
    newId: () => Crypto.randomUUID(),
    auth: appleAuth,
    notifier,
    mock: mockGenerationEnabled(),
  };
}

const Ctx = createContext<AppStore | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const store = useMemo(() => new AppStore(realDeps()), []);
  useEffect(() => {
    let off = () => undefined as void;
    (async () => {
      await store.init();
      if (!iapAvailable()) return;
      off = listenForPurchases(p => store.recordPurchase(p), () => undefined);
      // Refresh Pro from the store at launch. If the store is unreachable the saved entitlement
      // keeps working until its own end date.
      try { await store.recordActiveSubscriptions(await activeSubscriptions()); } catch { /* offline */ }
    })();
    return () => { off(); };
  }, [store]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): AppStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside AppProvider");
  return s;
}

export function useApp(): { store: AppStore; state: AppState; now: number } {
  const store = useStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  // The clock is read on every render on purpose: countdown labels and "due now" depend on it.
  // eslint-disable-next-line react-hooks/purity
  return { store, state, now: Date.now() };
}

export const IS_IOS = Platform.OS === "ios";

import { Platform } from "react-native";
import type { Purchase } from "expo-iap";
import { BOOST_TEN, PLAN_ANNUAL, PLAN_MONTHLY, SUBSCRIPTION_SKUS, ActiveSubLike, PurchaseLike, canSell } from "../core/entitlement";

type Iap = typeof import("expo-iap");
let loaded: Iap | null = null;
// Delayed loading keeps development builds honest when the App Store is unavailable.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const iap = (): Iap => (loaded ??= require("expo-iap") as Iap);

export const iapAvailable = () => canSell(Platform.OS);

export interface StoreProduct { sku: string; title: string; price: string; trial: boolean }

let connected = false;
async function connect() {
  if (!iapAvailable()) throw new Error("Store unavailable");
  if (!connected) { await iap().initConnection(); connected = true; }
}

/** Real names and prices from the store. Throws when the store cannot be reached. */
export async function loadCatalog(): Promise<StoreProduct[]> {
  await connect();
  const [subs, boost] = await Promise.all([
    iap().fetchProducts({ skus: [...SUBSCRIPTION_SKUS], type: "subs" }),
    iap().fetchProducts({ skus: [BOOST_TEN], type: "in-app" }),
  ]);
  const all = [...(subs ?? []), ...(boost ?? [])] as { id: string; title: string; displayPrice: string; introductoryPricePaymentModeIOS?: string }[];
  if (!all.length) throw new Error("No products returned");
  return all.map(p => ({ sku: p.id, title: p.title, price: p.displayPrice, trial: p.id === PLAN_ANNUAL && p.introductoryPricePaymentModeIOS === "free-trial" }));
}

export async function buy(sku: string): Promise<void> {
  await connect();
  if (sku === BOOST_TEN) await iap().requestPurchase({ request: { apple: { sku } }, type: "in-app" });
  else if (sku === PLAN_ANNUAL || sku === PLAN_MONTHLY) await iap().requestPurchase({ request: { apple: { sku } }, type: "subs" });
}

/** Active subscriptions straight from the store. Throws when the store cannot be reached. */
export async function activeSubscriptions(): Promise<ActiveSubLike[]> {
  await connect();
  return iap().getActiveSubscriptions([...SUBSCRIPTION_SKUS]);
}

export async function restore(): Promise<ActiveSubLike[]> {
  await connect();
  await iap().restorePurchases();
  return iap().getActiveSubscriptions([...SUBSCRIPTION_SKUS]);
}

/**
 * Listens for purchase results. The handler records the entitlement and resolves; only then is
 * the transaction finished, so a crash in between replays the purchase instead of losing it.
 */
export function listenForPurchases(record: (p: PurchaseLike) => Promise<{ kind: string }>, onError: (message: string, cancelled: boolean) => void): () => void {
  if (!iapAvailable()) return () => undefined;
  const a = iap().purchaseUpdatedListener(async (purchase: Purchase) => {
    try {
      const out = await record(purchase as unknown as PurchaseLike);
      if (out.kind === "ignored" && ((PRODUCT_IS_OURS as readonly string[]).includes(purchase.productId))) return;
      await iap().finishTransaction({ purchase, isConsumable: purchase.productId === BOOST_TEN });
    } catch {
      onError("The purchase could not be recorded. You have not been charged twice; try Restore.", false);
    }
  });
  const b = iap().purchaseErrorListener(err => onError(err.message, err.code === "user-cancelled"));
  return () => { a.remove(); b.remove(); };
}
const PRODUCT_IS_OURS = [PLAN_ANNUAL, PLAN_MONTHLY, BOOST_TEN] as const;

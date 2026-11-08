import { FREE_BUILDS } from "./counter";

export const PLAN_MONTHLY = "com.gatheringmoss.cramjam.monthly";
export const PLAN_ANNUAL = "com.gatheringmoss.cramjam.annual";
export const BOOST_TEN = "com.gatheringmoss.cramjam.boost10";
export const SUBSCRIPTION_SKUS = [PLAN_ANNUAL, PLAN_MONTHLY] as const;
export const PRODUCT_SKUS = [...SUBSCRIPTION_SKUS, BOOST_TEN] as const;
/** Study Builds one Finals Boost pack adds. */
export const BOOST_BUILDS = 10;
/** Local mirror of the server's monthly Pro bound. The server stays the authority. */
export const PRO_MONTHLY_BUILDS = 50;

/** `credited` holds boost transaction ids already counted, so a redelivered purchase never double credits. */
export interface Entitlement { until: number | null; boosts: number; credited?: string[] }
export const NO_ENTITLEMENT: Entitlement = { until: null, boosts: 0 };
export const isPro = (e: Entitlement, now = Date.now()) => typeof e.until === "number" && e.until > now;
export const canSell = (platform: string) => platform === "ios";

/**
 * Builds still available. Free: the lifetime free allowance minus builds used.
 * Pro: the monthly allowance minus builds used this month. Boosts stack on top of either.
 */
export function monthlyBuildsLeft(used: number, e: Entitlement, now = Date.now()): number {
  const base = isPro(e, now) ? Math.max(0, PRO_MONTHLY_BUILDS - used) : Math.max(0, FREE_BUILDS - used);
  return base + Math.max(0, e.boosts);
}

/** The slice of a store purchase the app needs. expo-iap purchases satisfy this shape. */
export interface PurchaseLike {
  productId: string;
  id?: string | null;
  transactionId?: string | null;
  expirationDateIOS?: number | null;
  quantity?: number | null;
}

export interface PurchaseOutcome {
  entitlement: Entitlement;
  kind: "subscription" | "boost" | "ignored";
  /** True when the purchase changed the entitlement. False for redelivered or unknown purchases. */
  changed: boolean;
}

const CREDITED_KEEP = 200;

/** Turns one purchase or restore result into the Entitlement value. */
export function applyPurchase(e: Entitlement, p: PurchaseLike, now = Date.now()): PurchaseOutcome {
  if ((SUBSCRIPTION_SKUS as readonly string[]).includes(p.productId)) {
    const exp = p.expirationDateIOS;
    if (typeof exp !== "number" || exp <= now) return { entitlement: e, kind: "ignored", changed: false };
    const until = Math.max(e.until ?? 0, exp);
    return { entitlement: { ...e, until }, kind: "subscription", changed: until !== e.until };
  }
  if (p.productId === BOOST_TEN) {
    const key = p.transactionId ?? p.id ?? null;
    if (!key) return { entitlement: e, kind: "ignored", changed: false };
    const seen = e.credited ?? [];
    if (seen.includes(key)) return { entitlement: e, kind: "boost", changed: false };
    const qty = Math.min(10, Math.max(1, Math.floor(p.quantity ?? 1)));
    return {
      entitlement: { ...e, boosts: Math.max(0, e.boosts) + BOOST_BUILDS * qty, credited: [...seen, key].slice(-CREDITED_KEEP) },
      kind: "boost",
      changed: true,
    };
  }
  return { entitlement: e, kind: "ignored", changed: false };
}

export interface ActiveSubLike { productId: string; isActive?: boolean; expirationDateIOS?: number | null }

/**
 * Applies a successful store query for active subscriptions. Authoritative: when the store answered
 * and shows none active, Pro ends. Boosts never expire and are left alone.
 */
export function applyActiveSubscriptions(e: Entitlement, subs: ActiveSubLike[], now = Date.now()): Entitlement {
  let until: number | null = null;
  for (const s of subs) {
    if (!(SUBSCRIPTION_SKUS as readonly string[]).includes(s.productId)) continue;
    if (s.isActive === false) continue;
    const exp = s.expirationDateIOS;
    if (typeof exp === "number" && exp > now) until = Math.max(until ?? 0, exp);
  }
  return { ...e, until };
}

export const spendBoost = (e: Entitlement): Entitlement => ({ ...e, boosts: Math.max(0, e.boosts - 1) });

export type PlanKind = "annual" | "monthly" | "boost";
export const kindOfSku = (sku: string): PlanKind | null =>
  sku === PLAN_ANNUAL ? "annual" : sku === PLAN_MONTHLY ? "monthly" : sku === BOOST_TEN ? "boost" : null;

import { router } from "expo-router";
import type { PaywallReason } from "../core/store";

export const openPaywall = (reason: PaywallReason) => router.push({ pathname: "/paywall", params: { reason } });

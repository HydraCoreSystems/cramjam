import { Platform } from "react-native";
import * as Apple from "expo-apple-authentication";
import { AuthPort } from "../core/store";
import { tokenStale } from "../core/jwt";
import { keychain } from "./keychain";

const TOKEN_KEY = "cj.apple.token";
const USER_KEY = "cj.apple.user";

const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn(); } catch { return fallback; } };

export const appleSupported = () => Platform.OS === "ios";

async function clear() {
  await safe(() => keychain.remove(TOKEN_KEY), undefined);
  await safe(() => keychain.remove(USER_KEY), undefined);
}

/**
 * The only account. Sign in with Apple, no passwords, no email. The identity token goes to the
 * server as a Bearer header. Apple identity tokens are short lived, so each read refreshes a
 * stale one silently when it can.
 */
export const appleAuth: AuthPort & { getToken(): Promise<string | null> } = {
  supported: appleSupported,

  async current() {
    if (!appleSupported()) return null;
    const user = await safe(() => keychain.get(USER_KEY), null);
    if (!user) return null;
    try {
      const state = await Apple.getCredentialStateAsync(user);
      if (state === Apple.AppleAuthenticationCredentialState.REVOKED || state === Apple.AppleAuthenticationCredentialState.NOT_FOUND) {
        await clear();
        return null;
      }
    } catch {
      // Offline or unavailable: trust the stored sign in.
    }
    return { user };
  },

  async signIn() {
    if (!appleSupported()) return null;
    try {
      const cred = await Apple.signInAsync({ requestedScopes: [] });
      if (!cred.identityToken) return null;
      await keychain.set(USER_KEY, cred.user);
      await keychain.set(TOKEN_KEY, cred.identityToken);
      return { user: cred.user };
    } catch {
      return null; // cancelled or failed
    }
  },

  async signOut() { await clear(); },

  async getToken() {
    const token = await safe(() => keychain.get(TOKEN_KEY), null);
    if (!token) return null;
    if (!tokenStale(token, Date.now())) return token;
    const user = await safe(() => keychain.get(USER_KEY), null);
    if (!user) return token;
    try {
      const fresh = await Apple.refreshAsync({ user });
      if (fresh.identityToken) {
        await keychain.set(TOKEN_KEY, fresh.identityToken);
        return fresh.identityToken;
      }
    } catch {
      // Keep the stored token. The server will say if it is no longer good.
    }
    return token;
  },
};

import { Api, createApi } from "../core/api";
import { SERVER_BASE } from "../core/links";
import { appleAuth } from "./auth";

/**
 * The real client, or the development mock when (and only when) this is a development build with
 * EXPO_PUBLIC_MOCK_GENERATION=1. The condition is written inline so the bundler folds it to false
 * in a production build and drops the mock module from the bundle entirely.
 */
export function makeApi(): Api {
  if (__DEV__ && process.env.EXPO_PUBLIC_MOCK_GENERATION === "1") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("../dev/mockServer") as typeof import("../dev/mockServer")).createMockApi();
  }
  return createApi({ base: SERVER_BASE, getToken: () => appleAuth.getToken() });
}

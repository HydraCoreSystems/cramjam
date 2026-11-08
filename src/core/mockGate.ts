/** A mock of the three endpoints is allowed only in a development build with the flag set. */
export const mockAllowed = (isDev: boolean, flag: string | undefined): boolean => isDev === true && flag === "1";

export const mockGenerationEnabled = (): boolean =>
  mockAllowed(typeof __DEV__ !== "undefined" && __DEV__ === true, process.env.EXPO_PUBLIC_MOCK_GENERATION);

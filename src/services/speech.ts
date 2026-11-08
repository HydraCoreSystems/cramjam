import * as Speech from "expo-speech";

/** Reads text aloud with the on device voice. Free, offline, no server. */
export function speak(text: string, onDone: () => void, rate = 1) {
  Speech.stop();
  // The speech engine drops very long strings, so read in paragraph sized pieces.
  const parts = text.split(/\n{1,}/).map(p => p.trim()).filter(Boolean);
  let i = 0;
  const next = () => {
    if (i >= parts.length) return onDone();
    Speech.speak(parts[i++], { rate, onDone: next, onStopped: onDone, onError: onDone });
  };
  next();
}
export const stopSpeaking = () => { void Speech.stop(); };

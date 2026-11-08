import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { captureRef } from "react-native-view-shot";

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "deck";

/** Writes a deck file to the cache and opens the share sheet. */
export async function shareDeckFile(title: string, json: string): Promise<boolean> {
  const file = new File(Paths.cache, `${safeName(title)}.cramjam`);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Share this deck", UTI: "public.json" });
  return true;
}

/** Prints or saves the facts sheet as a PDF through the system print dialog. */
export async function printHtml(html: string): Promise<void> {
  await Print.printAsync({ html });
}

/** Captures a view as a PNG and shares it. */
export async function shareView(ref: Parameters<typeof captureRef>[0]): Promise<boolean> {
  const uri = await captureRef(ref, { format: "png", quality: 1 });
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share your result" });
  return true;
}

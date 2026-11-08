import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { extractTextFromImage, isSupported as ocrSupported } from "expo-text-extractor";

export type IntakeResult = { ok: true; text: string; label: string } | { ok: false; message: string; cancelled?: boolean };

const stripHtml = (s: string) =>
  s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();

async function ocr(uris: string[]): Promise<IntakeResult> {
  if (!ocrSupported) return { ok: false, message: "Reading text from photos is not available on this device." };
  const pages: string[] = [];
  for (const uri of uris) {
    try {
      const lines = await extractTextFromImage(uri);
      if (lines.length) pages.push(lines.join("\n"));
    } catch {
      // A bad page is skipped; the others still count.
    }
  }
  const text = pages.join("\n\n").trim();
  if (!text) return { ok: false, message: "No readable text was found in the photo. Try better light, hold the camera steady, and fill the frame with the page." };
  return { ok: true, text, label: `${uris.length} photo${uris.length > 1 ? "s" : ""} read on this device` };
}

/** Photos of notes, a whiteboard, or a printed syllabus. Text is read on the device; only text leaves it. */
export async function fromPhoto(source: "camera" | "library"): Promise<IntakeResult> {
  const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, message: source === "camera" ? "Camera access is off. You can turn it on in Settings, or choose a photo from your library." : "Photo access is off. You can turn it on in Settings." };
  const res = source === "camera"
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 1 });
  if (res.canceled) return { ok: false, message: "", cancelled: true };
  return ocr(res.assets.map(a => a.uri));
}

/**
 * Picks a file and reads its text on the device. Plain text, Markdown, HTML and CSV are read
 * directly and photos or screenshots go through on device text recognition. PDF, Word and slide
 * files need a native reader this build does not include, so the student is told plainly.
 */
export async function fromFile(): Promise<IntakeResult> {
  const res = await DocumentPicker.getDocumentAsync({ type: ["text/*", "application/pdf", "image/*", "application/*"], copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return { ok: false, message: "", cancelled: true };
  const a = res.assets[0];
  const name = a.name ?? "file";
  const mime = a.mimeType ?? "";
  const lower = name.toLowerCase();
  if (mime.startsWith("image/")) return ocr([a.uri]);
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    return { ok: false, message: `${name} is a PDF. CramJam can't read text out of PDFs on the device yet. Take a photo or screenshot of the pages, or open the PDF, copy the text, and paste it here.` };
  }
  if (/\.(docx?|pptx?|key|pages|rtf)$/.test(lower)) {
    return { ok: false, message: `${name} needs a reader CramJam doesn't have yet. Export it as a PDF or text file, take a photo of the pages, or paste the text here.` };
  }
  try {
    const raw = await new File(a.uri).text();
    const text = /\.html?$/.test(lower) || mime === "text/html" ? stripHtml(raw) : raw.trim();
    if (!text) return { ok: false, message: `${name} has no text in it.` };
    return { ok: true, text, label: name };
  } catch {
    return { ok: false, message: `${name} could not be read as text.` };
  }
}

/** A deck file picked from Files, read as text. */
export async function pickDeckText(): Promise<{ ok: true; text: string } | { ok: false; cancelled: boolean }> {
  const res = await DocumentPicker.getDocumentAsync({ type: ["application/json", "text/*", "application/octet-stream", "*/*"], copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return { ok: false, cancelled: true };
  try { return { ok: true, text: await new File(res.assets[0].uri).text() }; } catch { return { ok: false, cancelled: false }; }
}

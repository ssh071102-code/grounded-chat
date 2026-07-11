import type { Chunk } from "./types";

/**
 * Sentence-aware chunking.
 *
 * Strategy (documented in README):
 * 1. Split the document into paragraphs, then paragraphs into sentences using
 *    a punctuation-based splitter with an abbreviation guard (so "Mr. Darwin"
 *    or "e.g. finches" do not produce false sentence breaks).
 * 2. Greedily pack whole sentences into chunks of ~`targetChars` characters.
 *    A sentence is never split in half; a single sentence longer than the
 *    target becomes its own oversized chunk.
 * 3. Adjacent chunks overlap by the last `overlapSentences` sentences of the
 *    previous chunk, so facts that straddle a boundary remain retrievable.
 */
export interface ChunkOptions {
  targetChars: number;
  overlapSentences: number;
}

export const DEFAULT_CHUNKING: ChunkOptions = {
  targetChars: 1100,
  overlapSentences: 2,
};

/** Lowercased tokens after which a period is not a sentence boundary. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "rev", "hon", "st", "sr", "jr",
  "vs", "etc", "no", "vol", "ch", "chap", "sec", "fig", "pp", "ed",
  "e.g", "i.e", "cf", "al", "approx",
]);

const BOUNDARY = /[.!?]+["')\]]*\s+/g;

/** Split plain text into sentences. Whitespace is normalized to single spaces. */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences: string[] = [];
  let start = 0;
  BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BOUNDARY.exec(normalized)) !== null) {
    const before = normalized.slice(start, match.index);
    const lastWord = before.split(" ").pop() ?? "";
    const bare = lastWord.toLowerCase().replace(/[^a-z.]/g, "").replace(/\.+$/, "");
    // Do not split after known abbreviations or single-letter initials.
    if (ABBREVIATIONS.has(bare) || /^[a-z]$/.test(bare)) continue;

    const sentence = normalized.slice(start, match.index + match[0].length).trim();
    if (sentence) sentences.push(sentence);
    start = match.index + match[0].length;
  }

  const tail = normalized.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

export function chunkDocument(
  docId: string,
  title: string,
  text: string,
  options: ChunkOptions = DEFAULT_CHUNKING,
): Chunk[] {
  const { targetChars, overlapSentences } = options;
  const paragraphs = text.split(/\r?\n\s*\r?\n+/);
  const sentences = paragraphs.flatMap((p) => splitSentences(p));

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let freshSentences = 0; // sentences added since the last flush (excludes overlap)

  const flush = () => {
    if (freshSentences === 0) return;
    const body = current.join(" ").trim();
    if (!body) return;
    chunks.push({
      id: `${docId}#${chunks.length}`,
      docId,
      title,
      index: chunks.length,
      text: body,
    });
    const overlap = overlapSentences > 0 ? current.slice(-overlapSentences) : [];
    current = [...overlap];
    currentLen = overlap.reduce((sum, s) => sum + s.length + 1, 0);
    freshSentences = 0;
  };

  for (const sentence of sentences) {
    if (currentLen > 0 && currentLen + sentence.length + 1 > targetChars) {
      flush();
    }
    current.push(sentence);
    currentLen += sentence.length + 1;
    freshSentences += 1;
  }
  flush();

  return chunks;
}

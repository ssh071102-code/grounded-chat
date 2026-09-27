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
 * 4. Each chunk is titled with the nearest heading above it (see headingOf),
 *    falling back to the document title before the first heading.
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

/** Longest paragraph, in characters, that can still count as a heading. */
const MAX_HEADING_CHARS = 120;

/** "III.", "CHAPTER I.", "Part 2": a label that the next paragraph completes. */
const NUMBER_ONLY = /^(?:(?:chapter|part|book|section)\s+)?[ivxlcdm\d]+\.?$/i;

/**
 * If a paragraph is a heading, return its text; otherwise null.
 *
 * Two shapes are recognised: a Markdown heading line (`## Rules of usage`),
 * and the plain-text convention of the bundled Gutenberg texts, a short
 * paragraph of at most two lines with no lowercase letters
 * (`II. ELEMENTARY RULES OF USAGE`). Requiring three capital letters keeps
 * formulas and footnote markers such as `[3]` out.
 */
export function headingOf(paragraph: string): string | null {
  const lines = paragraph
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const markdown = lines
    .map((l) => /^#{1,6}\s+(.+?)\s*#*$/.exec(l)?.[1])
    .filter((h): h is string => Boolean(h));
  if (markdown.length > 0) return markdown.at(-1)!.replace(/\.$/, "");

  if (lines.length > 2) return null;
  const joined = lines.join(" ");
  if (joined.length > MAX_HEADING_CHARS) return null;
  if (/\p{Ll}/u.test(joined)) return null;
  if ((joined.match(/\p{Lu}/gu) ?? []).length < 3 && !NUMBER_ONLY.test(joined)) {
    return null;
  }
  return joined.replace(/\.$/, "");
}

/**
 * Split a document into chunks. `title` is the fallback title; each chunk is
 * titled with the nearest heading above its first new (non-overlap) sentence,
 * so a chunk from chapter three is labelled with chapter three.
 */
export function chunkDocument(
  docId: string,
  title: string,
  text: string,
  options: ChunkOptions = DEFAULT_CHUNKING,
): Chunk[] {
  const { targetChars, overlapSentences } = options;
  const paragraphs = text.split(/\r?\n\s*\r?\n+/);

  const sentences: { text: string; heading: string }[] = [];
  let heading = title;
  let pendingLabel: string | null = null;
  for (const paragraph of paragraphs) {
    const found = headingOf(paragraph);
    if (found !== null) {
      if (pendingLabel !== null && !NUMBER_ONLY.test(found)) {
        heading = `${pendingLabel}. ${found}`;
        pendingLabel = null;
      } else if (NUMBER_ONLY.test(found)) {
        heading = found;
        pendingLabel = found;
      } else {
        heading = found;
      }
    } else if (paragraph.trim()) {
      pendingLabel = null;
    }
    for (const s of splitSentences(paragraph)) sentences.push({ text: s, heading });
  }

  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let freshSentences = 0; // sentences added since the last flush (excludes overlap)
  let chunkTitle = title; // heading at the first fresh sentence of the chunk

  const flush = () => {
    if (freshSentences === 0) return;
    const body = current.join(" ").trim();
    if (!body) return;
    chunks.push({
      id: `${docId}#${chunks.length}`,
      docId,
      title: chunkTitle,
      index: chunks.length,
      text: body,
    });
    const overlap = overlapSentences > 0 ? current.slice(-overlapSentences) : [];
    current = [...overlap];
    currentLen = overlap.reduce((sum, s) => sum + s.length + 1, 0);
    freshSentences = 0;
  };

  for (const sentence of sentences) {
    if (currentLen > 0 && currentLen + sentence.text.length + 1 > targetChars) {
      flush();
    }
    if (freshSentences === 0) chunkTitle = sentence.heading;
    current.push(sentence.text);
    currentLen += sentence.text.length + 1;
    freshSentences += 1;
  }
  flush();

  return chunks;
}

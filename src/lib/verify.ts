import { splitSentences } from "./chunk";
import type { Embedder } from "./embed/types";
import type { Chunk } from "./types";

/**
 * Groundedness verifier.
 *
 * After an answer is generated, each sentence is scored for attribution
 * against the retrieved chunks: the sentence is embedded with the same local
 * model used for retrieval and compared against candidate spans drawn from
 * the chunks — every chunk sentence, every pair of adjacent sentences, and
 * the whole chunk as a fallback. The score is the maximum cosine similarity
 * across those spans. Sentence-level spans keep short factual claims from
 * being diluted by unrelated text elsewhere in a large chunk; the
 * two-sentence window catches claims that combine adjacent source facts.
 * Sentences below the threshold are flagged "unsupported" in the UI.
 *
 * This is a deterministic, offline heuristic - not a proof of entailment.
 * Known failure modes (documented in README):
 * - Negation blindness: "X causes Y" and "X does not cause Y" embed closely,
 *   so a contradicted claim can still score as supported.
 * - Aggressive paraphrase or multi-hop synthesis can score below threshold
 *   even when genuinely grounded (false positive flags).
 * - Very short sentences carry little signal and are marked "skipped"
 *   rather than judged.
 *
 * The threshold is calibrated against the bundled corpus (see
 * scripts/eval.ts --calibrate and the README design note).
 */

export const VERIFY_THRESHOLD = 0.55;
const MIN_SENTENCE_CHARS = 20;

/** Markers like [1] or [2][3] that the answer uses for citations. */
const CITATION_MARKER = /\s*\[\d+\]/g;

export type VerdictStatus =
  | "supported"
  | "unsupported"
  | "unverifiable"
  | "skipped";

export interface SentenceVerdict {
  /** Sentence as it appears in the answer (citation markers included). */
  sentence: string;
  /** Max cosine similarity across retrieved chunks (0 for skipped). */
  score: number;
  bestChunkId: string | null;
  status: VerdictStatus;
  /** Specifics checked literally against the passages, when any were found. */
  specifics?: { token: string; grounded: boolean }[];
}

export interface VerificationReport {
  threshold: number;
  embedder: string;
  verdicts: SentenceVerdict[];
}

/**
 * Numbers a sentence spells out. Measured on the bundled corpus, six of nine
 * fabrications survived the threshold and the ones that slipped carried their
 * invented quantity as a word, because only digit runs counted as a specific.
 * The digit form is kept alongside so a page writing "8am" still grounds an
 * answer that says "eight".
 */
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
  seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
  thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70",
  eighty: "80", ninety: "90", hundred: "100", thousand: "1000",
};

/**
 * Specifics: the parts of a sentence that can be checked literally rather than
 * by similarity. Numbers, times and phone digits carry the claims a customer
 * acts on, and proper nouns carry suburbs and names. Sentence-initial words are
 * excluded because their capitalization means nothing.
 */
function specificTokens(sentence: string): string[] {
  const words = sentence.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [];
  const out: string[] = [];
  words.forEach((word, i) => {
    const lower = word.toLowerCase();
    if (/\d/.test(word)) {
      out.push(lower);
      return;
    }
    if (lower in NUMBER_WORDS) {
      // "one of our core services" is a partitive, not a count, and
      // grounding a sentence on it says nothing about the claim while
      // skipping the similarity check that would have decided. Measured
      // in production: a sentence scoring 0.49 passed on the word "one".
      const next = (words[i + 1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
      if (next !== "of") out.push(lower);
      return;
    }
    if (i > 0 && /^[A-Z][a-z]{2,}$/.test(word)) out.push(lower);
  });
  return [...new Set(out)];
}

/**
 * A specific counts as grounded when it appears in the passages, allowing an
 * abbreviation to stand for the word it abbreviates: the pages write
 * "Sat 8am - 12pm" and the answer says "Saturday 8am to 12pm". Requiring three
 * characters keeps the relation from matching on a stray letter.
 */
function isGrounded(token: string, corpusTokens: Set<string>): boolean {
  if (corpusTokens.has(token)) return true;
  // A quantity counts as present in either notation.
  const asDigits = NUMBER_WORDS[token];
  if (asDigits) {
    if (corpusTokens.has(asDigits)) return true;
    // "eight" against a page that writes "8am": the digits must start the
    // corpus token and not run into another digit, so 8 never matches 80.
    const attached = new RegExp("^" + asDigits + "(?![0-9])");
    for (const candidate of corpusTokens) {
      if (attached.test(candidate)) return true;
    }
  }
  if (/^\d+$/.test(token)) {
    for (const [word, digits] of Object.entries(NUMBER_WORDS)) {
      if (digits === token && corpusTokens.has(word)) return true;
    }
  }
  // "7am-5pm" against pages that write "7am - 5pm": a joined range holds up
  // when every part of it does.
  if (token.includes("-")) {
    const parts = token.split("-").filter(Boolean);
    if (parts.length > 1 && parts.every((part) => isGrounded(part, corpusTokens))) {
      return true;
    }
  }
  if (/\d/.test(token) || token.length < 3) return false;
  for (const candidate of corpusTokens) {
    if (candidate.length < 3) continue;
    if (token.startsWith(candidate) || candidate.startsWith(token)) return true;
  }
  return false;
}

/**
 * Sentences that decline, defer, or frame rather than assert something about
 * the world. A body of text can never evidence an absence, so scoring these as
 * unsupported penalizes exactly the behaviour this product sells: a bot that
 * says it does not know. Kept deliberately narrow, and only ever consulted for
 * sentences that contain no specifics at all, so an invented claim cannot hide
 * here.
 */
const NON_ASSERTION = [
  /\boutside (?:of )?what we (?:take on|cover|do|handle|offer)\b/i,
  /\b(?:that|this|it)(?:'s| is| are)? not something\b/i,
  /\bwe (?:do not|don't) (?:do|handle|offer|take) (?:that|those|it)\b/i,
  /\b(?:that|it) depends\b/i,
  /\b(?:do not|don't|does not|doesn't) (?:list|have|publish|show|state|specify|mention|cover)\b/i,
  /\b(?:would|will|'d) need to (?:look|see|inspect|assess|visit)\b/i,
  /\bhappy to\b|\bget(?:ting)? started\b|\bhere is what\b|\bthe best thing to do\b/i,
  /^(?:yes|no)\b[^.]{0,60}\.?$/i,
];

/**
 * Ways of asking the reader to make contact. Every answer closes with one and
 * none of them appears in the pages word for word, so across five test
 * corpora of business web pages they were about four flags in ten. A reader who sees orange on the
 * closing line of every answer learns that orange means nothing.
 */
const INVITATION: RegExp[] = [
  /\bget in touch\b/i,
  /\bgive (?:us|me|him|her|them|\w+) a (?:call|ring|buzz|bell)\b/i,
  /\b(?:fill|filling) (?:in|out)(?: an?| the)? (?:enquiry|inquiry|quote|contact|online)?\s?(?:form|enquiry|request)\b/i,
  /\bdrop us a (?:line|message|note)\b/i,
  /\breach out\b/i,
];

/**
 * Nothing here can be checked against a body of text.
 *
 * The carve-out is narrow on purpose. It applies only where the sentence
 * carries no checkable specific, which is decided before this is consulted, so
 * an invitation that names a phone number is still matched against the pages
 * digit by digit, and a claim wearing an invitation as a coat still has to
 * clear the similarity threshold on its own.
 */
function isNonAssertion(sentence: string): boolean {
  if (NON_ASSERTION.some((p) => p.test(sentence))) return true;
  if (!INVITATION.some((p) => p.test(sentence))) return false;
  // An invitation that also promises something is not just an invitation.
  return !/\b(?:within|anywhere|guarantee|always|every|all of|(?<!feel )free|same day|24 hours)\b/i.test(
    sentence,
  );
}

interface CandidateSpan {
  chunkId: string;
  text: string;
}

/** Sentences, adjacent-sentence pairs, and the whole chunk, per chunk. */
function candidateSpans(chunks: Chunk[]): CandidateSpan[] {
  const spans: CandidateSpan[] = [];
  for (const chunk of chunks) {
    const ss = splitSentences(chunk.text);
    for (let i = 0; i < ss.length; i++) {
      spans.push({ chunkId: chunk.id, text: ss[i]! });
      if (i + 1 < ss.length) {
        spans.push({ chunkId: chunk.id, text: `${ss[i]!} ${ss[i + 1]!}` });
      }
    }
    spans.push({ chunkId: chunk.id, text: chunk.text });
  }
  return spans;
}

export async function verifyAnswer(
  answer: string,
  chunks: Chunk[],
  embedder: Embedder,
  threshold: number = VERIFY_THRESHOLD,
): Promise<VerificationReport> {
  const sentences = splitSentences(answer);
  const report: VerificationReport = {
    threshold,
    embedder: embedder.id,
    verdicts: [],
  };
  if (sentences.length === 0 || chunks.length === 0) {
    report.verdicts = sentences.map((sentence) => ({
      sentence,
      score: 0,
      bestChunkId: null,
      status: "skipped" as const,
    }));
    return report;
  }

  // Strip citation markers before embedding; keep originals for display.
  const cleaned = sentences.map((s) => s.replace(CITATION_MARKER, "").trim());
  const judgeable = cleaned.map(
    (s) => s.length >= MIN_SENTENCE_CHARS && /[a-zA-Z]/.test(s),
  );

  const toEmbed = cleaned.filter((_, i) => judgeable[i]);
  const spans = candidateSpans(chunks);
  // Both the joined and split forms of hyphenated text, so a page that writes
  // "Mon-Fri" still grounds an answer that says "Monday to Friday".
  const corpusTokens = new Set(
    chunks.flatMap((chunk) =>
      (chunk.text.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? []).flatMap((word) => {
        const lower = word.toLowerCase();
        return lower.includes("-") ? [lower, ...lower.split("-")] : [lower];
      }),
    ),
  );
  const vectors = await embedder.embed([...toEmbed, ...spans.map((s) => s.text)]);
  const sentenceVectors = vectors.slice(0, toEmbed.length);
  const spanVectors = vectors.slice(toEmbed.length);

  let cursor = 0;
  report.verdicts = sentences.map((sentence, i) => {
    if (!judgeable[i]) {
      return { sentence, score: 0, bestChunkId: null, status: "skipped" as const };
    }
    const vec = sentenceVectors[cursor++]!;
    let best = -1;
    let bestChunkId: string | null = null;
    spanVectors.forEach((spanVec, c) => {
      let dot = 0;
      for (let d = 0; d < vec.length; d++) dot += vec[d]! * spanVec[d]!;
      if (dot > best) {
        best = dot;
        bestChunkId = spans[c]!.chunkId;
      }
    });
    const score = Number(best.toFixed(4));

    // Specifics are checked whatever similarity said. High similarity only
    // establishes that the sentence is about the same subject as the passages,
    // and an invented price sits inside a sentence that is otherwise a perfect
    // topical match: "Repointing costs $85 per square metre" scored 0.684
    // against pages that discuss repointing and pricing and publish no rate at
    // all. The number is the part a customer acts on, so it has to be present
    // literally, not approximately.
    const tokens = specificTokens(cleaned[i]!);
    if (tokens.length > 0) {
      const specifics = tokens.map((token) => ({
        token,
        grounded: isGrounded(token, corpusTokens),
      }));
      return {
        sentence,
        score,
        bestChunkId,
        status: specifics.every((s) => s.grounded)
          ? ("supported" as const)
          : ("unsupported" as const),
        specifics,
      };
    }

    // Nothing literal to check, so similarity decides.
    if (best >= threshold) {
      return { sentence, score, bestChunkId, status: "supported" as const };
    }

    // Below threshold with no specifics. Only a declining or framing sentence
    // earns a pass; anything else asserting something unfound stays flagged.
    return {
      sentence,
      score,
      bestChunkId,
      status: isNonAssertion(cleaned[i]!)
        ? ("unverifiable" as const)
        : ("unsupported" as const),
    };
  });

  return report;
}

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

export type VerdictStatus = "supported" | "unsupported" | "skipped";

export interface SentenceVerdict {
  /** Sentence as it appears in the answer (citation markers included). */
  sentence: string;
  /** Max cosine similarity across retrieved chunks (0 for skipped). */
  score: number;
  bestChunkId: string | null;
  status: VerdictStatus;
}

export interface VerificationReport {
  threshold: number;
  embedder: string;
  verdicts: SentenceVerdict[];
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
    return {
      sentence,
      score: Number(best.toFixed(4)),
      bestChunkId,
      status: best >= threshold ? ("supported" as const) : ("unsupported" as const),
    };
  });

  return report;
}

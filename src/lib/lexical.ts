import type { Chunk, ScoredChunk } from "./types";

/** Okapi BM25 term-frequency saturation. */
const K1 = 1.2;
/** Okapi BM25 length normalization. */
const B = 0.75;

export interface LexicalIndex {
  chunks: Chunk[];
  /** term -> chunk row -> term frequency */
  postings: Map<string, Map<number, number>>;
  lengths: number[];
  avgLength: number;
}

/**
 * Lowercase runs of letters or digits. Digit runs are kept deliberately:
 * on a small-business corpus the highest-value queries are phone numbers,
 * ABNs and prices, and those are exactly what dense embeddings blur away.
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function buildLexicalIndex(chunks: Chunk[]): LexicalIndex {
  const postings = new Map<string, Map<number, number>>();
  const lengths: number[] = [];

  chunks.forEach((chunk, row) => {
    const terms = tokenize(chunk.text);
    lengths.push(terms.length);
    for (const term of terms) {
      let byRow = postings.get(term);
      if (!byRow) {
        byRow = new Map();
        postings.set(term, byRow);
      }
      byRow.set(row, (byRow.get(row) ?? 0) + 1);
    }
  });

  const total = lengths.reduce((sum, n) => sum + n, 0);
  return {
    chunks,
    postings,
    lengths,
    avgLength: lengths.length > 0 ? total / lengths.length : 0,
  };
}

/**
 * BM25 with the standard smoothed IDF. A term occurring in every chunk gets
 * an IDF near zero, which is the property that stops shared boilerplate from
 * dominating: the discriminating term in the query decides the ranking.
 */
export function lexicalSearch(
  index: LexicalIndex,
  query: string,
  k: number,
): ScoredChunk[] {
  if (k <= 0 || index.chunks.length === 0) return [];
  const n = index.chunks.length;
  const scores = new Map<number, number>();

  for (const term of tokenize(query)) {
    const byRow = index.postings.get(term);
    if (!byRow) continue;
    const df = byRow.size;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    for (const [row, tf] of byRow) {
      const norm = 1 - B + (B * index.lengths[row]!) / (index.avgLength || 1);
      const contribution = (idf * (tf * (K1 + 1))) / (tf + K1 * norm);
      scores.set(row, (scores.get(row) ?? 0) + contribution);
    }
  }

  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map(([row, score]) => ({ ...index.chunks[row]!, score }));
}

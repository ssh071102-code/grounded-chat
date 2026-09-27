/**
 * Reciprocal Rank Fusion constant. 60 is the value from Cormack et al. (2009)
 * and the one every mainstream hybrid-search implementation ships with; it is
 * large enough that the top few ranks are not winner-take-all.
 */
const DEFAULT_RRF_K = 60;

export interface FusedItem {
  id: string;
  score: number;
}

/**
 * Fuse several ranked id lists into one. Fusion is on rank alone, never on
 * score: cosine similarity and BM25 live on incomparable scales, and any
 * attempt to weight them directly needs per-corpus calibration that a
 * deployment on an unlabelled corpus has no way to perform.
 */
export function rrfFuse(
  rankings: string[][],
  rrfK: number = DEFAULT_RRF_K,
): FusedItem[] {
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;

  for (const ranking of rankings) {
    ranking.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (rrfK + i + 1));
      if (!firstSeen.has(id)) firstSeen.set(id, order++);
    });
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || firstSeen.get(a.id)! - firstSeen.get(b.id)!);
}

/**
 * Limit how many chunks any one document may contribute, then backfill from
 * the demoted ones so the caller still gets k results.
 *
 * Why this exists: trade and service sites repeat the same paragraph across
 * every suburb landing page. Without a cap, one boilerplate paragraph fills
 * the whole window and the single page that actually answers the question is
 * pushed out. This was measured on a crawled service-business corpus.
 */
export function capPerDoc<T extends { docId: string }>(
  items: T[],
  maxPerDoc: number,
  k: number,
): T[] {
  const kept: T[] = [];
  const demoted: T[] = [];
  const perDoc = new Map<string, number>();

  for (const item of items) {
    const seen = perDoc.get(item.docId) ?? 0;
    if (seen < maxPerDoc) {
      perDoc.set(item.docId, seen + 1);
      kept.push(item);
    } else {
      demoted.push(item);
    }
  }

  return [...kept, ...demoted].slice(0, k);
}

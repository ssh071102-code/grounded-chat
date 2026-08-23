import type { Embedder } from "./embed/types";
import { capPerDoc, rrfFuse } from "./fuse";
import { buildLexicalIndex, lexicalSearch, type LexicalIndex } from "./lexical";
import type { VectorStore } from "./store/types";
import type { Chunk, ScoredChunk } from "./types";

export type RetrieverName = "dense" | "lexical";
export type RetrieveMode = "dense" | "hybrid";

export interface RetrievedChunk extends ScoredChunk {
  /** Which retrievers surfaced this chunk. Shown in the source panel. */
  from: RetrieverName[];
}

export interface RetrieveDeps {
  store: VectorStore;
  embedder: Embedder;
}

export interface RetrieveOptions {
  k: number;
  /** "dense" reproduces the pre-hybrid behaviour exactly; kept as an escape hatch. */
  mode?: RetrieveMode;
  /** How deep each retriever goes before fusion. */
  candidates?: number;
  /** Maximum chunks any single document may contribute. */
  maxPerDoc?: number;
  rrfK?: number;
}

export const DEFAULT_CANDIDATES = 20;
export const DEFAULT_MAX_PER_DOC = 2;

/**
 * Lexical index cache. Rebuilding BM25 postings on every request would be
 * wasteful even at this corpus size, and the index only changes when the
 * vector index is rebuilt — which `createdAt` in the stored metadata records.
 */
let lexicalCache: { key: string; index: LexicalIndex } | null = null;

async function getLexicalIndex(store: VectorStore): Promise<LexicalIndex> {
  const meta = await store.meta();
  const key = `${store.kind}:${meta?.createdAt ?? "none"}`;
  if (lexicalCache?.key === key) return lexicalCache.index;
  const chunks: Chunk[] = await store.scan();
  const index = buildLexicalIndex(chunks);
  lexicalCache = { key, index };
  return index;
}

/** Test seam: drop the memoized lexical index. */
export function resetLexicalCache(): void {
  lexicalCache = null;
}

/**
 * The single retrieval entry point.
 *
 * Hybrid is implemented and tested but is NOT the default: measured on the
 * 20-question golden set over the real customer corpus it lost to plain dense
 * retrieval at every per-document cap (dense recall@5 0.900 / MRR 0.779;
 * best hybrid 0.850 / 0.677). Fusion pulls near-duplicate suburb pages into
 * the window and pushes strong single-hit answers down. It stays available
 * behind RETRIEVAL_MODE=hybrid for corpora shaped differently, and the numbers
 * above are why it is off. The chat route and the offline eval both
 * call this, so a number measured by the eval is a number the product will
 * actually produce — a preview that builds its own pipeline measures a path
 * nobody ships.
 *
 * Hybrid path: dense candidates and BM25 candidates are fused by reciprocal
 * rank, then capped per document. Scores stay exact cosine similarity against
 * the query, including for chunks only BM25 found, because that is what the
 * source panel labels them.
 */
export async function retrieve(
  deps: RetrieveDeps,
  question: string,
  opts: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const { store, embedder } = deps;
  const k = Math.max(0, Math.trunc(opts.k));
  if (k === 0) return [];

  const [queryVector] = await embedder.embed([question]);
  const mode = opts.mode ?? "dense";

  if (mode === "dense") {
    const dense = await store.query(queryVector!, k);
    return dense.map((chunk) => ({ ...chunk, from: ["dense" as const] }));
  }

  const candidates = Math.max(k, opts.candidates ?? DEFAULT_CANDIDATES);
  const [dense, lexicalIndex] = await Promise.all([
    store.query(queryVector!, candidates),
    getLexicalIndex(store),
  ]);
  const lexical = lexicalSearch(lexicalIndex, question, candidates);

  const byId = new Map<string, Chunk>();
  const from = new Map<string, Set<RetrieverName>>();
  const denseScores = new Map<string, number>();
  const note = (chunk: Chunk, who: RetrieverName) => {
    byId.set(chunk.id, chunk);
    const set = from.get(chunk.id) ?? new Set<RetrieverName>();
    set.add(who);
    from.set(chunk.id, set);
  };
  for (const hit of dense) {
    note(hit, "dense");
    denseScores.set(hit.id, hit.score);
  }
  for (const hit of lexical) note(hit, "lexical");

  const fused = rrfFuse(
    [dense.map((d) => d.id), lexical.map((l) => l.id)],
    opts.rrfK,
  );
  const ordered = fused.map((f) => byId.get(f.id)!);
  const picked = capPerDoc(ordered, opts.maxPerDoc ?? DEFAULT_MAX_PER_DOC, k);

  // Chunks BM25 found but the vector query did not have no cosine yet.
  const missing = picked.filter((c) => !denseScores.has(c.id)).map((c) => c.id);
  if (missing.length > 0) {
    const sims = await store.similarities(queryVector!, missing);
    for (const [id, score] of sims) denseScores.set(id, score);
  }

  return picked.map((chunk) => ({
    ...chunk,
    score: denseScores.get(chunk.id) ?? 0,
    from: [...(from.get(chunk.id) ?? new Set<RetrieverName>())],
  }));
}

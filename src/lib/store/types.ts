import type { Chunk, IndexMeta, ScoredChunk } from "../types";

export interface EmbeddedChunk {
  chunk: Chunk;
  vector: Float32Array;
}

/**
 * Vector store contract. Both adapters (file-based and pgvector) implement
 * this interface and are exercised by the same contract test suite.
 *
 * Semantics:
 * - `rebuild` atomically replaces the whole index (ingestion is idempotent).
 * - `query` returns the top-k chunks by cosine similarity, highest first.
 *   Inputs are L2-normalized, so cosine similarity equals the dot product.
 * - `scan` returns every stored chunk, unordered and unscored. The lexical
 *   (BM25) half of hybrid retrieval needs the full text of the corpus, which
 *   a vector query cannot supply without inventing a query vector.
 * - `count` returns 0 when no index has been built yet.
 */
export interface VectorStore {
  readonly kind: "file" | "pgvector";
  rebuild(meta: IndexMeta, records: EmbeddedChunk[]): Promise<void>;
  query(vector: Float32Array, k: number): Promise<ScoredChunk[]>;
  scan(): Promise<Chunk[]>;
  /**
   * Exact cosine similarity for the named chunks. Hybrid retrieval surfaces
   * chunks the vector query never returned; the UI still labels the number
   * "cosine", so it has to be one. Unknown ids are omitted, not thrown.
   */
  similarities(vector: Float32Array, ids: string[]): Promise<Map<string, number>>;
  meta(): Promise<IndexMeta | null>;
  count(): Promise<number>;
  close(): Promise<void>;
}

export type { Chunk, IndexMeta, ScoredChunk };

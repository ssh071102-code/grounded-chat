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
 * - `count` returns 0 when no index has been built yet.
 */
export interface VectorStore {
  readonly kind: "file" | "pgvector";
  rebuild(meta: IndexMeta, records: EmbeddedChunk[]): Promise<void>;
  query(vector: Float32Array, k: number): Promise<ScoredChunk[]>;
  meta(): Promise<IndexMeta | null>;
  count(): Promise<number>;
  close(): Promise<void>;
}

export type { Chunk, IndexMeta, ScoredChunk };

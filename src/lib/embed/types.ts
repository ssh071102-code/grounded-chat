/** Text embedding backend. Implementations must return L2-normalized vectors. */
export interface Embedder {
  /** Identifier persisted in the index metadata (guards against mixed indexes). */
  readonly id: string;
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

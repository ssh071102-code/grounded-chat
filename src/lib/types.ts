/** A contiguous span of a source document, the unit of retrieval. */
export interface Chunk {
  /** Stable identifier: `${docId}#${index}`. */
  id: string;
  /** Source file name, e.g. "einstein-relativity.txt". */
  docId: string;
  /** Human-readable document title. */
  title: string;
  /** Position of the chunk within its document (0-based). */
  index: number;
  text: string;
}

export interface ScoredChunk extends Chunk {
  /** Cosine similarity against the query (vectors are L2-normalized). */
  score: number;
}

export interface IndexMeta {
  /** Identifier of the embedder that produced the vectors. */
  embedder: string;
  /** Vector dimensionality. */
  dim: number;
  chunking: {
    targetChars: number;
    overlapSentences: number;
  };
  documents: { docId: string; title: string; chunks: number }[];
  createdAt: string;
}

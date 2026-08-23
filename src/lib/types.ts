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
  /**
   * The host this corpus was crawled from. Recorded at ingestion because it is
   * the only moment it is known for certain, and checked before every deploy:
   * inferring provenance from document titles worked only for a corpus built
   * by hand, where the source URL happened to be the first line of the file.
   */
  source?: string;
}

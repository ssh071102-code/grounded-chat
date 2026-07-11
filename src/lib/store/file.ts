import { promises as fs } from "node:fs";
import path from "node:path";
import type { Chunk, IndexMeta, ScoredChunk } from "../types";
import type { EmbeddedChunk, VectorStore } from "./types";

interface LoadedIndex {
  meta: IndexMeta;
  chunks: Chunk[];
  /** Row-major [count x dim] matrix of L2-normalized vectors. */
  vectors: Float32Array;
}

/**
 * Default store: chunk metadata in `index.json`, vectors as raw Float32 in
 * `vectors.bin`. Queries are an exact brute-force dot product over the whole
 * matrix — perfectly fine for corpora up to tens of thousands of chunks, and
 * honest about not being an ANN index (see README "Storage adapters").
 */
export class FileStore implements VectorStore {
  readonly kind = "file" as const;
  private cache: LoadedIndex | null = null;

  constructor(private readonly dir: string) {}

  private get metaPath() {
    return path.join(this.dir, "index.json");
  }
  private get vectorsPath() {
    return path.join(this.dir, "vectors.bin");
  }

  async rebuild(meta: IndexMeta, records: EmbeddedChunk[]): Promise<void> {
    const { dim } = meta;
    const vectors = new Float32Array(records.length * dim);
    records.forEach((record, i) => {
      if (record.vector.length !== dim) {
        throw new Error(
          `vector for ${record.chunk.id} has dim ${record.vector.length}, expected ${dim}`,
        );
      }
      vectors.set(record.vector, i * dim);
    });

    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(
      this.vectorsPath,
      Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength),
    );
    await fs.writeFile(
      this.metaPath,
      JSON.stringify({ meta, chunks: records.map((r) => r.chunk) }),
    );
    this.cache = { meta, chunks: records.map((r) => r.chunk), vectors };
  }

  private async load(): Promise<LoadedIndex | null> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await fs.readFile(this.metaPath, "utf8")) as {
        meta: IndexMeta;
        chunks: Chunk[];
      };
      const raw = await fs.readFile(this.vectorsPath);
      const vectors = new Float32Array(
        raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      );
      if (vectors.length !== parsed.chunks.length * parsed.meta.dim) {
        throw new Error("vectors.bin size does not match index.json");
      }
      this.cache = { meta: parsed.meta, chunks: parsed.chunks, vectors };
      return this.cache;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async query(vector: Float32Array, k: number): Promise<ScoredChunk[]> {
    const index = await this.load();
    if (!index) {
      throw new Error("index not built - run: npm run ingest -- corpus");
    }
    const { meta, chunks, vectors } = index;
    if (vector.length !== meta.dim) {
      throw new Error(`query vector dim ${vector.length}, index dim ${meta.dim}`);
    }

    const scored: ScoredChunk[] = chunks.map((chunk, row) => {
      let dot = 0;
      const offset = row * meta.dim;
      for (let d = 0; d < meta.dim; d++) {
        dot += vectors[offset + d]! * vector[d]!;
      }
      return { ...chunk, score: dot };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, k));
  }

  async meta(): Promise<IndexMeta | null> {
    return (await this.load())?.meta ?? null;
  }

  async count(): Promise<number> {
    return (await this.load())?.chunks.length ?? 0;
  }

  async close(): Promise<void> {
    this.cache = null;
  }
}

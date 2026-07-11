import { Pool } from "pg";
import type { IndexMeta, ScoredChunk } from "../types";
import type { EmbeddedChunk, VectorStore } from "./types";

const CHUNKS_TABLE = "gc_chunks";
const META_TABLE = "gc_meta";
const INSERT_BATCH = 200;

function toVectorLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/**
 * pgvector adapter implementing the same VectorStore contract as FileStore.
 * Uses cosine distance (`<=>`); vectors are L2-normalized, so
 * similarity = 1 - distance. An HNSW index is created for scale beyond
 * what brute force handles comfortably.
 */
export class PgVectorStore implements VectorStore {
  readonly kind = "pgvector" as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async rebuild(meta: IndexMeta, records: EmbeddedChunk[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query("BEGIN");
      await client.query(`DROP TABLE IF EXISTS ${CHUNKS_TABLE}`);
      await client.query(
        `CREATE TABLE ${CHUNKS_TABLE} (
          id text PRIMARY KEY,
          doc_id text NOT NULL,
          title text NOT NULL,
          idx int NOT NULL,
          content text NOT NULL,
          embedding vector(${meta.dim}) NOT NULL
        )`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key text PRIMARY KEY, value jsonb NOT NULL)`,
      );

      for (let i = 0; i < records.length; i += INSERT_BATCH) {
        const batch = records.slice(i, i + INSERT_BATCH);
        const params: unknown[] = [];
        const rows = batch.map((record, j) => {
          const base = j * 6;
          params.push(
            record.chunk.id,
            record.chunk.docId,
            record.chunk.title,
            record.chunk.index,
            record.chunk.text,
            toVectorLiteral(record.vector),
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::vector)`;
        });
        await client.query(
          `INSERT INTO ${CHUNKS_TABLE} (id, doc_id, title, idx, content, embedding) VALUES ${rows.join(", ")}`,
          params,
        );
      }

      await client.query(
        `CREATE INDEX ${CHUNKS_TABLE}_embedding_idx ON ${CHUNKS_TABLE}
         USING hnsw (embedding vector_cosine_ops)`,
      );
      await client.query(
        `INSERT INTO ${META_TABLE} (key, value) VALUES ('index', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(meta)],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async query(vector: Float32Array, k: number): Promise<ScoredChunk[]> {
    const literal = toVectorLiteral(vector);
    const result = await this.pool.query<{
      id: string;
      doc_id: string;
      title: string;
      idx: number;
      content: string;
      score: number;
    }>(
      `SELECT id, doc_id, title, idx, content,
              1 - (embedding <=> $1::vector) AS score
       FROM ${CHUNKS_TABLE}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [literal, Math.max(0, k)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      docId: row.doc_id,
      title: row.title,
      index: row.idx,
      text: row.content,
      score: Number(row.score),
    }));
  }

  async meta(): Promise<IndexMeta | null> {
    try {
      const result = await this.pool.query<{ value: IndexMeta }>(
        `SELECT value FROM ${META_TABLE} WHERE key = 'index'`,
      );
      return result.rows[0]?.value ?? null;
    } catch (err) {
      if ((err as { code?: string }).code === "42P01") return null; // table missing
      throw err;
    }
  }

  async count(): Promise<number> {
    try {
      const result = await this.pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM ${CHUNKS_TABLE}`,
      );
      return Number(result.rows[0]?.count ?? 0);
    } catch (err) {
      if ((err as { code?: string }).code === "42P01") return 0; // table missing
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

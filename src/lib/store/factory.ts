import path from "node:path";
import { FileStore } from "./file";
import { PgVectorStore } from "./pgvector";
import type { VectorStore } from "./types";

export const DEFAULT_INDEX_DIR = path.join(process.cwd(), "data", "index");

/** File store by default; pgvector when PGVECTOR_URL is set. */
export function createStore(): VectorStore {
  const url = process.env.PGVECTOR_URL;
  if (url) return new PgVectorStore(url);
  return new FileStore(DEFAULT_INDEX_DIR);
}

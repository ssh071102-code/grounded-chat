import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileStore } from "@/lib/store/file";
import { PgVectorStore } from "@/lib/store/pgvector";
import { describeStoreContract } from "./helpers/store-contract";

describeStoreContract("FileStore", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grounded-chat-store-"));
  return {
    store: new FileStore(dir),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
});

// Integration test for the pgvector adapter. Requires a running Postgres with
// pgvector (docker compose up -d) and PGVECTOR_URL to be set, e.g.:
//   PGVECTOR_URL=postgresql://postgres:postgres@localhost:5433/grounded npm test
// Skipped otherwise so the default test run stays fully offline.
const pgUrl = process.env.PGVECTOR_URL;
describeStoreContract(
  "PgVectorStore",
  async () => ({
    store: new PgVectorStore(pgUrl!),
    cleanup: async () => {},
  }),
  { skip: !pgUrl },
);

describe("FileStore specifics", () => {
  it("count() is 0 and query() throws before any ingest", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "grounded-chat-empty-"));
    try {
      const store = new FileStore(dir);
      expect(await store.count()).toBe(0);
      expect(await store.meta()).toBeNull();
      await expect(store.query(new Float32Array(4), 3)).rejects.toThrow(
        /index not built/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists to disk and reloads in a fresh instance", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "grounded-chat-reload-"));
    try {
      const writer = new FileStore(dir);
      const vector = new Float32Array([1, 0, 0, 0]);
      await writer.rebuild(
        {
          embedder: "contract-test",
          dim: 4,
          chunking: { targetChars: 1100, overlapSentences: 2 },
          documents: [{ docId: "a.txt", title: "A", chunks: 1 }],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        [
          {
            chunk: { id: "a.txt#0", docId: "a.txt", title: "A", index: 0, text: "hello" },
            vector,
          },
        ],
      );
      await writer.close();

      const reader = new FileStore(dir);
      expect(await reader.count()).toBe(1);
      const [top] = await reader.query(vector, 1);
      expect(top).toMatchObject({ id: "a.txt#0", text: "hello" });
      expect(top!.score).toBeCloseTo(1, 4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

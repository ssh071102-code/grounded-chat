import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Chunk, IndexMeta } from "@/lib/types";
import type { EmbeddedChunk, VectorStore } from "@/lib/store/types";

const DIM = 4;

function meta(overrides: Partial<IndexMeta> = {}): IndexMeta {
  return {
    embedder: "contract-test",
    dim: DIM,
    chunking: { targetChars: 1100, overlapSentences: 2 },
    documents: [{ docId: "doc.txt", title: "Doc", chunks: 3 }],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function chunk(index: number, text: string): Chunk {
  return { id: `doc.txt#${index}`, docId: "doc.txt", title: "Doc", index, text };
}

/** Unit vectors so cosine similarity == dot product is exact and predictable. */
function unit(dims: number[]): Float32Array {
  const v = new Float32Array(DIM);
  let norm = 0;
  dims.forEach((value, i) => {
    v[i] = value;
    norm += value * value;
  });
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIM; i++) v[i] = v[i]! / norm;
  return v;
}

const RECORDS: EmbeddedChunk[] = [
  { chunk: chunk(0, "alpha"), vector: unit([1, 0, 0, 0]) },
  { chunk: chunk(1, "beta"), vector: unit([0, 1, 0, 0]) },
  { chunk: chunk(2, "gamma"), vector: unit([1, 1, 0, 0]) },
];

/**
 * Contract test suite shared by every VectorStore implementation.
 * FileStore runs it always; PgVectorStore runs it when PGVECTOR_URL is set
 * (see tests/store.test.ts).
 */
export function describeStoreContract(
  name: string,
  factory: () => Promise<{ store: VectorStore; cleanup: () => Promise<void> }>,
  options: { skip?: boolean } = {},
) {
  describe.skipIf(options.skip ?? false)(`VectorStore contract: ${name}`, () => {
    let store: VectorStore;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      ({ store, cleanup } = await factory());
    });

    afterAll(async () => {
      await store.close();
      await cleanup();
    });

    it("reports an empty index after rebuilding with no records", async () => {
      await store.rebuild(meta({ documents: [] }), []);
      expect(await store.count()).toBe(0);
    });

    it("stores records and round-trips metadata", async () => {
      await store.rebuild(meta(), RECORDS);
      expect(await store.count()).toBe(3);
      const stored = await store.meta();
      expect(stored).toEqual(meta());
    });

    it("returns exact nearest neighbours ordered by cosine similarity", async () => {
      await store.rebuild(meta(), RECORDS);
      const results = await store.query(unit([0, 1, 0, 0]), 3);
      expect(results.map((r) => r.id)).toEqual([
        "doc.txt#1", // identical direction, score 1
        "doc.txt#2", // 45 degrees, score ~0.707
        "doc.txt#0", // orthogonal, score 0
      ]);
      expect(results[0]!.score).toBeCloseTo(1, 4);
      expect(results[1]!.score).toBeCloseTo(Math.SQRT1_2, 4);
      expect(results[2]!.score).toBeCloseTo(0, 4);
      expect(results[0]).toMatchObject({
        docId: "doc.txt",
        title: "Doc",
        index: 1,
        text: "beta",
      });
    });

    it("clamps k to the number of stored records", async () => {
      await store.rebuild(meta(), RECORDS);
      const results = await store.query(unit([1, 0, 0, 0]), 10);
      expect(results).toHaveLength(3);
    });

    it("returns nothing for k = 0", async () => {
      await store.rebuild(meta(), RECORDS);
      expect(await store.query(unit([1, 0, 0, 0]), 0)).toEqual([]);
    });

    it("rebuild fully replaces the previous index", async () => {
      await store.rebuild(meta(), RECORDS);
      const single: EmbeddedChunk[] = [
        { chunk: chunk(0, "delta"), vector: unit([0, 0, 1, 0]) },
      ];
      await store.rebuild(meta({ documents: [{ docId: "doc.txt", title: "Doc", chunks: 1 }] }), single);
      expect(await store.count()).toBe(1);
      const results = await store.query(unit([0, 0, 1, 0]), 5);
      expect(results.map((r) => r.text)).toEqual(["delta"]);
    });
  });
}

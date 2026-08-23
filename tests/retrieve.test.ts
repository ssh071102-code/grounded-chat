import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { retrieve } from "@/lib/retrieve";
import { FileStore } from "@/lib/store/file";
import type { EmbeddedChunk } from "@/lib/store/types";
import type { IndexMeta } from "@/lib/types";
import { FakeEmbedder } from "./helpers/fake-embedder";

const embedder = new FakeEmbedder();

/**
 * A miniature of the failure measured on a real customer corpus: the single
 * page that names the service verbatim is long and topically diluted, while
 * nine suburb landing pages repeat a short boilerplate line that shares most
 * of the query's common words. Vector similarity ranks the boilerplate first
 * and the canonical page falls out of the window.
 */
const CANONICAL = [
  "Heritage and period restoration.",
  "Gutter replacement, scaffolding hire, roof tiling, interior painting,",
  "rendering, waterproofing, concrete cutting, driveway sealing, fencing,",
  "landscaping, invoicing, scheduling, warranty paperwork, site cleanup,",
  "council permits, engineering certificates, and progress photography.",
].join(" ");

const BOILERPLATE = "Insurance work, crack repairs, repointing and heritage restoration.";
const SUBURBS = [
  "fairview", "stanton", "riverton", "kingsley", "elmsford",
  "westbrook", "belmore", "thornbury", "ashgrove",
];

const QUESTION = "heritage period restoration";

async function buildIndex(store: FileStore) {
  const docs = [
    { docId: "services.txt", text: CANONICAL },
    ...SUBURBS.map((s) => ({
      docId: `${s}-bricklayer.txt`,
      text: `Bricklayer in ${s}. ${BOILERPLATE}`,
    })),
  ];
  const vectors = await embedder.embed(docs.map((d) => d.text));
  const records: EmbeddedChunk[] = docs.map((d, i) => ({
    chunk: { id: `${d.docId}#0`, docId: d.docId, title: d.docId, index: 0, text: d.text },
    vector: vectors[i]!,
  }));
  const meta: IndexMeta = {
    embedder: embedder.id,
    dim: embedder.dim,
    chunking: { targetChars: 1100, overlapSentences: 2 },
    documents: docs.map((d) => ({ docId: d.docId, title: d.docId, chunks: 1 })),
    createdAt: "2026-08-20T00:00:00.000Z",
  };
  await store.rebuild(meta, records);
}

describe("retrieve", () => {
  let dir: string;
  let store: FileStore;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gc-retrieve-"));
    store = new FileStore(dir);
    await buildIndex(store);
  });

  afterAll(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("dense mode returns exactly what the vector query returns", async () => {
    const [qv] = await embedder.embed([QUESTION]);
    const baseline = await store.query(qv!, 3);
    const got = await retrieve({ store, embedder }, QUESTION, { k: 3, mode: "dense" });
    expect(got.map((g) => g.id)).toEqual(baseline.map((b) => b.id));
    expect(got.every((g) => g.from.length === 1 && g.from[0] === "dense")).toBe(true);
  });

  it("records which retrievers found each chunk", async () => {
    const hybrid = await retrieve({ store, embedder }, QUESTION, { k: 5, mode: "hybrid" });
    const canonical = hybrid.find((h) => h.docId === "services.txt")!;
    expect(canonical.from).toContain("lexical");
  });

  it("reports a true cosine score for chunks only the lexical path found", async () => {
    const [qv] = await embedder.embed([QUESTION]);
    const hybrid = await retrieve({ store, embedder }, QUESTION, { k: 5, mode: "hybrid" });
    const truth = await store.similarities(qv!, hybrid.map((h) => h.id));
    for (const hit of hybrid) {
      expect(hit.score).toBeCloseTo(truth.get(hit.id)!, 4);
    }
  });

  it("never returns more than k chunks", async () => {
    const hybrid = await retrieve({ store, embedder }, QUESTION, { k: 4, mode: "hybrid" });
    expect(hybrid).toHaveLength(4);
  });

  it("caps how many chunks one document may contribute", async () => {
    const dir2 = await mkdtemp(path.join(os.tmpdir(), "gc-retrieve-cap-"));
    const store2 = new FileStore(dir2);
    const texts = Array.from({ length: 6 }, (_, i) => `Heritage period restoration paragraph ${i}.`);
    const vectors = await embedder.embed(texts);
    await store2.rebuild(
      {
        embedder: embedder.id,
        dim: embedder.dim,
        chunking: { targetChars: 1100, overlapSentences: 2 },
        documents: [{ docId: "home.txt", title: "home", chunks: 6 }],
        createdAt: "2026-08-20T00:00:00.000Z",
      },
      texts.map((text, i) => ({
        chunk: { id: `home.txt#${i}`, docId: "home.txt", title: "home", index: i, text },
        vector: vectors[i]!,
      })),
    );
    const hits = await retrieve({ store: store2, embedder }, QUESTION, {
      k: 4,
      mode: "hybrid",
      maxPerDoc: 2,
    });
    // Only one document exists, so the cap must still backfill up to k.
    expect(hits).toHaveLength(4);
    await store2.close();
    await rm(dir2, { recursive: true, force: true });
  });
});

/**
 * The failure actually measured on the customer corpus: one document supplies
 * several chunks that all beat the canonical page on vector similarity, so the
 * canonical page never enters the window. This is reproducible with any
 * embedder because it is about the shape of the corpus, not the model.
 *
 * Note on scope: the divergence between dense and BM25 *ranking* cannot be
 * demonstrated with FakeEmbedder, which is a hashed bag of words and therefore
 * already lexical. That claim is carried by the offline eval against the real
 * MiniLM embedder and the 20-question golden set, not by a unit fixture.
 */
describe("retrieve, when one document crowds the window", () => {
  let dir: string;
  let store: FileStore;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "gc-crowding-"));
    store = new FileStore(dir);
    const docs = [
      ...Array.from({ length: 4 }, (_, i) => ({
        docId: "home.txt",
        index: i,
        text: `${QUESTION} enquiries welcome.`,
      })),
      { docId: "services.txt", index: 0, text: CANONICAL },
    ];
    const vectors = await embedder.embed(docs.map((d) => d.text));
    await store.rebuild(
      {
        embedder: embedder.id,
        dim: embedder.dim,
        chunking: { targetChars: 1100, overlapSentences: 2 },
        documents: [
          { docId: "home.txt", title: "home", chunks: 4 },
          { docId: "services.txt", title: "services", chunks: 1 },
        ],
        createdAt: "2026-08-20T00:00:01.000Z",
      },
      docs.map((d, i) => ({
        chunk: { id: `${d.docId}#${d.index}`, docId: d.docId, title: d.docId, index: d.index, text: d.text },
        vector: vectors[i]!,
      })),
    );
  });

  afterAll(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("dense mode fills the whole window with one document", async () => {
    const dense = await retrieve({ store, embedder }, QUESTION, { k: 3, mode: "dense" });
    expect(new Set(dense.map((d) => d.docId))).toEqual(new Set(["home.txt"]));
  });

  it("hybrid mode leaves room for the page dense crowded out", async () => {
    // Control: fusion alone does not rescue the buried page - without the cap
    // the crowding document still owns the window. This is what gives the
    // assertion below its teeth.
    const uncapped = await retrieve({ store, embedder }, QUESTION, {
      k: 3,
      mode: "hybrid",
      maxPerDoc: 99,
    });
    expect(uncapped.map((h) => h.docId)).not.toContain("services.txt");

    const hybrid = await retrieve({ store, embedder }, QUESTION, {
      k: 3,
      mode: "hybrid",
      maxPerDoc: 2,
    });
    expect(hybrid.map((h) => h.docId)).toContain("services.txt");
    expect(hybrid.filter((h) => h.docId === "home.txt")).toHaveLength(2);
  });
});

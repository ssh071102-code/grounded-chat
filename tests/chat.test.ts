import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleChat, type ChatDeps } from "@/lib/chat";
import { chunkDocument } from "@/lib/chunk";
import { MockLLM } from "@/lib/llm/mock";
import { FileStore } from "@/lib/store/file";
import type { IndexMeta } from "@/lib/types";
import { FakeEmbedder } from "./helpers/fake-embedder";

const embedder = new FakeEmbedder();

// Single-sentence paragraphs -> single-sentence chunks, which makes the mock
// LLM's extractive answer score ~1.0 against its source chunk.
const DOC = [
  "The northern lighthouse keeper trims the lamp wick every evening at dusk.",
  "Migrating cranes navigate using coastal landmarks and prevailing winds.",
  "Volcanic soil on the island produces unusually sweet root vegetables.",
].join("\n\n");

interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSSE(raw: string): SSEEvent[] {
  return raw
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const eventLine = block.match(/^event: (.+)$/m);
      const dataLine = block.match(/^data: (.+)$/m);
      return {
        event: eventLine?.[1] ?? "",
        data: JSON.parse(dataLine?.[1] ?? "{}") as Record<string, unknown>,
      };
    });
}

describe("handleChat", () => {
  let dir: string;
  let store: FileStore;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "grounded-chat-chat-"));
    store = new FileStore(dir);
    const chunks = chunkDocument("islands.txt", "Island Almanac", DOC, {
      targetChars: 80,
      overlapSentences: 0,
    });
    const vectors = await embedder.embed(chunks.map((c) => c.text));
    const meta: IndexMeta = {
      embedder: embedder.id,
      dim: embedder.dim,
      chunking: { targetChars: 80, overlapSentences: 0 },
      documents: [{ docId: "islands.txt", title: "Island Almanac", chunks: chunks.length }],
      createdAt: new Date().toISOString(),
    };
    await store.rebuild(
      meta,
      chunks.map((chunk, i) => ({ chunk, vector: vectors[i]! })),
    );
  });

  afterAll(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  function deps(overrides: Partial<ChatDeps> = {}): ChatDeps {
    return { store, embedder, llm: null, ...overrides };
  }

  it("rejects a missing or empty question with 400", async () => {
    expect((await handleChat(deps(), null)).status).toBe(400);
    expect((await handleChat(deps(), {})).status).toBe(400);
    expect((await handleChat(deps(), { question: "   " })).status).toBe(400);
  });

  it("returns 409 with an ingest hint when no index exists", async () => {
    const emptyDir = await mkdtemp(path.join(os.tmpdir(), "grounded-chat-none-"));
    try {
      const emptyStore = new FileStore(emptyDir);
      const res = await handleChat(
        deps({ store: emptyStore }),
        { question: "anything" },
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { hint: string };
      expect(body.hint).toContain("npm run ingest");
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("serves retrieval-only JSON when no LLM is configured", async () => {
    const res = await handleChat(deps(), {
      question: "Do migrating cranes navigate using coastal landmarks?",
      k: 2,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = (await res.json()) as {
      mode: string;
      sources: { index: number; text: string; score: number; docId: string }[];
    };
    expect(body.mode).toBe("retrieval-only");
    expect(body.sources).toHaveLength(2);
    expect(body.sources[0]!.index).toBe(1);
    expect(body.sources[0]!.text).toContain("cranes");
    expect(body.sources[0]!.score).toBeGreaterThan(body.sources[1]!.score);
  });

  it("clamps k into [1, 10]", async () => {
    const res = await handleChat(deps(), { question: "cranes", k: 99 });
    const body = (await res.json()) as { sources: unknown[] };
    expect(body.sources.length).toBeLessThanOrEqual(10);
    const res2 = await handleChat(deps(), { question: "cranes", k: -3 });
    const body2 = (await res2.json()) as { sources: unknown[] };
    expect(body2.sources).toHaveLength(1);
  });

  it("streams meta, deltas, verification, done over SSE with a mocked LLM", async () => {
    const res = await handleChat(deps({ llm: new MockLLM(0) }), {
      question: "How do the cranes navigate?",
      k: 3,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const events = parseSSE(await res.text());
    const kinds = events.map((e) => e.event);

    expect(kinds[0]).toBe("meta");
    expect(kinds.at(-2)).toBe("verification");
    expect(kinds.at(-1)).toBe("done");
    expect(kinds.filter((k) => k === "delta").length).toBeGreaterThan(5);
    expect(kinds).not.toContain("error");

    const metaEvent = events[0]!.data as {
      mode: string;
      sources: { index: number; id: string }[];
    };
    expect(metaEvent.mode).toBe("mock");
    expect(metaEvent.sources).toHaveLength(3);

    const answer = events
      .filter((e) => e.event === "delta")
      .map((e) => (e.data as { text: string }).text)
      .join("");
    expect(answer).toContain("[1]");

    const verification = events.find((e) => e.event === "verification")!
      .data as {
      threshold: number;
      verdicts: { status: string; sentence: string }[];
    };
    const statuses = verification.verdicts.map((v) => v.status);
    // The mock quotes real sources (supported) then fabricates one claim.
    expect(statuses).toContain("supported");
    expect(statuses).toContain("unsupported");
    const flagged = verification.verdicts.find((v) => v.status === "unsupported")!;
    expect(flagged.sentence).toContain("balloon");
  });

  it("emits an SSE error event when the LLM stream fails mid-way", async () => {
    const failing = {
      name: "mock" as const,
       
      async *streamAnswer(): AsyncIterable<string> {
        throw new Error("upstream exploded");
      },
    };
    const res = await handleChat(deps({ llm: failing }), {
      question: "cranes",
    });
    const events = parseSSE(await res.text());
    expect(events.map((e) => e.event)).toContain("error");
    expect(events.map((e) => e.event)).not.toContain("done");
  });
});

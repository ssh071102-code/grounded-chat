import { describe, expect, it } from "vitest";
import type { Chunk } from "@/lib/types";
import { verifyAnswer } from "@/lib/verify";
import { FakeEmbedder } from "./helpers/fake-embedder";

const embedder = new FakeEmbedder();

function chunk(index: number, text: string): Chunk {
  return { id: `doc.txt#${index}`, docId: "doc.txt", title: "Doc", index, text };
}

const CHUNKS: Chunk[] = [
  chunk(0, "The quick brown fox jumps over the lazy sleeping dog."),
  chunk(1, "Photosynthesis converts sunlight into chemical energy inside leaves."),
];

describe("verifyAnswer", () => {
  it("marks a sentence copied from a chunk as supported with score ~1", async () => {
    const report = await verifyAnswer(
      "The quick brown fox jumps over the lazy sleeping dog [1].",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts).toHaveLength(1);
    const verdict = report.verdicts[0]!;
    expect(verdict.status).toBe("supported");
    expect(verdict.score).toBeCloseTo(1, 3);
    expect(verdict.bestChunkId).toBe("doc.txt#0");
    // Citation markers are preserved for display...
    expect(verdict.sentence).toContain("[1]");
  });

  it("flags a fabricated sentence as unsupported", async () => {
    const report = await verifyAnswer(
      "Volcanic basalt monuments orbit distant gas giants unpredictably yearly.",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts[0]!.status).toBe("unsupported");
    expect(report.verdicts[0]!.score).toBeLessThan(report.threshold);
  });

  it("judges each sentence independently", async () => {
    const answer =
      "Photosynthesis converts sunlight into chemical energy inside leaves [2]. " +
      "Volcanic basalt monuments orbit distant gas giants unpredictably yearly.";
    const report = await verifyAnswer(answer, CHUNKS, embedder);
    expect(report.verdicts.map((v) => v.status)).toEqual([
      "supported",
      "unsupported",
    ]);
    expect(report.verdicts[0]!.bestChunkId).toBe("doc.txt#1");
  });

  it("strips citation markers before scoring", async () => {
    const withMarkers = await verifyAnswer(
      "The quick brown fox jumps over the lazy sleeping dog [1][2].",
      CHUNKS,
      embedder,
    );
    const withoutMarkers = await verifyAnswer(
      "The quick brown fox jumps over the lazy sleeping dog.",
      CHUNKS,
      embedder,
    );
    expect(withMarkers.verdicts[0]!.score).toBeCloseTo(
      withoutMarkers.verdicts[0]!.score,
      6,
    );
  });

  it("skips sentences too short to judge", async () => {
    const report = await verifyAnswer("Yes [1].", CHUNKS, embedder);
    expect(report.verdicts[0]!.status).toBe("skipped");
    expect(report.verdicts[0]!.bestChunkId).toBeNull();
  });

  it("skips everything when there are no chunks to check against", async () => {
    const report = await verifyAnswer(
      "The quick brown fox jumps over the lazy sleeping dog.",
      [],
      embedder,
    );
    expect(report.verdicts).toHaveLength(1);
    expect(report.verdicts[0]!.status).toBe("skipped");
  });

  it("respects a custom threshold", async () => {
    const strict = await verifyAnswer(
      "A quick brown fox jumped over one lazy sleeping dog recently.",
      CHUNKS,
      embedder,
      0.999,
    );
    expect(strict.verdicts[0]!.status).toBe("unsupported");
    const lax = await verifyAnswer(
      "A quick brown fox jumped over one lazy sleeping dog recently.",
      CHUNKS,
      embedder,
      0.1,
    );
    expect(lax.verdicts[0]!.status).toBe("supported");
  });
});

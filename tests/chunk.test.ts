import { describe, expect, it } from "vitest";
import { chunkDocument, splitSentences } from "@/lib/chunk";

describe("splitSentences", () => {
  it("splits on terminal punctuation", () => {
    expect(splitSentences("One fish. Two fish! Red fish? Blue fish.")).toEqual([
      "One fish.",
      "Two fish!",
      "Red fish?",
      "Blue fish.",
    ]);
  });

  it("does not split after common abbreviations", () => {
    const result = splitSentences(
      "Mr. Darwin studied finches, e.g. on the islands. He took notes.",
    );
    expect(result).toEqual([
      "Mr. Darwin studied finches, e.g. on the islands.",
      "He took notes.",
    ]);
  });

  it("does not split after single-letter initials", () => {
    const result = splitSentences("W. Strunk wrote the rules. They endured.");
    expect(result).toEqual(["W. Strunk wrote the rules.", "They endured."]);
  });

  it("handles closing quotes and parentheses after punctuation", () => {
    const result = splitSentences('He said "stop." Then he left.');
    expect(result).toEqual(['He said "stop."', "Then he left."]);
  });

  it("normalizes whitespace and handles empty input", () => {
    expect(splitSentences("  \n\t ")).toEqual([]);
    expect(splitSentences("A  quick\nline. Next.")).toEqual([
      "A quick line.",
      "Next.",
    ]);
  });
});

describe("chunkDocument", () => {
  const sentence = (i: number) =>
    `Sentence number ${i} contains a reasonable amount of filler text to grow the chunk.`;
  const doc = Array.from({ length: 20 }, (_, i) => sentence(i)).join(" ");

  it("packs whole sentences up to the target size", () => {
    const chunks = chunkDocument("doc.txt", "Doc", doc, {
      targetChars: 300,
      overlapSentences: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Whole sentences only: every chunk ends with terminal punctuation.
      expect(chunk.text).toMatch(/[.!?]$/);
      expect(chunk.text.length).toBeLessThanOrEqual(300 + sentence(0).length);
    }
  });

  it("overlaps consecutive chunks by N sentences", () => {
    const chunks = chunkDocument("doc.txt", "Doc", doc, {
      targetChars: 300,
      overlapSentences: 2,
    });
    for (let i = 1; i < chunks.length; i++) {
      const prevSentences = splitSentences(chunks[i - 1]!.text);
      const overlap = prevSentences.slice(-2).join(" ");
      expect(chunks[i]!.text.startsWith(overlap)).toBe(true);
    }
  });

  it("assigns stable sequential ids", () => {
    const chunks = chunkDocument("doc.txt", "Doc", doc, {
      targetChars: 300,
      overlapSentences: 1,
    });
    chunks.forEach((chunk, i) => {
      expect(chunk.id).toBe(`doc.txt#${i}`);
      expect(chunk.index).toBe(i);
      expect(chunk.docId).toBe("doc.txt");
      expect(chunk.title).toBe("Doc");
    });
  });

  it("keeps an oversized single sentence as its own chunk", () => {
    const long = `${"word ".repeat(100).trim()}.`;
    const chunks = chunkDocument("doc.txt", "Doc", `Short one. ${long} Short two.`, {
      targetChars: 80,
      overlapSentences: 0,
    });
    expect(chunks.some((c) => c.text === long)).toBe(true);
  });

  it("is deterministic", () => {
    const a = chunkDocument("doc.txt", "Doc", doc);
    const b = chunkDocument("doc.txt", "Doc", doc);
    expect(a).toEqual(b);
  });

  it("returns no chunks for empty input", () => {
    expect(chunkDocument("doc.txt", "Doc", "")).toEqual([]);
    expect(chunkDocument("doc.txt", "Doc", "\n\n  \n")).toEqual([]);
  });
});

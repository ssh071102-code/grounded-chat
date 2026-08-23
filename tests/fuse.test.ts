import { describe, expect, it } from "vitest";
import { capPerDoc, rrfFuse } from "@/lib/fuse";

describe("rrfFuse", () => {
  it("ranks an item found by both retrievers above one found by a single retriever", () => {
    const fused = rrfFuse([
      ["dense-only", "both"],
      ["lexical-only", "both"],
    ]);
    expect(fused[0]!.id).toBe("both");
  });

  it("keeps items that only one retriever found", () => {
    const fused = rrfFuse([["a"], ["b"]]);
    expect(fused.map((f) => f.id).sort()).toEqual(["a", "b"]);
  });

  it("fuses on rank, not on score, so incomparable score scales cannot skew it", () => {
    // "steady" is #2 in both lists; "spiky" is #1 in one and absent from the
    // other. Rank-based fusion prefers agreement over a single strong opinion.
    const fused = rrfFuse([
      ["spiky", "steady"],
      ["filler", "steady"],
    ]);
    expect(fused[0]!.id).toBe("steady");
  });

  it("returns an empty list when every retriever returned nothing", () => {
    expect(rrfFuse([[], []])).toEqual([]);
  });
});

describe("capPerDoc", () => {
  const suburbs = Array.from({ length: 9 }, (_, i) => ({
    id: `s${i}#0`,
    docId: `suburb-${i}.txt`,
  }));

  it("stops one document from occupying the whole result window", () => {
    const crowded = Array.from({ length: 6 }, (_, i) => ({
      id: `home.txt#${i}`,
      docId: "home.txt",
    }));
    const picked = capPerDoc([...crowded, ...suburbs], 2, 5);
    expect(picked.filter((p) => p.docId === "home.txt")).toHaveLength(2);
    expect(picked).toHaveLength(5);
  });

  it("preserves the incoming order among the chunks it keeps", () => {
    const picked = capPerDoc(suburbs, 2, 9);
    expect(picked.map((p) => p.id)).toEqual(suburbs.map((s) => s.id));
  });

  it("backfills from demoted chunks rather than returning fewer than k", () => {
    const oneDoc = Array.from({ length: 5 }, (_, i) => ({
      id: `only.txt#${i}`,
      docId: "only.txt",
    }));
    const picked = capPerDoc(oneDoc, 2, 4);
    expect(picked).toHaveLength(4);
    expect(picked.map((p) => p.id)).toEqual([
      "only.txt#0",
      "only.txt#1",
      "only.txt#2",
      "only.txt#3",
    ]);
  });
});

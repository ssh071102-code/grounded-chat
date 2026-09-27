import { describe, expect, it } from "vitest";
import { buildLexicalIndex, lexicalSearch } from "@/lib/lexical";
import type { Chunk } from "@/lib/types";

function chunk(docId: string, index: number, text: string): Chunk {
  return { id: `${docId}#${index}`, docId, title: docId, index, text };
}

/**
 * The shape that broke dense-only retrieval on a crawled service-business site: one
 * canonical services page carries the exact phrase, while nine near-identical
 * suburb pages restate the same idea in boilerplate. Dense similarity cannot
 * separate them; exact term statistics can.
 */
const BOILERPLATE =
  "Insurance work, crack repairs, repointing, and heritage restoration. We fix what time and weather break down.";

const CORPUS: Chunk[] = [
  chunk("services.txt", 0, "Storm and weather damage repairs. Heritage and period restoration. Retaining walls."),
  ...["fairview", "stanton", "riverton", "kingsley", "elmsford", "westbrook", "belmore", "thornbury", "ashgrove"].map(
    (suburb, i) => chunk(`${suburb}-bricklayer.txt`, i, `Bricklayer in ${suburb}. ${BOILERPLATE}`),
  ),
];

describe("lexicalSearch", () => {
  it("ranks the page carrying the exact phrase above near-duplicate boilerplate", () => {
    const index = buildLexicalIndex(CORPUS);
    const hits = lexicalSearch(index, "Heritage and period restoration", 3);
    expect(hits[0]!.docId).toBe("services.txt");
  });

  it("lets a rare term outweigh a term present in every chunk", () => {
    const index = buildLexicalIndex(CORPUS);
    const hits = lexicalSearch(index, "repairs stanton", 1);
    expect(hits[0]!.docId).toBe("stanton-bricklayer.txt");
  });

  it("returns at most k hits, ordered by descending score", () => {
    const index = buildLexicalIndex(CORPUS);
    const hits = lexicalSearch(index, "repairs", 4);
    expect(hits).toHaveLength(4);
    const scores = hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("returns nothing when no query term occurs in the corpus", () => {
    const index = buildLexicalIndex(CORPUS);
    expect(lexicalSearch(index, "kangaroo taxidermy", 5)).toEqual([]);
  });

  it("matches digit runs so phone numbers and prices are retrievable", () => {
    const index = buildLexicalIndex([
      chunk("contact.txt", 0, "Call Dean on 0491 570 156 for a quote."),
      chunk("home.txt", 0, "We build brick fences and retaining walls."),
    ]);
    const hits = lexicalSearch(index, "0491 570 156", 1);
    expect(hits[0]!.docId).toBe("contact.txt");
  });
});

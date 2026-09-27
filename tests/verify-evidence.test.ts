import { describe, expect, it } from "vitest";
import { verifyAnswer } from "@/lib/verify";
import type { Chunk } from "@/lib/types";
import { FakeEmbedder } from "./helpers/fake-embedder";

const embedder = new FakeEmbedder();

/** The real contact page of the corpus the demo is indexed on. */
const CHUNKS: Chunk[] = [
  {
    id: "contact.txt#0",
    docId: "contact.txt",
    title: "Contact",
    index: 0,
    text: "Get a free quote. 0491 570 156 Mon-Fri 7am - 5pm , Sat 8am - 12pm dean@hallidaybrick.example Based in Fairview, servicing all of Adelaide.",
  },
  {
    id: "services.txt#0",
    docId: "services.txt",
    title: "Services",
    index: 0,
    text: "Brick repairs, repointing, retaining walls, extensions, blockwork and rendered finishes. Storm and weather damage repairs. Heritage and period restoration.",
  },
];

async function statusOf(sentence: string) {
  const report = await verifyAnswer(sentence, CHUNKS, embedder);
  return report.verdicts[0]!.status;
}

describe("verifyAnswer, evidence-based grounding", () => {
  it("accepts a fact whose specifics are all present, even when phrasing diverges", async () => {
    // Measured on the deployed demo: cosine 0.40 against "Sat 8am - 12pm",
    // well under the 0.55 threshold, so the old verifier called a directly
    // published fact unsupported. The specifics are all there: Sat/Saturday,
    // 8am, 12pm.
    expect(await statusOf("We are available Saturday 8am to 12pm.")).toBe("supported");
  });

  it("still flags a specific the pages never published", async () => {
    expect(
      await statusOf("There is no mention of Sunday hours, so Sunday is not a working day."),
    ).toBe("unsupported");
  });

  it("does not judge a refusal, which no corpus can ever support", async () => {
    // A corpus cannot evidence an absence. Scoring refusals as unsupported
    // rewards a bot that never refuses, which is backwards for this product.
    expect(await statusOf("That is not something we do.")).toBe("unverifiable");
    expect(await statusOf("That depends on the size and type of the job.")).toBe("unverifiable");
  });

  it("still flags an invented service claim that merely avoids specifics", async () => {
    // The refusal carve-out must not become a hiding place: this asserts
    // something about the world and is not in the pages.
    expect(await statusOf("We offer a lifetime guarantee on all of our work.")).toBe("unsupported");
  });

  it("keeps accepting a well-grounded paraphrase", async () => {
    expect(
      await statusOf("We handle brick repairs, repointing and retaining walls."),
    ).toBe("supported");
  });

  it("reports the counts a caller needs to render a summary", async () => {
    const report = await verifyAnswer(
      "We are available Saturday 8am to 12pm. That is not something we do. We offer a lifetime guarantee on all of our work.",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts.map((v) => v.status)).toEqual([
      "supported",
      "unverifiable",
      "unsupported",
    ]);
  });
});

describe("verifyAnswer, hyphenated source text", () => {
  it("grounds a spelled-out weekday against a hyphenated abbreviation", async () => {
    // The contact page writes "Mon-Fri 7am - 5pm". An answer that spells the
    // days out was being flagged because the corpus token was "mon-fri", which
    // is a prefix of neither "monday" nor "friday".
    const report = await verifyAnswer(
      "Call us on 0491 570 156, Monday to Friday 7am to 5pm.",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts[0]!.status).toBe("supported");
  });
});

/**
 * Reproducing the real failure needs the embedding to have already said yes.
 * With the real MiniLM these sentences score 0.684 and 0.631 against the live
 * corpus, over the 0.55 threshold, because they discuss exactly what the pages
 * discuss and only the number is invented. FakeEmbedder scores them lower, so
 * the condition is induced with an explicit low threshold instead of by
 * swapping in a model - the branch under test is "similarity passed".
 */
const SIMILARITY_ALREADY_PASSED = 0.1;

describe("verifyAnswer, invented specifics inside an on-topic sentence", () => {
  it("flags an invented price even though similarity accepted the sentence", async () => {
    const report = await verifyAnswer(
      "Repointing costs $85 per square metre on a standard wall.",
      CHUNKS,
      embedder,
      SIMILARITY_ALREADY_PASSED,
    );
    expect(report.verdicts[0]!.score).toBeGreaterThan(SIMILARITY_ALREADY_PASSED);
    expect(report.verdicts[0]!.status).toBe("unsupported");
  });

  it("flags an invented number of years the same way", async () => {
    const report = await verifyAnswer(
      "Dean has been laying bricks in Adelaide for over 25 years now.",
      CHUNKS,
      embedder,
      SIMILARITY_ALREADY_PASSED,
    );
    expect(report.verdicts[0]!.status).toBe("unsupported");
  });

  it("keeps supporting an on-topic sentence whose specifics are all published", async () => {
    const report = await verifyAnswer(
      "Dean is based in Fairview and services all of Adelaide.",
      CHUNKS,
      embedder,
      SIMILARITY_ALREADY_PASSED,
    );
    expect(report.verdicts[0]!.status).toBe("supported");
  });
});

describe("verifyAnswer, declines phrased as a boundary", () => {
  it("does not judge a sentence that places something outside what we take on", async () => {
    // Same category as a flat refusal: no body of text can evidence that a
    // service is absent from it.
    const report = await verifyAnswer(
      "Our work is brickwork and masonry, so tiled swimming pools are outside what we take on.",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts[0]!.status).toBe("unverifiable");
  });
});

describe("verifyAnswer, hyphenated specifics in the answer", () => {
  it("grounds a joined time range against a spaced one in the pages", async () => {
    // The pages write "Mon-Fri 7am - 5pm". An answer that closes the gap and
    // writes "7am-5pm" was flagged, because the joined form is not a token in
    // the corpus. Same defect as the corpus-side hyphen fix, other direction.
    const report = await verifyAnswer(
      "Call Dean on 0491 570 156 (Mon-Fri 7am-5pm, Sat 8am-12pm) for a free quote.",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts[0]!.specifics?.filter((s) => !s.grounded)).toEqual([]);
    expect(report.verdicts[0]!.status).toBe("supported");
  });

  it("still flags a hyphenated range the pages do not publish", async () => {
    const report = await verifyAnswer(
      "We are also open Sun 9am-1pm for urgent callouts.",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts[0]!.status).toBe("unsupported");
  });
});

describe("verifyAnswer, numbers written as words", () => {
  it("flags an invented quantity spelled out rather than in digits", async () => {
    // Measured on the bundled corpus: six of nine fabrications passed at the
    // 0.55 threshold, and the ones that slipped carried their invented
    // quantities as words. Only digit runs were being treated as specifics.
    const report = await verifyAnswer(
      "We keep seventeen bricklayers on staff across the metropolitan area.",
      CHUNKS,
      embedder,
      0.1,
    );
    expect(report.verdicts[0]!.status).toBe("unsupported");
  });

  it("grounds a spelled-out number against the digits the pages use", async () => {
    // The contact page writes "Sat 8am - 12pm". An answer saying "eight" for
    // the same fact must not be punished for spelling it out.
    const report = await verifyAnswer(
      "We open at eight on Saturday and close at twelve.",
      CHUNKS,
      embedder,
      0.1,
    );
    expect(report.verdicts[0]!.specifics?.filter((s) => !s.grounded)).toEqual([]);
  });
});

describe("verifyAnswer, number words used as idiom", () => {
  it("does not treat 'one of' as a quantity worth checking", async () => {
    // Live production, 2026-08-21: "Yes, repointing is one of our core
    // services." scored 0.49 and was still marked supported, because "one"
    // counted as a specific and the corpus contains the word. Grounding a
    // sentence on an idiom says nothing about the claim, and it skips the
    // similarity check that would otherwise decide.
    const report = await verifyAnswer(
      "Brick cleaning is one of the services we offer to every customer.",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts[0]!.specifics).toBeUndefined();
  });

  it("still treats a spelled-out quantity as a specific", async () => {
    const report = await verifyAnswer(
      "A boundary wall takes seventeen days from start to finish.",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts[0]!.specifics?.some((s) => s.token === "seventeen")).toBe(true);
    expect(report.verdicts[0]!.status).toBe("unsupported");
  });
});

describe("verifyAnswer, the closing invitation", () => {
  // Every answer ends with one, none of them appears in the pages verbatim,
  // and none asserts anything about the world. Across five test corpora they
  // were about four in ten of all flags, which teaches a reader that orange
  // means nothing.
  it("does not judge an invitation to make contact", async () => {
    for (const sentence of [
      "Give us a ring or fill in the enquiry form and we can walk you through how it all fits together.",
      "Get in touch through the enquiry form and we can talk through the details.",
      "Feel free to get in touch and we can talk through what we can take care of for you.",
      "Give us a call or fill in an enquiry and we can put together something that fits.",
    ]) {
      const report = await verifyAnswer(sentence, CHUNKS, embedder);
      expect(report.verdicts[0]!.status, sentence).toBe("unverifiable");
    }
  });

  it("still checks a contact detail the invitation carries", async () => {
    // The number is a fact a customer acts on, so it goes down the literal
    // path whatever the rest of the sentence is doing.
    const wrong = await verifyAnswer(
      "Give us a call on 0491 570 999 and we can talk it through.",
      CHUNKS,
      embedder,
    );
    expect(wrong.verdicts[0]!.status).toBe("unsupported");
  });

  it("still judges a claim wearing an invitation as a coat", async () => {
    const report = await verifyAnswer(
      "Get in touch and we can have someone on site within the hour, anywhere in the state.",
      CHUNKS,
      embedder,
    );
    expect(report.verdicts[0]!.status).not.toBe("unverifiable");
  });
});

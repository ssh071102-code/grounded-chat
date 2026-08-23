import { describe, expect, it } from "vitest";
import { parseHistory, retrievalQuery, MAX_TURNS } from "@/lib/conversation";

describe("retrievalQuery", () => {
  it("uses the question alone when there is no history", () => {
    expect(retrievalQuery([], "Do you build retaining walls?")).toBe(
      "Do you build retaining walls?",
    );
  });

  it("carries the previous question forward so a follow-up has something to match", () => {
    // "What about a bigger one?" embedded alone matches nothing in a corpus
    // about brickwork. The subject has to come from the turn before it.
    const q = retrievalQuery(
      [{ question: "How much does repointing cost per square metre?", answer: "It depends." }],
      "What about a bigger wall?",
    );
    expect(q).toContain("repointing");
    expect(q).toContain("bigger wall");
  });

  it("weights the current question last, where the retriever leans", () => {
    const q = retrievalQuery(
      [{ question: "Do you do insurance work?", answer: "Yes." }],
      "How long does it take?",
    );
    expect(q.endsWith("How long does it take?")).toBe(true);
  });

  it("keeps only recent turns, so the query does not drift into the whole session", () => {
    const history = Array.from({ length: 8 }, (_, i) => ({
      question: `question number ${i}`,
      answer: "an answer",
    }));
    const q = retrievalQuery(history, "and now this one");
    expect(q).not.toContain("question number 0");
    expect(q).toContain("question number 7");
  });

  it("leaves answers out of the query, since they repeat the passages", () => {
    const q = retrievalQuery(
      [{ question: "Saturday hours?", answer: "Saturdays we are open 8am to 12pm." }],
      "And Sunday?",
    );
    expect(q).not.toContain("8am");
  });
});

describe("parseHistory", () => {
  it("accepts well-formed turns", () => {
    expect(
      parseHistory([{ question: "a", answer: "b" }, { question: "c", answer: "d" }]),
    ).toEqual([{ question: "a", answer: "b" }, { question: "c", answer: "d" }]);
  });

  it("returns nothing for a body that carries no history", () => {
    expect(parseHistory(undefined)).toEqual([]);
    expect(parseHistory("not an array")).toEqual([]);
    expect(parseHistory([{ nope: 1 }])).toEqual([]);
  });

  it("drops turns beyond the cap, keeping the most recent", () => {
    const many = Array.from({ length: MAX_TURNS + 5 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`,
    }));
    const kept = parseHistory(many);
    expect(kept).toHaveLength(MAX_TURNS);
    expect(kept.at(-1)!.question).toBe(`q${MAX_TURNS + 4}`);
  });

  it("truncates a turn a caller made enormous, since history is client-supplied", () => {
    // The widget posts this back from the browser, so a hostile caller can put
    // anything in it. Every turn costs input tokens on the client's key.
    const kept = parseHistory([{ question: "x".repeat(9999), answer: "y".repeat(9999) }]);
    expect(kept[0]!.question.length).toBeLessThan(1000);
    expect(kept[0]!.answer.length).toBeLessThan(1000);
  });
});

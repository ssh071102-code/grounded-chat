import { describe, expect, it } from "vitest";
import { visitorMessage } from "@/lib/visitor-message";

describe("visitorMessage", () => {
  it("never shows a shell command or an environment variable", () => {
    // Rendered verbatim to a visitor before this existed: someone trying to
    // find out whether a bricklayer works Saturdays was shown a command to run.
    const out = visitorMessage("index not built - run: npm run ingest -- corpus");
    expect(out).not.toMatch(/npm |run:|ANTHROPIC|corpus|index not built/i);
    expect(out.length).toBeGreaterThan(10);
  });

  it("says something useful when the visitor has asked too fast", () => {
    expect(visitorMessage("too many questions from this address, briefly", 429)).toMatch(
      /moment|shortly|again/i,
    );
  });

  it("hides a raw network error behind something a person can act on", () => {
    const out = visitorMessage("Failed to fetch");
    expect(out).not.toContain("Failed to fetch");
    expect(out).toMatch(/again|get in touch|call/i);
  });

  it("gives the same shape of answer whatever went wrong", () => {
    for (const detail of ["", "TypeError: x is not a function", "500", "boom"]) {
      const out = visitorMessage(detail);
      expect(out.length).toBeGreaterThan(10);
      expect(out).not.toContain(detail || "\u0000");
    }
  });
});

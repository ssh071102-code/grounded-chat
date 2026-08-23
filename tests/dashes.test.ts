import { describe, expect, it } from "vitest";
import { plainDashes, plainDashStream } from "@/lib/llm/anthropic";

describe("plainDashes", () => {
  it("replaces an em dash used as punctuation with a plain hyphen", () => {
    expect(plainDashes("Quotes are free — give Dean a call.")).toBe(
      "Quotes are free - give Dean a call.",
    );
  });

  it("handles an em dash with no surrounding spaces", () => {
    expect(plainDashes("free—call us")).toBe("free - call us");
  });

  it("leaves a numeric range alone, which is correct typography", () => {
    // Mon-Fri 7am-5pm written with en dashes is how a person sets a range,
    // and the outbound gate in gig-radar deliberately allows it too.
    const range = "Mon–Fri 7am–5pm";
    expect(plainDashes(range)).toBe(range);
  });

  it("replaces a spaced en dash, which is the punctuation use", () => {
    expect(plainDashes("free – call us")).toBe("free - call us");
  });

  it("leaves ordinary text untouched", () => {
    expect(plainDashes("A well-built wall costs more.")).toBe("A well-built wall costs more.");
  });
});

describe("plainDashStream", () => {
  async function* chunks(...parts: string[]) {
    for (const part of parts) yield part;
  }
  async function collect(source: AsyncIterable<string>) {
    let out = "";
    for await (const part of source) out += part;
    return out;
  }

  it("normalises a dash that arrives split across two chunks", async () => {
    // The gateway can end a delta anywhere, including right on the dash.
    const out = await collect(plainDashStream(chunks("Quotes are free —", " give Dean a call.")));
    expect(out).toBe("Quotes are free - give Dean a call.");
  });

  it("emits everything it was given", async () => {
    const out = await collect(plainDashStream(chunks("Saturday ", "hours are ", "8am to 12pm.")));
    expect(out).toBe("Saturday hours are 8am to 12pm.");
  });

  it("flushes a trailing dash at the end of the stream", async () => {
    const out = await collect(plainDashStream(chunks("call us —")));
    expect(out.trimEnd()).toBe("call us -");
  });
});

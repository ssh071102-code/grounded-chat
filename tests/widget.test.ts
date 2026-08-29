import { describe, expect, it } from "vitest";
import { embedCsp, frameAncestors, originFor, parseFrameAncestors } from "@/lib/widget";

describe("originFor", () => {
  it("reads a bare host as an https origin", () => {
    expect(originFor("example.com")).toBe("https://example.com");
  });

  it("keeps the port that was configured", () => {
    // Dropping :8443 would move authority to :443. Controlling one does not
    // imply controlling the other.
    expect(originFor("https://example.com:8443")).toBe("https://example.com:8443");
  });

  it("accepts an origin with or without the trailing slash, and lowercases", () => {
    expect(originFor("HTTPS://Example.com")).toBe("https://example.com");
    expect(originFor("https://example.com/")).toBe("https://example.com");
  });

  it("refuses a value carrying anything an origin does not have", () => {
    // `URL` would quietly discard all of these, and the value would then
    // authorise something other than what the operator sees when reading it.
    expect(originFor("https://example.com/contact/")).toBeNull();
    expect(originFor("https://example.com?x=1")).toBeNull();
    expect(originFor("https://example.com#x")).toBeNull();
  });

  it("refuses credentials, which hide the real host in plain sight", () => {
    // The origin here is attacker.example; the eye reads trusted.example.
    expect(originFor("https://trusted.example@attacker.example")).toBeNull();
  });

  it("refuses public plaintext http", () => {
    // An http origin's content can be changed in transit, and that origin
    // would be authorised to spend the deployment's model budget.
    expect(originFor("http://public.example")).toBeNull();
    expect(originFor("http://public.example", { allowLoopback: true })).toBeNull();
  });

  it("allows http only on loopback, and only when asked", () => {
    expect(originFor("http://localhost:3000", { allowLoopback: true })).toBe(
      "http://localhost:3000",
    );
    expect(originFor("http://localhost:3000")).toBeNull();
  });

  it("refuses whitespace rather than trimming it away", () => {
    // A stray space in a CSP header value reads as a second allowed origin, and
    // `URL` deletes embedded tabs and newlines instead of failing: "example.com"
    // plus a newline plus "x" parses as the host example.comx.
    expect(originFor("example.com https://evil.test")).toBeNull();
    expect(originFor("example.com; frame-ancestors *")).toBeNull();
    expect(originFor(" example.com")).toBeNull();
    expect(originFor("example.com ")).toBeNull();
    expect(originFor("localhost")).toBeNull();
    expect(originFor("")).toBeNull();
  });
});

describe("parseFrameAncestors", () => {
  it("takes full origins only", () => {
    expect(parseFrameAncestors("https://example.com http://localhost:3000")).toEqual([
      "https://example.com",
      "http://localhost:3000",
    ]);
  });

  it("drops a bare host rather than assuming https", () => {
    // Silently upgrading "example.com" would authorise something the person
    // editing the variable never typed.
    expect(parseFrameAncestors("example.com")).toEqual([]);
  });

  it("does not let the loopback allowance admit public http", () => {
    expect(parseFrameAncestors("http://public.example")).toEqual([]);
  });

  it("drops anything that is not an origin", () => {
    expect(parseFrameAncestors("* https://ok.test/path javascript:x")).toEqual([]);
  });

  it("never repeats an origin", () => {
    const out = parseFrameAncestors("https://example.com, https://example.com/");
    expect(out).toEqual(["https://example.com"]);
  });

  it("is empty when unset", () => {
    expect(parseFrameAncestors(undefined)).toEqual([]);
  });
});

describe("frameAncestors", () => {
  it("refuses framing outright when nothing is configured", () => {
    // Not a wildcard. Serving the assistant to whoever asked, on a key you pay
    // for, is the failure worth defaulting against.
    expect(frameAncestors(undefined)).toBe("'none'");
    expect(frameAncestors("")).toBe("'none'");
    expect(frameAncestors("not-an-origin")).toBe("'none'");
  });

  it("lists what was configured", () => {
    expect(frameAncestors("https://example.com https://www.example.com")).toBe(
      "https://example.com https://www.example.com",
    );
  });

  it("does not add the www sibling by itself", () => {
    // example.com and www.example.com are different origins that can have
    // different DNS records and different owners; a dangling www record would
    // otherwise be enough to take the widget.
    expect(frameAncestors("https://example.com")).toBe("https://example.com");
  });
});

describe("embedCsp", () => {
  it("governs framing and nothing else", () => {
    expect(embedCsp("https://example.com")).toBe("frame-ancestors https://example.com");
  });
});

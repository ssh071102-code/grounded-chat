import { describe, expect, it } from "vitest";
import { resolveRetrieval } from "@/lib/config";

const env = (vars: Record<string, string>) =>
  vars as unknown as NodeJS.ProcessEnv;
import { CLIENT_DEFAULT_K, CLIENT_MAX_K } from "@/lib/retrieval-defaults";

describe("the window the widget offers and the window the server honours", () => {
  // Measured on the deployed demo: the slider ran to 25 while the route
  // clamped at 10, because each side carried its own fallback for the same
  // environment variable and neither was set. Dragging to 25 showed 25 and
  // returned 10.
  it("agree on the maximum when nothing is configured", () => {
    expect(resolveRetrieval(env({})).maxK).toBe(CLIENT_MAX_K);
  });

  it("agree on the default when nothing is configured", () => {
    expect(resolveRetrieval(env({})).defaultK).toBe(CLIENT_DEFAULT_K);
  });

  it("agree when the deployment configures them", () => {
    const resolved = resolveRetrieval(env({ NEXT_PUBLIC_MAX_K: "8", NEXT_PUBLIC_DEFAULT_K: "4" }));
    expect(resolved.maxK).toBe(8);
    expect(resolved.defaultK).toBe(4);
  });

  it("never offers a default larger than the maximum", () => {
    expect(
      resolveRetrieval(env({ NEXT_PUBLIC_MAX_K: "3", NEXT_PUBLIC_DEFAULT_K: "9" })).defaultK,
    ).toBe(3);
  });
});

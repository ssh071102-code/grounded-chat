import { AnthropicLLM } from "./llm/anthropic";
import { MockLLM } from "./llm/mock";
import type { LLMClient } from "./llm/types";

export type ChatMode = "anthropic" | "mock" | "retrieval-only";

export const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Mode resolution:
 * - ANTHROPIC_API_KEY set        -> real generated answers (streamed)
 * - LLM_MODE=mock (no key)       -> offline demo of the full answer+verifier path
 * - neither                      -> retrieval-only (top passages with scores)
 */
export function resolveMode(env: NodeJS.ProcessEnv = process.env): ChatMode {
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.LLM_MODE === "mock") return "mock";
  return "retrieval-only";
}

export function createLLM(
  mode: ChatMode,
  env: NodeJS.ProcessEnv = process.env,
): LLMClient | null {
  switch (mode) {
    case "anthropic":
      return new AnthropicLLM(
        env.ANTHROPIC_API_KEY ?? "",
        env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      );
    case "mock":
      return new MockLLM(12);
    case "retrieval-only":
      return null;
  }
}

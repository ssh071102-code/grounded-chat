import { AnthropicLLM } from "./llm/anthropic";
import {
  DEFAULT_CANDIDATES,
  DEFAULT_MAX_PER_DOC,
  type RetrieveMode,
} from "./retrieve";
import { CLIENT_DEFAULT_K, CLIENT_MAX_K } from "./retrieval-defaults";
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
  business?: string,
): LLMClient | null {
  switch (mode) {
    case "anthropic":
      return new AnthropicLLM(
        env.ANTHROPIC_API_KEY ?? "",
        env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        business || env.BUSINESS_NAME || undefined,
      );
    case "mock":
      return new MockLLM(12);
    case "retrieval-only":
      return null;
  }
}

export interface RetrievalConfig {
  mode: RetrieveMode;
  candidates: number;
  maxPerDoc: number;
  defaultK: number;
  maxK: number;
}

function intFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/**
 * Retrieval settings, all overridable per deployment. Each deployment indexes
 * a different corpus, and the right window size for a five-page
 * trade site is not the right one for a fifty-page clinic.
 *
 * `RETRIEVAL_MODE=hybrid` turns on BM25 fusion. It is off by default because
 * it measured worse than plain dense retrieval on the corpus this was built
 * against; see the note on retrieve().
 */
export function resolveRetrieval(
  env: NodeJS.ProcessEnv = process.env,
): RetrievalConfig {
  const maxK = intFromEnv(env.NEXT_PUBLIC_MAX_K, CLIENT_MAX_K);
  return {
    mode: env.RETRIEVAL_MODE === "hybrid" ? "hybrid" : "dense",
    candidates: intFromEnv(env.RETRIEVAL_CANDIDATES, DEFAULT_CANDIDATES),
    maxPerDoc: intFromEnv(env.RETRIEVAL_MAX_PER_DOC, DEFAULT_MAX_PER_DOC),
    defaultK: Math.min(intFromEnv(env.NEXT_PUBLIC_DEFAULT_K, CLIENT_DEFAULT_K), maxK),
    maxK,
  };
}

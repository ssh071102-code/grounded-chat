import type { ChatTurn } from "../conversation";

/** A retrieved passage handed to the LLM, numbered for citation markers. */
export interface SourcePassage {
  /** 1-based citation number used as [n] in the answer. */
  index: number;
  id: string;
  docId: string;
  title: string;
  text: string;
  /** Cosine similarity against the question. */
  score: number;
  /** Which retrievers surfaced this passage (dense, lexical, or both). */
  from: ("dense" | "lexical")[];
}

/**
 * Answer generator. The Anthropic client and the mock implement the same
 * interface, so the chat pipeline (and its tests) are provider-agnostic.
 */
export interface LLMClient {
  readonly name: "anthropic" | "mock";
  /**
   * `history` is the prior turns of this conversation, oldest first. The server
   * keeps no session, so it arrives from the client on every request.
   */
  streamAnswer(
    question: string,
    sources: SourcePassage[],
    history?: ChatTurn[],
  ): AsyncIterable<string>;
}

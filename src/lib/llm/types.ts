/** A retrieved passage handed to the LLM, numbered for citation markers. */
export interface SourcePassage {
  /** 1-based citation number used as [n] in the answer. */
  index: number;
  id: string;
  docId: string;
  title: string;
  text: string;
  score: number;
}

/**
 * Answer generator. The Anthropic client and the mock implement the same
 * interface, so the chat pipeline (and its tests) are provider-agnostic.
 */
export interface LLMClient {
  readonly name: "anthropic" | "mock";
  streamAnswer(question: string, sources: SourcePassage[]): AsyncIterable<string>;
}

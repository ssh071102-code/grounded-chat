import { splitSentences } from "../chunk";
import type { LLMClient, SourcePassage } from "./types";

const UNSUPPORTED_TAIL =
  "As a bonus fact, the author reportedly wrote this while sailing a hot-air balloon over the Pacific Ocean.";

/**
 * Offline mock LLM used in tests and in LLM_MODE=mock demo mode.
 *
 * It produces an extractive answer: the leading sentence of the top two
 * sources, each with a correct citation marker - and then deliberately
 * appends one fabricated, unsupported claim. That makes the mock a live
 * demonstration of the verifier: the extracted sentences score as supported,
 * the fabricated tail gets flagged. The UI labels this mode clearly.
 */
export class MockLLM implements LLMClient {
  readonly name = "mock" as const;

  constructor(private readonly delayMs = 0) {}

  async *streamAnswer(
    _question: string,
    sources: SourcePassage[],
  ): AsyncIterable<string> {
    const parts: string[] = [];
    for (const source of sources.slice(0, 2)) {
      const sentence = splitSentences(source.text)[0] ?? source.text.slice(0, 200);
      parts.push(`${sentence.replace(/[.!?]+$/, "")} [${source.index}].`);
    }
    parts.push(UNSUPPORTED_TAIL);
    const answer = parts.join(" ");

    for (const token of answer.match(/\S+\s*/g) ?? []) {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      yield token;
    }
  }
}

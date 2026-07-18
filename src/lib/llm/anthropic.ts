import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, SourcePassage } from "./types";

const SYSTEM_PROMPT = `You answer questions using ONLY the numbered source passages provided by the user.

Rules:
- Every factual claim must come from the sources. Cite with bracketed markers like [1] or [2][3] placed immediately after the claim they support.
- If the sources do not contain the answer, say so plainly. Never fill gaps from general knowledge.
- Keep answers to 2-6 sentences unless the question clearly needs more.
- Plain prose only: no headings, no bullet lists, no preamble.`;

export class AnthropicLLM implements LLMClient {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async *streamAnswer(
    question: string,
    sources: SourcePassage[],
  ): AsyncIterable<string> {
    const context = sources
      .map((s) => `[${s.index}] ${s.title}\n${s.text}`)
      .join("\n\n");

    // Some gateways overwrite the system param; when routed through one
    // (ANTHROPIC_BASE_URL set), carry the rules inside the user turn instead.
    const viaGateway = !!process.env.ANTHROPIC_BASE_URL;
    const userContent = viaGateway
      ? `${SYSTEM_PROMPT}\n\nSources:\n\n${context}\n\nQuestion: ${question}`
      : `Sources:\n\n${context}\n\nQuestion: ${question}`;

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 1024,
      ...(viaGateway ? {} : { system: SYSTEM_PROMPT }),
      messages: [{ role: "user", content: userContent }],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }
}

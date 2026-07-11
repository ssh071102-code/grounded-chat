import type { Embedder } from "./embed/types";
import type { LLMClient, SourcePassage } from "./llm/types";
import type { VectorStore } from "./store/types";
import { VERIFY_THRESHOLD, verifyAnswer } from "./verify";

export interface ChatDeps {
  store: VectorStore;
  embedder: Embedder;
  /** null = retrieval-only mode (no API key, no mock). */
  llm: LLMClient | null;
  verifyThreshold?: number;
}

const DEFAULT_K = 5;
const MAX_K = 10;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toSources(
  scored: Awaited<ReturnType<VectorStore["query"]>>,
): SourcePassage[] {
  return scored.map((chunk, i) => ({
    index: i + 1,
    id: chunk.id,
    docId: chunk.docId,
    title: chunk.title,
    text: chunk.text,
    score: Number(chunk.score.toFixed(4)),
  }));
}

/**
 * Chat pipeline, framework-agnostic for testability. The route handler wires
 * in real dependencies; tests inject fakes.
 *
 * Responses:
 * - retrieval-only mode: a single JSON body with the top passages.
 * - anthropic/mock mode: an SSE stream of `meta` (sources), `delta` (answer
 *   tokens), `verification` (per-sentence groundedness report), `done`.
 */
export async function handleChat(
  deps: ChatDeps,
  body: unknown,
): Promise<Response> {
  const question =
    typeof body === "object" && body !== null && "question" in body
      ? String((body as { question: unknown }).question ?? "").trim()
      : "";
  if (!question) {
    return json(400, { error: "body must be JSON: { question: string, k?: number }" });
  }
  const rawK =
    typeof body === "object" && body !== null && "k" in body
      ? Number((body as { k: unknown }).k)
      : DEFAULT_K;
  const k = Math.min(Math.max(Number.isFinite(rawK) ? Math.trunc(rawK) : DEFAULT_K, 1), MAX_K);

  const { store, embedder, llm } = deps;
  if ((await store.count()) === 0) {
    return json(409, {
      error: "index not built",
      hint: "run: npm run ingest -- corpus",
    });
  }

  const [queryVector] = await embedder.embed([question]);
  const scored = await store.query(queryVector!, k);
  const sources = toSources(scored);

  if (!llm) {
    return json(200, { mode: "retrieval-only", question, sources });
  }

  const threshold = deps.verifyThreshold ?? VERIFY_THRESHOLD;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        send("meta", { mode: llm.name, question, sources });
        let answer = "";
        for await (const delta of llm.streamAnswer(question, sources)) {
          answer += delta;
          send("delta", { text: delta });
        }
        const report = await verifyAnswer(answer, scored, embedder, threshold);
        send("verification", report);
        send("done", {});
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "stream failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

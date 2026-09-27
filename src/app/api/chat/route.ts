import { handleChat, type ChatDeps } from "@/lib/chat";
import { createLLM, resolveMode } from "@/lib/config";
import { LocalEmbedder } from "@/lib/embed/local";
import { createRateLimiter, guard, type RateLimiter } from "@/lib/rate-limit";
import { createStore } from "@/lib/store/factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let deps: ChatDeps | null = null;
let limiter: RateLimiter | null = null;

/**
 * Per-address ceiling. This endpoint is a public POST by design and every call
 * spends model tokens on the deployment's key, so an unbounded endpoint is an
 * unbounded bill. Generous enough that a visitor with real questions never
 * meets it; low enough that a loop stops being free.
 */
function getLimiter(): RateLimiter {
  if (!limiter) {
    // 30 in five minutes: a visitor with real questions asks a handful, and a
    // scripted smoke test of twenty questions in a burst also fits. A loop
    // does not.
    const limit = Number(process.env.RATE_LIMIT_PER_WINDOW) || 30;
    const windowMs = (Number(process.env.RATE_LIMIT_WINDOW_SECONDS) || 300) * 1000;
    limiter = createRateLimiter({ limit, windowMs });
  }
  return limiter;
}

function getDeps(): ChatDeps {
  if (!deps) {
    deps = {
      store: createStore(),
      embedder: new LocalEmbedder(),
      llm: createLLM(resolveMode()),
    };
  }
  return deps;
}

export async function POST(request: Request): Promise<Response> {
  const limited = guard(request, getLimiter());
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  return handleChat(getDeps(), body);
}

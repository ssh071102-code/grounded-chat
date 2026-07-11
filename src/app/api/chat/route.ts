import { handleChat, type ChatDeps } from "@/lib/chat";
import { createLLM, resolveMode } from "@/lib/config";
import { LocalEmbedder } from "@/lib/embed/local";
import { createStore } from "@/lib/store/factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let deps: ChatDeps | null = null;

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
  const body = await request.json().catch(() => null);
  return handleChat(getDeps(), body);
}

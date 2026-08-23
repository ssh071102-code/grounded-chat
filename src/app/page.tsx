import { Chat } from "@/components/Chat";
import { DEFAULT_MODEL, resolveMode } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  const mode = resolveMode();
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  return <Chat mode={mode} model={model} />;
}

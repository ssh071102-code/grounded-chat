import { promises as fs } from "node:fs";
import path from "node:path";
import { chunkDocument, DEFAULT_CHUNKING } from "../src/lib/chunk";
import { LocalEmbedder } from "../src/lib/embed/local";
import { createStore } from "../src/lib/store/factory";
import type { EmbeddedChunk } from "../src/lib/store/types";
import type { Chunk, IndexMeta } from "../src/lib/types";

/**
 * Ingestion CLI:  npm run ingest -- <dir>
 *
 * Reads every .md/.txt file in <dir>, chunks it sentence-aware with overlap,
 * embeds the chunks locally (MiniLM, no API key), and rebuilds the vector
 * index. Writes to the file store by default, or pgvector if PGVECTOR_URL set.
 */
async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: npm run ingest -- <corpus-dir>");
    process.exit(1);
  }
  const root = path.resolve(dir);

  // Metadata files that live alongside a corpus but are not corpus content.
  const EXCLUDE = new Set(["sources.md", "readme.md", "license.md"]);
  const entries = (await fs.readdir(root, { withFileTypes: true }))
    .filter(
      (e) =>
        e.isFile() &&
        /\.(md|txt)$/i.test(e.name) &&
        !EXCLUDE.has(e.name.toLowerCase()),
    )
    .map((e) => e.name)
    .sort();
  if (entries.length === 0) {
    console.error(`no .md/.txt files found in ${root}`);
    process.exit(1);
  }

  const embedder = new LocalEmbedder();
  const store = createStore();
  const started = Date.now();

  const allChunks: Chunk[] = [];
  const documents: IndexMeta["documents"] = [];
  for (const name of entries) {
    const text = await fs.readFile(path.join(root, name), "utf8");
    const title = deriveTitle(name, text);
    const chunks = chunkDocument(name, title, text);
    allChunks.push(...chunks);
    documents.push({ docId: name, title, chunks: chunks.length });
    console.log(`  ${name}: ${chunks.length} chunks (${title})`);
  }

  console.log(`embedding ${allChunks.length} chunks with ${embedder.id} ...`);
  const vectors = await embedder.embed(allChunks.map((c) => c.text));
  const records: EmbeddedChunk[] = allChunks.map((chunk, i) => ({
    chunk,
    vector: vectors[i]!,
  }));

  const meta: IndexMeta = {
    embedder: embedder.id,
    dim: embedder.dim,
    chunking: DEFAULT_CHUNKING,
    documents,
    createdAt: new Date().toISOString(),
  };

  await store.rebuild(meta, records);
  await store.close();

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `indexed ${allChunks.length} chunks from ${entries.length} documents ` +
      `into the ${store.kind} store in ${seconds}s`,
  );
}

/** Use the first non-empty line as a title if it looks like a heading. */
function deriveTitle(fileName: string, text: string): string {
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (firstLine && firstLine.length <= 80) {
    return firstLine.replace(/^#+\s*/, "").replace(/\.$/, "");
  }
  return fileName.replace(/\.(md|txt)$/i, "").replace(/[-_]/g, " ");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

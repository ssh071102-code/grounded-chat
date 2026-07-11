import { LocalEmbedder } from "../src/lib/embed/local";
import { createStore } from "../src/lib/store/factory";
import type { VectorStore } from "../src/lib/store/types";
import { GOLDEN_SET, type GoldenItem } from "./golden";

/**
 * Retrieval eval:  npm run eval [-- --k 5]
 *
 * For each golden question, resolve its anchor strings to ground-truth chunk
 * ids, retrieve the top-k chunks, and score:
 *   - recall@k : fraction of questions where a relevant chunk appears in top-k
 *   - MRR      : mean reciprocal rank of the first relevant chunk
 *
 * Numbers printed here are pasted verbatim into the README.
 */
function resolveRelevant(
  item: GoldenItem,
  allTexts: Map<string, string>,
): Set<string> {
  const ids = new Set<string>();
  for (const anchor of item.relevant) {
    const needle = anchor.toLowerCase();
    let matched = 0;
    for (const [id, text] of allTexts) {
      if (text.toLowerCase().includes(needle)) {
        ids.add(id);
        matched++;
      }
    }
    if (matched === 0) {
      throw new Error(
        `golden item "${item.id}": anchor not found in corpus: ${anchor}`,
      );
    }
  }
  return ids;
}

/**
 * Load every chunk's text so anchor strings can be resolved to chunk ids.
 * A single query at k = corpus size returns all rows (ordering irrelevant
 * here - we only need the id -> text mapping).
 */
async function loadAllTexts(
  store: VectorStore,
  embedder: LocalEmbedder,
): Promise<Map<string, string>> {
  const total = await store.count();
  const [probe] = await embedder.embed(["probe"]);
  const rows = await store.query(probe!, total);
  return new Map(rows.map((row) => [row.id, row.text]));
}

async function main() {
  const kArg = process.argv.indexOf("--k");
  const k = kArg !== -1 ? Number(process.argv[kArg + 1]) : 5;

  const store = createStore();
  const embedder = new LocalEmbedder();
  if ((await store.count()) === 0) {
    console.error("index not built - run: npm run ingest -- corpus");
    process.exit(1);
  }

  const allTexts = await loadAllTexts(store, embedder);

  let recallHits = 0;
  let mrrSum = 0;
  const rows: { id: string; rank: number | null }[] = [];

  const questionVectors = await embedder.embed(GOLDEN_SET.map((g) => g.question));

  for (let i = 0; i < GOLDEN_SET.length; i++) {
    const item = GOLDEN_SET[i]!;
    const relevant = resolveRelevant(item, allTexts);
    const results = await store.query(questionVectors[i]!, k);

    let rank: number | null = null;
    for (let r = 0; r < results.length; r++) {
      if (relevant.has(results[r]!.id)) {
        rank = r + 1;
        break;
      }
    }
    if (rank !== null) {
      recallHits++;
      mrrSum += 1 / rank;
    }
    rows.push({ id: item.id, rank });
  }

  await store.close();

  const n = GOLDEN_SET.length;
  const recall = recallHits / n;
  const mrr = mrrSum / n;

  console.log(`\nRetrieval eval over ${n} golden questions (k=${k})`);
  console.log(`embedder: ${embedder.id}\n`);
  console.log("  question                     rank");
  console.log("  " + "-".repeat(40));
  for (const row of rows) {
    console.log(
      `  ${row.id.padEnd(28)} ${row.rank === null ? "miss" : `#${row.rank}`}`,
    );
  }
  console.log("  " + "-".repeat(40));
  console.log(`  recall@${k}: ${recall.toFixed(3)}   (${recallHits}/${n})`);
  console.log(`  MRR:       ${mrr.toFixed(3)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

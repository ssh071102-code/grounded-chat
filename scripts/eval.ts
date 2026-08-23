import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalEmbedder } from "../src/lib/embed/local";
import { retrieve, type RetrieveMode } from "../src/lib/retrieve";
import { verifyAnswer } from "../src/lib/verify";
import { createStore } from "../src/lib/store/factory";
import type { VectorStore } from "../src/lib/store/types";
import { GOLDEN_SET as BUNDLED_GOLDEN, type GoldenItem } from "./golden";

/**
 * Retrieval eval:
 *   npm run eval [-- --k 5] [-- --mode hybrid|dense] [-- --max-per-doc 2]
 *                [-- --golden ./scripts/golden-other.ts]
 *
 * Scoring goes through the same `retrieve()` the chat route calls. An eval
 * that builds its own retrieval path measures something the product never
 * runs, so `--mode` switches the real pipeline rather than a copy of it.
 *
 * `--golden` loads another module exporting `GOLDEN_SET`, so the same harness
 * can score a different corpus. Numbers measured on the bundled public-domain
 * prose say little about how retrieval behaves on, for example, a trade
 * business site, where pages are short and dense with prices and suburb names.
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

/** Load every chunk's text so anchor strings can be resolved to chunk ids. */
async function loadAllTexts(store: VectorStore): Promise<Map<string, string>> {
  const rows = await store.scan();
  return new Map(rows.map((row) => [row.id, row.text]));
}

async function loadGolden(): Promise<GoldenItem[]> {
  const i = process.argv.indexOf("--golden");
  if (i === -1) return BUNDLED_GOLDEN;
  const spec = process.argv[i + 1];
  if (!spec) throw new Error("--golden needs a module path");
  const mod = (await import(pathToFileURL(resolve(spec)).href)) as {
    GOLDEN_SET?: GoldenItem[];
  };
  if (!mod.GOLDEN_SET) throw new Error(`${spec} does not export GOLDEN_SET`);
  return mod.GOLDEN_SET;
}

/**
 * Threshold calibration:  npm run eval -- --calibrate ./scripts/calibration.ts
 *
 * Sweeps the groundedness threshold over a labelled set and reports what each
 * value costs in each direction: grounded sentences wrongly flagged, and
 * fabricated ones wrongly passed. The threshold governs only sentences with no
 * checkable specifics; anything carrying a number, a time or a proper noun is
 * decided by whether that specific appears in the passages, whatever the score.
 */
async function calibrate(spec: string) {
  const mod = (await import(pathToFileURL(resolve(spec)).href)) as {
    GROUNDED?: string[];
    FABRICATED?: string[];
  };
  const grounded = mod.GROUNDED ?? [];
  const fabricated = mod.FABRICATED ?? [];
  if (grounded.length === 0 || fabricated.length === 0) {
    throw new Error(`${spec} must export GROUNDED and FABRICATED`);
  }

  const store = createStore();
  const embedder = new LocalEmbedder();
  const chunks = await store.scan();
  if (chunks.length === 0) {
    console.error("index not built - run: npm run ingest -- <corpus dir>");
    process.exit(1);
  }

  const score = async (sentence: string) =>
    (await verifyAnswer(sentence, chunks, embedder, 1.1)).verdicts[0]!;
  const groundedVerdicts: Awaited<ReturnType<typeof score>>[] = [];
  for (const sentence of grounded) groundedVerdicts.push(await score(sentence));
  const fabricatedVerdicts: Awaited<ReturnType<typeof score>>[] = [];
  for (const sentence of fabricated) fabricatedVerdicts.push(await score(sentence));

  console.log(
    `\nThreshold calibration over ${grounded.length} grounded and ` +
      `${fabricated.length} fabricated sentences`,
  );
  console.log(`embedder: ${embedder.id}, ${chunks.length} chunks\n`);
  console.log("  threshold   good flagged   fabrications passed");
  console.log("  " + "-".repeat(48));
  for (let t = 0.3; t <= 0.8001; t += 0.05) {
    const falseFlags = groundedVerdicts.filter(
      (v) => v.status !== "unverifiable" && !v.specifics && v.score < t,
    ).length;
    const misses = fabricatedVerdicts.filter(
      (v) => v.status === "unverifiable" || (!v.specifics && v.score >= t),
    ).length;
    console.log(
      `  ${t.toFixed(2).padStart(8)}   ${String(falseFlags).padStart(11)}   ` +
        `${String(misses).padStart(19)}`,
    );
  }
  const DEFAULT_T = 0.55;
  console.log("\n  at the shipped threshold of " + DEFAULT_T + ":");
  grounded.forEach((sentence, i) => {
    const v = groundedVerdicts[i]!;
    if (!v.specifics && v.score < DEFAULT_T) {
      console.log("    good, flagged   " + v.score.toFixed(3) + "  " + sentence);
    }
  });
  fabricated.forEach((sentence, i) => {
    const v = fabricatedVerdicts[i]!;
    if (!v.specifics && v.score >= DEFAULT_T) {
      console.log("    made up, passed " + v.score.toFixed(3) + "  " + sentence);
    }
  });
  console.log("\n  sentences decided by a literal specific, whatever the threshold:");
  const bySpecific = [...groundedVerdicts, ...fabricatedVerdicts].filter((v) => v.specifics);
  console.log(`    ${bySpecific.length} of ${groundedVerdicts.length + fabricatedVerdicts.length}`);
  await store.close();
}

async function main() {
  const calArg = process.argv.indexOf("--calibrate");
  if (calArg !== -1) {
    const spec = process.argv[calArg + 1];
    if (!spec) throw new Error("--calibrate needs a module path");
    await calibrate(spec);
    return;
  }

  const kArg = process.argv.indexOf("--k");
  const k = kArg !== -1 ? Number(process.argv[kArg + 1]) : 5;
  const modeArg = process.argv.indexOf("--mode");
  const mode: RetrieveMode =
    modeArg !== -1 && process.argv[modeArg + 1] === "dense" ? "dense" : "hybrid";
  const mpdArg = process.argv.indexOf("--max-per-doc");
  const maxPerDoc = mpdArg !== -1 ? Number(process.argv[mpdArg + 1]) : undefined;
  const GOLDEN_SET = await loadGolden();

  const store = createStore();
  const embedder = new LocalEmbedder();
  if ((await store.count()) === 0) {
    console.error("index not built - run: npm run ingest -- corpus");
    process.exit(1);
  }

  const allTexts = await loadAllTexts(store);

  let recallHits = 0;
  let mrrSum = 0;
  const rows: { id: string; rank: number | null }[] = [];

  for (let i = 0; i < GOLDEN_SET.length; i++) {
    const item = GOLDEN_SET[i]!;
    const relevant = resolveRelevant(item, allTexts);
    const results = await retrieve({ store, embedder }, item.question, {
      k,
      mode,
      maxPerDoc,
    });

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
  console.log(`retrieval: ${mode}${mode === "hybrid" ? ` (max ${maxPerDoc ?? 2}/doc)` : ""}`);
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

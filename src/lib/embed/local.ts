import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { Embedder } from "./types";

/**
 * Local sentence embeddings via all-MiniLM-L6-v2 (quantized ONNX, ~23 MB).
 * The model is downloaded once on first use and cached under .cache/models;
 * after that, indexing and search run fully offline with no API key.
 */
export const LOCAL_EMBEDDER_ID = "xenova/all-MiniLM-L6-v2#q8";
const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;
const BATCH_SIZE = 16;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    env.cacheDir = path.join(process.cwd(), ".cache", "models");
    // Standard HuggingFace override, useful behind corporate mirrors.
    if (process.env.HF_ENDPOINT) {
      env.remoteHost = process.env.HF_ENDPOINT;
    }
    extractorPromise = pipeline("feature-extraction", MODEL, { dtype: "q8" });
  }
  return extractorPromise;
}

export class LocalEmbedder implements Embedder {
  readonly id = LOCAL_EMBEDDER_ID;
  readonly dim = DIM;

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extractor = await getExtractor();
    const vectors: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const output = await extractor(batch, { pooling: "mean", normalize: true });
      const data = output.data as Float32Array;
      for (let j = 0; j < batch.length; j++) {
        vectors.push(new Float32Array(data.subarray(j * DIM, (j + 1) * DIM)));
      }
      output.dispose();
    }
    return vectors;
  }
}

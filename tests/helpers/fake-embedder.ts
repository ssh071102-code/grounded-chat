import type { Embedder } from "@/lib/embed/types";

/**
 * Deterministic offline embedder for unit tests: a hashed bag-of-words.
 * Texts sharing vocabulary get high cosine similarity; disjoint texts score
 * near zero. No model download, no network, fully reproducible.
 */
export class FakeEmbedder implements Embedder {
  readonly id = "fake-hashed-bow";
  readonly dim = 64;

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.vectorFor(text));
  }

  private vectorFor(text: string): Float32Array {
    const vector = new Float32Array(this.dim);
    const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
    for (const word of words) {
      let hash = 2166136261;
      for (let i = 0; i < word.length; i++) {
        hash ^= word.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const bucket = Math.abs(hash) % this.dim;
      vector[bucket] = vector[bucket]! + 1;
    }
    let norm = 0;
    for (const v of vector) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dim; i++) vector[i] = vector[i]! / norm;
    }
    return vector;
  }
}

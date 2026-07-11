# grounded-chat

**A full-stack RAG chat app that refuses to make things up — streaming answers with inline citations and a groundedness verifier that flags any sentence the sources don't support.**

Most RAG demos retrieve some passages, ask an LLM to "answer using the context," and trust the result. grounded-chat adds the step that actually matters for a demanding user: after the answer is generated, every sentence is scored against the retrieved passages and anything the sources don't support is **visibly flagged in the UI**. And because the whole retrieval pipeline runs on local embeddings, you can clone this repo and watch it work in 60 seconds **with zero API keys**.

![Answer with inline citations and a flagged unsupported sentence](docs/screenshots/gc-03-verifier.png)

*Mock-model mode: the two extracted sentences are cited `[1] [2]` and marked supported; the planted "hot-air balloon" fabrication is flagged `unsupported`. The readout shows `2 supported / 1 flagged` from the embedding-similarity verifier at threshold `t=0.55`.*

---

## Quick start

### No-key path (recommended first — fully offline)

No API key, no database, no Docker. Local MiniLM embeddings power indexing and search.

```bash
npm install
npm run ingest -- corpus        # builds the vector index (downloads the ~23 MB embed model once)
npm run dev                     # http://localhost:3000
```

With no `ANTHROPIC_API_KEY` set, the chat endpoint returns **retrieval-only** results — the top passages ranked by cosine similarity, with scores — so you see the full retrieval pipeline work end to end. Want to see the answer + verifier pipeline without a key? Run the bundled mock model:

```bash
LLM_MODE=mock npm run dev       # scripted answer that plants one fabrication for the verifier to catch
```

### With-key path (generated, cited, verified answers)

```bash
cp .env.example .env            # then set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL)
npm run ingest -- corpus
npm run dev
```

Now the endpoint streams a generated answer with inline `[n]` citations, then runs the groundedness verifier over it. The model defaults to `claude-opus-4-8`; override with `ANTHROPIC_MODEL`.

---

## What it does

| | |
|---|---|
| **Local-first retrieval** | Sentence-aware chunking → local MiniLM embeddings → cosine search. No API key needed to index or search. |
| **Inline citations** | Answers cite retrieved passages as `[1] [2]`; citation chips open a source panel showing the exact chunk. |
| **Groundedness verifier** | Each answer sentence is scored against the retrieved chunks; sentences below threshold are flagged `unsupported` in the UI. |
| **No-key mode** | With no key, the endpoint returns ranked passages + scores — the whole pipeline is demonstrable offline. |
| **Pluggable store** | File-based index by default; a pgvector adapter (docker-compose included) implements the same interface. |
| **Real eval** | `npm run eval` reports recall@k and MRR over a golden set (numbers below are the real output). |

---

## Architecture

```mermaid
flowchart LR
  subgraph ingest["npm run ingest -- <dir>"]
    docs[".md / .txt files"] --> chunk["sentence-aware\nchunking + overlap"]
    chunk --> emb1["local MiniLM\nembeddings"]
    emb1 --> store[("vector store\nfile | pgvector")]
  end

  subgraph query["POST /api/chat"]
    q["question"] --> emb2["local MiniLM\nembedding"]
    emb2 --> knn["top-k cosine search"]
    store --> knn
    knn -->|"no API key"| ro["retrieval-only\nJSON: passages + scores"]
    knn -->|"API key set"| gen["Anthropic SDK\nstreamed answer + [n] citations"]
    gen --> verify["groundedness verifier\n(embedding similarity per sentence)"]
    verify --> sse["SSE: meta - delta - verification - done"]
  end
```

The retrieval path is identical in both modes — only the final generation + verification step is gated on the API key. Everything except answer generation runs locally.

**Layout**

```
corpus/                 bundled public-domain sample corpus (+ SOURCES.md provenance)
scripts/
  ingest.ts             npm run ingest -- <dir>
  eval.ts, golden.ts    npm run eval  (golden set + recall@k / MRR)
src/lib/
  chunk.ts              sentence-aware chunking
  embed/local.ts        MiniLM embedder (Transformers.js, local)
  store/                VectorStore interface + file and pgvector adapters
  verify.ts             groundedness verifier
  llm/                  Anthropic + mock LLM behind one interface
  chat.ts               framework-agnostic chat pipeline (unit-tested)
src/app/api/chat/route.ts   Next.js route handler (streaming)
src/components/Chat.tsx      streaming chat UI
tests/                  vitest: chunking, store contract, verifier, chat route
```

---

## Real terminal transcript

Ingestion and a retrieval-only query, captured from this repo (no API key):

```console
$ npm run ingest -- corpus
  darwin-origin-of-species.txt: 103 chunks (INTRODUCTION)
  einstein-relativity.txt: 84 chunks (PART I: THE SPECIAL THEORY OF RELATIVITY)
  strunk-elements-of-style.txt: 67 chunks (I. INTRODUCTORY)
embedding 254 chunks with xenova/all-MiniLM-L6-v2#q8 ...
indexed 254 chunks from 3 documents into the file store in 4.9s

$ curl -s -X POST localhost:3000/api/chat \
    -H 'content-type: application/json' \
    -d '{"question":"Why does Strunk recommend the active voice?","k":3}'
{
  "mode": "retrieval-only",
  "question": "Why does Strunk recommend the active voice?",
  "sources": [
    { "index": 1, "id": "strunk-elements-of-style.txt#32", "score": 0.297,
      "text": "The habitual use of the active voice makes for forcible writing. This is true not only in narrative ..." },
    { "index": 2, "id": "strunk-elements-of-style.txt#29", "score": 0.235,
      "text": "The campaign opened with a series of reverses. ..." },
    { "index": 3, "id": "strunk-elements-of-style.txt#9",  "score": 0.205,
      "text": "The clause adds, parenthetically, a statement supplementing that in the main clause. ..." }
  ]
}
```

---

## Eval — real numbers

`npm run eval` runs 15 golden question → relevant-passage pairs over the bundled corpus. Each question's anchor phrase is resolved to the ground-truth chunk(s) at eval time, the question is retrieved, and rank of the first relevant chunk is scored.

| metric | k=3 | k=5 | k=10 |
|---|---|---|---|
| **recall@k** | 0.733 (11/15) | 0.800 (12/15) | 0.867 (13/15) |
| **MRR** | 0.667 | 0.680 | 0.691 |

These are the **actual** measured numbers from `xenova/all-MiniLM-L6-v2` (quantized) on this corpus — not aspirational. Ten of fifteen questions retrieve their target passage at rank 1. The misses are honest: paraphrased questions like *"What subject does Darwin devote the first chapter to?"* and *"How should terms in a series be punctuated?"* fall outside the top-k because a 384-dimension local model has a real quality ceiling (see Limitations). Re-run it yourself:

```bash
npm run eval            # k=5
npm run eval -- --k 10
```

---

## Why a verifier (design note)

Retrieval-augmented generation reduces hallucination; it does not eliminate it. A model handed five passages can still add a fluent, plausible sentence that none of them support — and inline citations make that *worse*, because a citation next to an unsupported claim reads as evidence. The verifier exists to catch exactly that.

**How it works.** After generation, the answer is split into sentences. Each sentence and each retrieved chunk is embedded with the *same* local model used for retrieval, and the sentence's score is its maximum cosine similarity across the chunks. Sentences scoring below the threshold are flagged `unsupported`; very short sentences (below a character floor) are marked `skipped` rather than judged.

**Why this design.** It is deterministic, runs fully offline, adds no API cost, and is unit-tested with known-answer cases. It measures *lexical/semantic overlap with the sources* — a strong proxy for "is this traceable to a passage" — which is precisely the failure mode citations are supposed to guarantee against. An optional LLM-judge mode can slot in behind the same interface (and is mocked in tests).

**Threshold.** The default is `0.55`. On this corpus with MiniLM, sentences copied or closely paraphrased from a chunk score well above it, while off-topic fabrications score well below (the planted balloon sentence in mock mode lands far under). The threshold is deliberately exposed and documented rather than hidden — it is a precision/recall dial, not a constant of nature.

**Honest failure modes.** The verifier is a heuristic, not a proof of entailment:

- **Negation blindness** — *"X causes Y"* and *"X does not cause Y"* embed closely, so a contradicted claim can still score as supported. Embedding similarity does not model logical entailment.
- **False-positive flags** — aggressive paraphrase or multi-hop synthesis can dip below threshold even when genuinely grounded, flagging a good sentence.
- **Proxy, not truth** — it rewards overlap with the sources, not factual correctness. A sentence that faithfully echoes a *wrong* source passage scores as supported.

For an LLM-judge upgrade path, the same `verifyAnswer` seam swaps the embedding heuristic for a model call without touching the UI or the route.

---

## Storage adapters (file vs pgvector)

Both stores implement one `VectorStore` interface and are exercised by the **same contract test suite** (`tests/helpers/store-contract.ts`), so the adapters are provably interchangeable.

- **File store (default).** Chunk metadata in `index.json`, vectors as raw `Float32` in `vectors.bin`. Queries are an exact brute-force cosine scan over the whole matrix. This is honest about scale: it is correct and fast for corpora up to tens of thousands of chunks (the bundled corpus is 254), with no dependencies and no server. It is *not* an approximate-nearest-neighbour index — for millions of vectors you would feel the linear scan.
- **pgvector adapter.** Same interface, backed by Postgres + [pgvector](https://github.com/pgvector/pgvector) with an HNSW index and cosine distance. Use it when the corpus outgrows a single-process brute-force scan or when you want the index to live in a shared database.

```bash
docker compose up -d
export PGVECTOR_URL=postgresql://postgres:postgres@localhost:5433/grounded
npm run ingest -- corpus        # builds the index in Postgres instead of on disk
npm run dev
```

The pgvector adapter is unit-tested against the shared contract; the integration test runs only when `PGVECTOR_URL` is set (and Docker is available) and self-skips otherwise, so the default `npm test` stays fully offline. Docker was not available in the environment where this repo was built, so the pgvector suite is exercised via the shared contract but the numbers above come from the file store.

---

## Limitations

- **Local-embedding quality ceiling.** `all-MiniLM-L6-v2` is 384-dimensional and small. It is excellent for a zero-key, offline demo, but a hosted embedding model would lift recall on paraphrased queries. The eval misses are a direct, honest read of this ceiling.
- **File-store scale.** The default store does an exact linear scan. Correct and quick here; switch to the pgvector adapter before you reach millions of vectors.
- **Verifier is a heuristic.** Embedding-similarity attribution has real false positives and negation blindness (see the design note). It is a strong, cheap, offline proxy — not a guarantee of entailment or fact.
- **Single-turn, no persistence.** By design: no auth, no accounts, no chat history persistence. The scope is deliberately RAG + verification quality, not SaaS plumbing.

---

## The sample corpus

Three excerpts from clearly public-domain English works, retrieved from Project Gutenberg with its license boilerplate stripped (~160 KB total): Darwin's *On the Origin of Species* (1859), Lawson's 1920 English translation of Einstein's *Relativity*, and Strunk's *The Elements of Style* (1918). All predate 1929 and are in the US public domain; full provenance and the public-domain rationale — including why a *pre-1929* translation of the Einstein text matters — are in [`corpus/SOURCES.md`](corpus/SOURCES.md). Point `npm run ingest` at any directory of `.md`/`.txt` files to index your own.

---

## Development

```bash
npm run typecheck     # tsc --noEmit (strict)
npm run lint          # eslint
npm test              # vitest (offline: chunking, store contract, verifier, chat route)
npm run build         # next build
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push and PR.

**Tech:** Next.js (App Router) + TypeScript strict · Transformers.js (local MiniLM) · Anthropic SDK (streaming) · Postgres/pgvector · vitest.

## Screenshots

| No-key retrieval-only mode | Source panel |
|---|---|
| ![Retrieval-only ranked passages with cosine scores](docs/screenshots/gc-02-retrieval.png) | ![Source panel showing the exact retrieved chunk](docs/screenshots/gc-04-panel.png) |

## License

MIT — see [LICENSE](LICENSE).

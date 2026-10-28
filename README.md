# grounded-chat

[![ci](https://github.com/ssh071102-code/grounded-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/ssh071102-code/grounded-chat/actions/workflows/ci.yml)

**A Next.js RAG chat app that streams answers with inline citations and flags every sentence the retrieved sources do not support.**

The app retrieves passages, asks the model to answer from them with `[n]` citations, and then checks the answer: each sentence is scored against the retrieved passages, and sentences the sources do not support are **flagged in the UI**. Indexing and search use local embeddings, so you can clone the repo and see it work in about a minute **with no API key**.

![Answer with inline citations and a flagged unsupported sentence](docs/screenshots/gc-03-verifier.png)

*Mock-model mode: the two extracted sentences are cited `[1] [2]` and marked supported; the planted "hot-air balloon" fabrication is flagged `unsupported`. The readout shows `2 supported / 1 flagged` from the embedding-similarity verifier at threshold `t=0.55`.*

---

## Quick start

### No-key path (recommended first, fully offline)

No API key, no database, no Docker. Local MiniLM embeddings power indexing and search.

```bash
npm install
npm run ingest -- corpus        # builds the vector index (downloads the ~23 MB embed model once)
npm run dev                     # http://localhost:3000
```

With no `ANTHROPIC_API_KEY` set, the chat endpoint returns **retrieval-only** results: the top passages with their cosine scores, so you can see the retrieval pipeline work end to end. To see the answer and verifier pipeline without a key, run the bundled mock model:

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
| **Local-first retrieval** | Sentence-aware chunking, local MiniLM embeddings, cosine search. Optional hybrid mode adds BM25 keyword search fused by reciprocal rank. No API key needed to index or search. |
| **Inline citations** | Answers cite retrieved passages as `[1] [2]`; citation chips open a source panel showing the exact chunk and its section heading. |
| **Groundedness verifier** | Each answer sentence is scored against sentence-level spans of the retrieved chunks; numbers and proper nouns must appear literally. Sentences that fail are flagged `unsupported` in the UI. |
| **Follow-up questions** | The browser sends recent turns with each request; the last two questions are folded into the retrieval query and the model sees the conversation. Nothing is stored on the server. |
| **No-key mode** | With no key, the endpoint returns ranked passages and scores, so the retrieval pipeline can be demonstrated offline. |
| **Pluggable store** | File-based index by default; a pgvector adapter (docker-compose included) implements the same interface. |
| **Eval** | `npm run eval` reports recall@k and MRR over a golden set. The numbers below are its output. |

---

## Architecture

```mermaid
flowchart LR
  subgraph ingest["npm run ingest -- <dir>"]
    docs[".md / .txt files"] --> chunk["sentence-aware\nchunking + overlap\n(title = nearest heading)"]
    chunk --> emb1["local MiniLM\nembeddings"]
    emb1 --> store[("vector store\nfile | pgvector")]
  end

  subgraph query["POST /api/chat"]
    q["question + recent turns"] --> emb2["local MiniLM\nembedding"]
    emb2 --> knn["dense top-k\n(or hybrid: dense + BM25, RRF, 2/doc preference)"]
    store --> knn
    knn -->|"no API key"| ro["retrieval-only\nJSON: passages + scores"]
    knn -->|"API key set"| gen["Anthropic SDK\nstreamed answer + [n] citations"]
    gen --> verify["groundedness verifier\n(similarity + literal specifics)"]
    verify --> sse["SSE: meta - delta - verification - done"]
  end
```

The retrieval path is identical in both modes; only generation and verification depend on the API key. Everything except answer generation runs locally.

### Retrieval modes

- **Dense (default).** The query is embedded and the top-k chunks by cosine similarity are returned.
- **Hybrid (`RETRIEVAL_MODE=hybrid`).** Dense and BM25 each return 20 candidates (`RETRIEVAL_CANDIDATES`), the two rankings are merged with reciprocal rank fusion, and any chunk beyond a document's first two (`RETRIEVAL_MAX_PER_DOC`) is moved behind every other candidate. This favours variety across documents without capping it: when fewer than k candidates are left after demotion, the demoted chunks fill the remaining slots in fused order, so a single document can still supply all k results. Scores shown in the UI stay cosine similarity, including for chunks only BM25 found.

The chat route and `npm run eval` call the same `retrieve()` function, so eval numbers describe the code path the app runs. Which mode wins depends on the corpus: hybrid scores higher on the bundled books (see Eval), while on a separate corpus of short business web pages, where many pages repeat the same boilerplate, dense scored higher. That is why the app defaults to dense.

**Layout**

```
corpus/                 bundled public-domain sample corpus (+ SOURCES.md provenance)
scripts/
  ingest.ts             npm run ingest -- <dir>
  eval.ts, golden.ts    npm run eval  (golden set + recall@k / MRR)
src/lib/
  chunk.ts              sentence-aware chunking, per-chunk section titles
  embed/local.ts        MiniLM embedder (Transformers.js, local)
  retrieve.ts           dense / hybrid retrieval (fuse.ts, lexical.ts)
  conversation.ts       history parsing and the follow-up retrieval query
  store/                VectorStore interface + file and pgvector adapters
  verify.ts             groundedness verifier
  llm/                  Anthropic + mock LLM behind one interface
  chat.ts               framework-agnostic chat pipeline (unit-tested)
src/app/api/chat/route.ts   Next.js route handler (streaming, rate-limited)
src/components/Chat.tsx      streaming chat UI
public/widget.js             one-line embed loader
tests/                  vitest
```

---

## Terminal transcript

Ingestion and a retrieval-only query (default dense mode, no API key), captured from this repo. The `sources` entries are abbreviated; the full response also carries `docId`, `title` and `from` for each passage.

```console
$ npm run ingest -- corpus
  darwin-origin-of-species.txt: 103 chunks (INTRODUCTION)
  einstein-relativity.txt: 84 chunks (PART I: THE SPECIAL THEORY OF RELATIVITY)
  strunk-elements-of-style.txt: 67 chunks (I. INTRODUCTORY)
embedding 254 chunks with xenova/all-MiniLM-L6-v2#q8 ...
indexed 254 chunks from 3 documents into the file store in 5.9s

$ curl -s -X POST localhost:3000/api/chat \
    -H 'content-type: application/json' \
    -d '{"question":"Why does Strunk recommend the active voice?","k":3}'
{
  "mode": "retrieval-only",
  "question": "Why does Strunk recommend the active voice?",
  "sources": [
    { "index": 1, "id": "strunk-elements-of-style.txt#32", "score": 0.2973,
      "title": "III. ELEMENTARY PRINCIPLES OF COMPOSITION",
      "text": "The habitual use of the active voice makes for forcible writing. This is true not only in narrative ..." },
    { "index": 2, "id": "strunk-elements-of-style.txt#29", "score": 0.2355,
      "title": "III. ELEMENTARY PRINCIPLES OF COMPOSITION",
      "text": "The campaign opened with a series of reverses. ..." },
    { "index": 3, "id": "strunk-elements-of-style.txt#9",  "score": 0.2053,
      "title": "II. ELEMENTARY RULES OF USAGE",
      "text": "The clause adds, parenthetically, a statement supplementing that in the main clause. ..." }
  ]
}
```

The document names in parentheses during ingestion are each file's first heading. Each chunk is titled with the nearest heading above it, as the `title` fields show.

---

## Eval

`npm run eval` runs 15 golden question and relevant-passage pairs over the bundled corpus. Each question's anchor phrase is resolved to the ground-truth chunk(s) at eval time, the question is retrieved, and the rank of the first relevant chunk is scored. `npm run eval` scores hybrid retrieval unless you pass `--mode dense`.

**Hybrid** (`--mode hybrid`, 2 chunks per document ranked first):

| metric | k=3 | k=5 | k=10 |
|---|---|---|---|
| **recall@k** | 0.867 (13/15) | 0.867 (13/15) | 1.000 (15/15) |
| **MRR** | 0.789 | 0.789 | 0.810 |

**Dense** (`--mode dense`, the app's default):

| metric | k=3 | k=5 | k=10 |
|---|---|---|---|
| **recall@k** | 0.733 (11/15) | 0.800 (12/15) | 0.867 (13/15) |
| **MRR** | 0.667 | 0.680 | 0.688 |

Measured 2026-09-27 with `xenova/all-MiniLM-L6-v2` (quantized). In hybrid mode recall is the same at k=3 and k=5: the two extra slots surface no additional target passages.

With hybrid retrieval, eleven of fifteen questions retrieve their target passage at rank 1. The two misses at k=5 are paraphrased questions: *"What subject does Darwin devote the first chapter to?"* and *"How should terms in a series be punctuated?"*. A small 384-dimension local model does not match them closely enough (see Limitations). Both are found by k=10, at rank 6 and rank 7. To reproduce:

```bash
npm run eval -- --k 5                 # hybrid
npm run eval -- --k 5 --mode dense    # dense
```

---

## Why a verifier (design note)

Retrieval-augmented generation reduces hallucination but leaves some. A model handed five passages can still add a fluent, plausible sentence that none of them support, and inline citations make that worse, because a citation next to an unsupported claim reads as evidence. The verifier is there to catch that case.

**How it works.** After generation, the answer is split into sentences. Each sentence is embedded with the same local model used for retrieval and compared against candidate spans drawn from the retrieved chunks: every chunk sentence, every pair of adjacent sentences, and the whole chunk as a fallback. The sentence's score is its maximum cosine similarity across those spans. Sentence-level spans keep short factual claims from being diluted by unrelated text elsewhere in a large chunk, and the two-sentence window catches claims that combine adjacent source facts (a price in one sentence, a duration in the next).

Each sentence then gets one of four statuses:

- **supported**: every number, time and proper noun in it appears literally in the passages; or, when it has none of those, it scores at or above the threshold.
- **unsupported**: it contains a number or name the passages do not contain, or it has none and scores below the threshold. A made-up price inside an otherwise on-topic sentence scores high on similarity, so specifics are checked literally instead.
- **unverifiable**: a closing or framing sentence (for example an invitation to get in touch) that asserts nothing checkable.
- **skipped**: too short to judge.

**Why this design.** It is deterministic, runs offline, adds no API cost, and is unit-tested with known-answer cases. It measures overlap with the sources, which is a good proxy for "is this traceable to a passage", the property citations are supposed to guarantee. An LLM-judge mode could replace it behind the same `verifyAnswer` interface.

**Threshold.** The default is `0.55`. On this corpus with MiniLM, sentences copied or closely paraphrased from a chunk score well above it, while off-topic fabrications score well below (the planted balloon sentence in mock mode lands far under). The threshold is exposed and documented because it trades precision against recall. `npm run eval -- --calibrate <module>` sweeps it over a labelled set.

**Failure modes.** The verifier is a heuristic and fails in known ways:

- **Negation blindness.** *"X causes Y"* and *"X does not cause Y"* embed closely, so a contradicted claim can still score as supported.
- **False-positive flags.** Heavy paraphrase or multi-hop synthesis can dip below threshold even when the sentence is grounded.
- **Overlap is a proxy for truth.** A sentence that faithfully echoes a wrong source passage scores as supported.

---

## Storage adapters (file vs pgvector)

Both stores implement one `VectorStore` interface and run the **same contract test suite** (`tests/helpers/store-contract.ts`), so the adapters are interchangeable.

- **File store (default).** Chunk metadata in `index.json`, vectors as raw `Float32` in `vectors.bin`. Queries are an exact brute-force cosine scan over the whole matrix. It is correct and fast for corpora up to tens of thousands of chunks (the bundled corpus is 254), with no dependencies and no server. It is not an approximate-nearest-neighbour index, so for millions of vectors the linear scan becomes the bottleneck.
- **pgvector adapter.** Same interface, backed by Postgres + [pgvector](https://github.com/pgvector/pgvector) with an HNSW index and cosine distance. Use it when the corpus outgrows a single-process scan or when you want the index in a shared database.

```bash
docker compose up -d
export PGVECTOR_URL=postgresql://postgres:postgres@localhost:5433/grounded
npm run ingest -- corpus        # builds the index in Postgres instead of on disk
npm run dev
```

The pgvector integration tests run only when `PGVECTOR_URL` is set and skip otherwise, so the default `npm test` stays offline. Those are the 9 skipped tests in a default run. The eval numbers above come from the file store.

---

## Embedding it on a site

The chat also runs as a widget on the site it answers for. One line in the page template, before `</body>`:

```html
<script src="https://YOUR-DEPLOYMENT/widget.js" defer></script>
```

That renders a launcher button; the panel it opens is an iframe pointing at `/embed` on the deployment. Nothing else is installed, and no CORS configuration is needed on either side, because the chat request is same-origin inside the frame.

| attribute | default | what it does |
|---|---|---|
| `data-label` | `Ask us` | Text on the launcher |
| `data-title` | the label | Accessible name of the frame |
| `data-side` | `right` | `left` moves it for a site whose own controls sit bottom-right |
| `data-accent` | `#111827` | Launcher colour; hex or a plain CSS colour name |

The launcher lives in a shadow root, so the host page's `button {}` rules cannot reach it, and it is a native `<button>`, which keeps it in the accessibility tree and reachable by keyboard. The iframe is built on first open, so a page nobody clicks costs the visitor nothing and never touches the model endpoint.

### Who may frame it

Set `EMBED_FRAME_ANCESTORS` to the origins allowed to embed this deployment, space- or comma-separated, each written as a full origin:

```
EMBED_FRAME_ANCESTORS="https://example.com https://www.example.com"
```

`/embed` sends that as `Content-Security-Policy: frame-ancestors`. **Unset means `'none'`.** Refusing to be framed is the safe default, because the alternative is serving the assistant from any page on the internet on a key you are paying for. `www` is not added for you: `example.com` and `www.example.com` are different origins that can have different owners, so both are listed only if both are written. Ports are kept as configured, and plaintext `http://` is accepted for loopback only.

#### What this does not cover

`frame-ancestors` decides whether a browser will render `/embed` in a frame. That is all it does:

- **It does not protect `/api/chat`.** That endpoint is a public POST that spends the deployment's model key. A server-to-server call, a reverse proxy that strips the header, or opening `/embed` as a top-level page all reach it without framing anything. `RATE_LIMIT_PER_WINDOW` is a per-address ceiling (30 requests per 5 minutes by default); there is no per-site quota or spend cap.
- **The deployed headers are what count.** A CDN or proxy can add a second CSP (the two intersect, so an inherited `frame-ancestors 'self'` blocks the widget everywhere) or restore `X-Frame-Options`. Check the response as served.
- **The host site trusts whoever serves `widget.js`.** There is no Subresource Integrity hash on that tag, and a useful one is not possible: the loader is meant to be updated without editing every site that embeds it, and a pinned hash would break them all on the next change. That is the usual trade-off for this kind of widget. Host it on a deployment you control, and treat write access to it as write access to every page that embeds it.

---

## Limitations

- **Local-embedding quality ceiling.** `all-MiniLM-L6-v2` is 384-dimensional and small. It works for a zero-key, offline demo, but a hosted embedding model would lift recall on paraphrased queries. The eval misses reflect this.
- **Retrieval mode is per corpus.** Dense is the default because it scored higher on short, repetitive business pages; hybrid scores higher on the bundled books. Run the eval on your own corpus before choosing.
- **File-store scale.** The default store does an exact linear scan. Switch to the pgvector adapter well before millions of vectors.
- **Verifier is a heuristic.** Embedding-similarity attribution has false positives and negation blindness (see the design note). It does not establish entailment or factual accuracy.
- **No accounts or stored history.** Conversation history lives in the browser and is sent with each request (capped at six turns). There is no auth and nothing is persisted server-side.
- **Rate limiting is per instance.** The limiter keeps counters in process memory, so on a serverless deployment the effective ceiling is the limit times the number of instances.

---

## The sample corpus

Three excerpts from public-domain English works, retrieved from Project Gutenberg with its license boilerplate stripped (~160 KB total): Darwin's *On the Origin of Species* (1859), Lawson's 1920 English translation of Einstein's *Relativity*, and Strunk's *The Elements of Style* (1918). All predate 1929 and are in the US public domain; full provenance and the public-domain rationale, including why a pre-1929 translation of the Einstein text matters, are in [`corpus/SOURCES.md`](corpus/SOURCES.md). Point `npm run ingest` at any directory of `.md`/`.txt` files to index your own.

---

## Development

```bash
npm run typecheck     # tsc --noEmit (strict)
npm run lint          # eslint
npm test              # vitest, offline: 134 passing, 9 pgvector tests skipped without PGVECTOR_URL
npm run build         # next build
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push to master and on pull requests.

**Tech:** Next.js (App Router) + TypeScript strict · Transformers.js (local MiniLM) · Anthropic SDK (streaming) · Postgres/pgvector · vitest.

## Screenshots

| No-key retrieval-only mode | Source panel |
|---|---|
| ![Retrieval-only ranked passages with cosine scores](docs/screenshots/gc-02-retrieval.png) | ![Source panel showing the exact retrieved chunk](docs/screenshots/gc-04-panel.png) |

## License

MIT, see [LICENSE](LICENSE).

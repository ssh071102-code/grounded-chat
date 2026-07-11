"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ChatMode } from "@/lib/config";

/* ---- Wire types (mirror the /api/chat payloads) ------------------------ */
interface Source {
  index: number;
  id: string;
  docId: string;
  title: string;
  text: string;
  score: number;
}
interface Verdict {
  sentence: string;
  score: number;
  bestChunkId: string | null;
  status: "supported" | "unsupported" | "skipped";
}
interface Verification {
  threshold: number;
  embedder: string;
  verdicts: Verdict[];
}

type ExchangeMode = "anthropic" | "mock" | "retrieval-only";
type ExchangeStatus = "streaming" | "verifying" | "done" | "error";

interface Exchange {
  id: string;
  question: string;
  k: number;
  mode: ExchangeMode | null;
  status: ExchangeStatus;
  answer: string;
  sources: Source[];
  verification: Verification | null;
  error?: string;
}

interface PanelState {
  open: boolean;
  exchangeId: string | null;
  activeSource: number | null;
}

const SUGGESTIONS = [
  "What ship was Darwin aboard when he began observing species?",
  "Why does Strunk recommend the active voice over the passive?",
  "Can two distant lightning strikes be called simultaneous?",
  "What transformation relates two systems in relative motion?",
];

const MODE_LABEL: Record<ChatMode, string> = {
  anthropic: "Live model",
  mock: "Mock model",
  "retrieval-only": "Retrieval only",
};

let counter = 0;
const nextId = () => `x${Date.now().toString(36)}${counter++}`;

export function Chat({ mode, model }: { mode: ChatMode; model: string }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState("");
  const [k, setK] = useState(5);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<PanelState>({
    open: false,
    exchangeId: null,
    activeSource: null,
  });

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const patch = useCallback((id: string, fn: (ex: Exchange) => Exchange) => {
    setExchanges((prev) => prev.map((ex) => (ex.id === id ? fn(ex) : ex)));
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      threadRef.current?.scrollTo({
        top: threadRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setInput("");

      const id = nextId();
      setExchanges((prev) => [
        ...prev,
        {
          id,
          question: trimmed,
          k,
          mode: null,
          status: "streaming",
          answer: "",
          sources: [],
          verification: null,
        },
      ]);
      scrollToEnd();

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, k }),
        });
        const contentType = res.headers.get("Content-Type") ?? "";

        if (contentType.includes("application/json")) {
          const data = (await res.json()) as
            | { mode: "retrieval-only"; sources: Source[] }
            | { error: string; hint?: string };
          if ("error" in data) {
            patch(id, (ex) => ({
              ...ex,
              status: "error",
              error: data.hint ? `${data.error} - ${data.hint}` : data.error,
            }));
          } else {
            patch(id, (ex) => ({
              ...ex,
              mode: "retrieval-only",
              status: "done",
              sources: data.sources,
            }));
          }
          scrollToEnd();
          return;
        }

        if (!res.body) throw new Error("empty response stream");
        await consumeSSE(res.body, (event, data) => {
          if (event === "meta") {
            const m = data as { mode: ExchangeMode; sources: Source[] };
            patch(id, (ex) => ({ ...ex, mode: m.mode, sources: m.sources }));
          } else if (event === "delta") {
            const d = data as { text: string };
            patch(id, (ex) => ({ ...ex, answer: ex.answer + d.text }));
          } else if (event === "verification") {
            patch(id, (ex) => ({
              ...ex,
              status: "verifying",
              verification: data as Verification,
            }));
          } else if (event === "done") {
            patch(id, (ex) => ({ ...ex, status: "done" }));
          } else if (event === "error") {
            const e = data as { message: string };
            patch(id, (ex) => ({ ...ex, status: "error", error: e.message }));
          }
          scrollToEnd();
        });
      } catch (err) {
        patch(id, (ex) => ({
          ...ex,
          status: "error",
          error: err instanceof Error ? err.message : "request failed",
        }));
      } finally {
        setBusy(false);
        textareaRef.current?.focus();
      }
    },
    [busy, k, patch, scrollToEnd],
  );

  const openPanel = useCallback(
    (exchangeId: string, sourceIndex: number | null) => {
      setPanel({ open: true, exchangeId, activeSource: sourceIndex });
    },
    [],
  );

  const activeExchange =
    exchanges.find((ex) => ex.id === panel.exchangeId) ?? null;

  return (
    <div className="shell" data-panel={panel.open ? "open" : "closed"}>
      <div className="stage">
        <header className="masthead">
          <div className="wordmark">
            grounded<span className="dot">-</span>chat
            <span className="sub">RAG - cited - verified</span>
          </div>
          <span className="mode-badge" data-mode={mode} title={`model: ${model}`}>
            <span className="pip" />
            {MODE_LABEL[mode]}
          </span>
        </header>

        <div className="thread" ref={threadRef}>
          <div className="thread-inner">
            {exchanges.length === 0 && (
              <HeroPanel mode={mode} onPick={ask} />
            )}
            {exchanges.map((ex) => (
              <ExchangeView
                key={ex.id}
                ex={ex}
                onCite={openPanel}
                panelActive={
                  panel.open && panel.exchangeId === ex.id
                    ? panel.activeSource
                    : null
                }
              />
            ))}
          </div>
        </div>

        <div className="composer-wrap">
          <Composer
            ref={textareaRef}
            value={input}
            k={k}
            busy={busy}
            onChange={setInput}
            onChangeK={setK}
            onSubmit={() => ask(input)}
          />
          <div className="composer-meta">
            <span>
              {mode === "retrieval-only"
                ? "no API key - returning ranked passages with scores"
                : mode === "mock"
                  ? "mock model - the verifier will flag its planted fabrication"
                  : `answering with ${model}`}
            </span>
            <span>enter to send - shift+enter for newline</span>
          </div>
        </div>
      </div>

      <SourcePanel
        exchange={activeExchange}
        activeSource={panel.activeSource}
        onClose={() => setPanel((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}

/* ======================================================================== */

function HeroPanel({
  mode,
  onPick,
}: {
  mode: ChatMode;
  onPick: (q: string) => void;
}) {
  return (
    <div className="hero">
      <h1>
        Answers that <em>refuse</em> to make things up.
      </h1>
      <p>
        Ask a question about the bundled corpus. Every answer streams with inline
        citations tied to the exact retrieved passages, then a groundedness
        verifier scores each sentence against those passages and visibly flags
        anything the sources do not support.
      </p>
      <div className="legend">
        <span>
          <span className="swatch" /> supported sentence
        </span>
        <span>
          <span className="swatch flag" /> flagged as unsupported
        </span>
        <span>
          {mode === "retrieval-only"
            ? "no key set - retrieval-only demo"
            : "citations open the source panel"}
        </span>
      </div>
      <div className="suggests">
        {SUGGESTIONS.map((q) => (
          <button key={q} onClick={() => onPick(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExchangeView({
  ex,
  onCite,
  panelActive,
}: {
  ex: Exchange;
  onCite: (exchangeId: string, sourceIndex: number | null) => void;
  panelActive: number | null;
}) {
  return (
    <section className="exchange">
      <div className="q">
        <span className="tag">ask</span>
        <span className="text">{ex.question}</span>
      </div>
      <div className="answer">
        {ex.status === "error" ? (
          <p className="prose err">{ex.error}</p>
        ) : ex.mode === "retrieval-only" ? (
          <RetrievalOnly ex={ex} />
        ) : (
          <AnswerView ex={ex} onCite={onCite} panelActive={panelActive} />
        )}
      </div>
    </section>
  );
}

function AnswerView({
  ex,
  onCite,
  panelActive,
}: {
  ex: Exchange;
  onCite: (exchangeId: string, sourceIndex: number | null) => void;
  panelActive: number | null;
}) {
  const streaming = ex.status === "streaming";
  const verification = ex.verification;

  const cite = (marker: number) => onCite(ex.id, marker - 1);

  return (
    <>
      <div className="prose">
        {verification ? (
          verification.verdicts.map((v, i) => (
            <Fragment key={i}>
              <span
                className={`sentence ${v.status}`}
                title={
                  v.status === "skipped"
                    ? "too short to score"
                    : `groundedness ${v.score.toFixed(2)} vs threshold ${verification.threshold}`
                }
              >
                {renderWithCitations(v.sentence, ex.sources, cite, panelActive)}
                {v.status === "unsupported" && (
                  <span className="flag-tag">unsupported</span>
                )}
              </span>{" "}
            </Fragment>
          ))
        ) : (
          <>
            {renderWithCitations(ex.answer, ex.sources, cite, panelActive)}
            {streaming && <span className="stream-caret" />}
          </>
        )}
      </div>

      {verification && <Readout verification={verification} />}

      {ex.sources.length > 0 && (
        <div className="sources-line">
          <button onClick={() => onCite(ex.id, null)}>
            {ex.sources.length} retrieved passages
          </button>
          <span>cited inline as [n] - click to inspect</span>
        </div>
      )}
    </>
  );
}

function Readout({ verification }: { verification: Verification }) {
  const judged = verification.verdicts.filter((v) => v.status !== "skipped");
  const supported = judged.filter((v) => v.status === "supported").length;
  const flagged = judged.length - supported;
  const pct = judged.length ? (supported / judged.length) * 100 : 100;

  return (
    <div className="readout">
      <span className="verdict-supported">{supported} supported</span>
      {flagged > 0 && (
        <>
          <span className="divider">/</span>
          <span className="verdict-flagged">{flagged} flagged</span>
        </>
      )}
      <div
        className="gauge"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="fill" style={{ width: `${pct}%` }} />
        {flagged > 0 && (
          <div className="fill flag" style={{ width: `${100 - pct}%` }} />
        )}
      </div>
      <span className="method">
        embedding-similarity verifier - t={verification.threshold}
      </span>
    </div>
  );
}

function RetrievalOnly({ ex }: { ex: Exchange }) {
  return (
    <>
      <div className="retrieval-note">
        <span>
          <b>No API key set.</b> Showing the retrieval pipeline only: the top{" "}
          {ex.sources.length} passages ranked by cosine similarity against your
          question. Set <code>ANTHROPIC_API_KEY</code> to generate a cited,
          verified answer from these.
        </span>
      </div>
      <div className="passages">
        {ex.sources.map((s) => (
          <article className="passage" key={s.id}>
            <div className="head">
              <span className="rank">{s.index}</span>
              <div className="titles">
                <div className="doc">{s.title}</div>
                <div className="cid">{s.id}</div>
              </div>
              <div className="score">
                <span className="val">{s.score.toFixed(3)}</span>
                <span className="lbl">cosine</span>
              </div>
            </div>
            <div className="score-meter">
              <div
                className="fill"
                style={{ width: `${Math.max(0, Math.min(1, s.score)) * 100}%` }}
              />
            </div>
            <div className="body">{s.text}</div>
          </article>
        ))}
      </div>
    </>
  );
}

function SourcePanel({
  exchange,
  activeSource,
  onClose,
}: {
  exchange: Exchange | null;
  activeSource: number | null;
  onClose: () => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeSource !== null) {
      activeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeSource, exchange]);

  return (
    <aside className="panel" aria-hidden={!exchange}>
      <div className="panel-inner">
        <div className="panel-head">
          <h2>Sources</h2>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="panel-body">
          {exchange?.sources.map((s) => {
            const isActive = activeSource === s.index - 1;
            return (
              <div
                className="src-card"
                data-active={isActive}
                ref={isActive ? activeRef : undefined}
                key={s.id}
              >
                <div className="head">
                  <span className="n">[{s.index}]</span>
                  <span className="doc">{s.title}</span>
                  <span className="cid">{s.id}</span>
                </div>
                <div className="score-row">
                  <span>cosine {s.score.toFixed(3)}</span>
                  <span className="bar">
                    <i
                      style={{
                        width: `${Math.max(0, Math.min(1, s.score)) * 100}%`,
                      }}
                    />
                  </span>
                </div>
                <div className="text">{s.text}</div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

interface ComposerProps {
  value: string;
  k: number;
  busy: boolean;
  onChange: (v: string) => void;
  onChangeK: (v: number) => void;
  onSubmit: () => void;
}

function Composer({
  ref,
  value,
  k,
  busy,
  onChange,
  onChangeK,
  onSubmit,
}: ComposerProps & { ref: React.Ref<HTMLTextAreaElement> }) {
  return (
    <div className="composer">
      <textarea
        ref={ref}
        rows={1}
        placeholder="Ask the corpus a question..."
        value={value}
        disabled={busy}
        onChange={(e) => {
          onChange(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="k-select" title="how many passages to retrieve">
        k=
        <input
          type="number"
          min={1}
          max={10}
          value={k}
          onChange={(e) =>
            onChangeK(Math.min(10, Math.max(1, Number(e.target.value) || 5)))
          }
        />
      </div>
      <button
        className="send"
        onClick={onSubmit}
        disabled={busy || value.trim().length === 0}
        aria-label="Send"
      >
        {busy ? "..." : "↑"}
      </button>
    </div>
  );
}

/* ---- helpers ----------------------------------------------------------- */

/** Replace [n] citation markers with clickable chips bound to sources. */
function renderWithCitations(
  text: string,
  sources: Source[],
  onCite: (marker: number) => void,
  activeSource: number | null,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(<span key={key++}>{text.slice(last, match.index)}</span>);
    }
    const marker = Number(match[1]);
    const valid = marker >= 1 && marker <= sources.length;
    nodes.push(
      valid ? (
        <button
          key={key++}
          className="cite"
          data-active={activeSource === marker - 1}
          onClick={() => onCite(marker)}
        >
          {marker}
        </button>
      ) : (
        <span key={key++}>{match[0]}</span>
      ),
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    nodes.push(<span key={key++}>{text.slice(last)}</span>);
  }
  return nodes;
}

/** Minimal SSE reader over a fetch response body. */
async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const eventMatch = block.match(/^event: (.+)$/m);
      const dataMatch = block.match(/^data: (.+)$/m);
      if (eventMatch && dataMatch) {
        try {
          onEvent(eventMatch[1]!, JSON.parse(dataMatch[1]!));
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
}

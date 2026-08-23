export interface ChatTurn {
  question: string;
  answer: string;
}

/** Turns kept from the history a client posts back. */
export const MAX_TURNS = 6;

/** Turns whose questions feed the retrieval query. */
const QUERY_TURNS = 2;

/** Per-field ceiling on a client-supplied turn. */
const MAX_FIELD_CHARS = 800;

/**
 * History arrives from the browser on every request, because the server keeps
 * no session. That makes it caller-controlled input: it is capped in both
 * directions here, since every turn that survives becomes input tokens billed
 * to the deployment's key.
 */
export function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { question, answer } = entry as Record<string, unknown>;
    if (typeof question !== "string" || typeof answer !== "string") continue;
    if (!question.trim() || !answer.trim()) continue;
    turns.push({
      question: question.trim().slice(0, MAX_FIELD_CHARS),
      answer: answer.trim().slice(0, MAX_FIELD_CHARS),
    });
  }
  return turns.slice(-MAX_TURNS);
}

/**
 * The query to retrieve on.
 *
 * A follow-up is usually unusable on its own: "what about a bigger wall"
 * embedded by itself matches nothing in a corpus about brickwork, because the
 * subject lives in the turn before it. The common fix is to have a model
 * rewrite the follow-up into a standalone question, which costs an extra API
 * call per turn and would undo the one thing this pipeline can claim — that
 * nothing outside answer generation talks to a model.
 *
 * So the subject is carried forward literally: the last couple of questions
 * are prepended to the current one. Prior answers are left out, since they are
 * largely restatements of passages already in the index and would pull the
 * query toward whatever was retrieved last time. The current question goes
 * last, where a short query gives it the most weight.
 */
export function retrievalQuery(history: ChatTurn[], question: string): string {
  const recent = history.slice(-QUERY_TURNS).map((turn) => turn.question);
  return [...recent, question].join(" ").trim();
}

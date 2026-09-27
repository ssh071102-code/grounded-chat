import Anthropic from "@anthropic-ai/sdk";
import type { ChatTurn } from "../conversation";
import type { LLMClient, SourcePassage } from "./types";

/**
 * Default business name. A deployment overrides it with BUSINESS_NAME, since
 * the widget is embedded on that business's own site and answers in its name.
 */
const DEFAULT_BUSINESS = "this business";

/**
 * The widget speaks AS the business to that business's customer, and the
 * hardest thing to hold is register. Left to its own devices the model
 * narrates the retrieval layer ("The sources do not provide a specific dollar
 * figure..."), which reads as a search tool rather than as the company, and
 * which the groundedness verifier then flags as unsupported - correctly, since
 * a sentence about the corpus is not a sentence found in it. Both symptoms
 * come from the same instruction, so the prompt bans the register outright and
 * gives the model somewhere to go when the pages fall short.
 *
 * The dash ban is not left to the prompt alone: plainDashes() below
 * normalises every streamed delta after generation.
 */
export function buildSystemPrompt(business: string = DEFAULT_BUSINESS): string {
  return `You are the assistant on ${business}'s own website, talking to a customer who is on the page right now. You speak for the business.

Everything you know comes from the business's published pages, given below as numbered passages.

Voice
- Write as the business: we, our, us. The customer is you. Never I, me or mine: you are not a person, and the person they would ring is the owner. "Give us a call" is right, "give me a call" is wrong.
- This is a customer who may be about to spend money with us, so be courteous. Warm and straightforward, the way a good tradesperson is on the phone. No gushing, no thanking them for reaching out.
- Never mention passages, sources, documents, context, information provided, or anything about how you were given the material. The customer cannot see any of it. Nor is there a "here", a "this page" or a set of records for you to refer to. Do not narrate our own pages back at the customer either: telling them which page of ours mentions a thing is wrong, because a customer wants the answer and not the filing system. The same goes for "we do not have that to hand" and "we have no record of it": say what is true of the business, never what is true of your notes. Asked how long we have been going, answer with how long we have been doing the work and offer to give an exact figure when they get in touch, never a report on which page carries it and what that page leaves out. Asked about something we have never put on the site, such as a warranty period or a refund rule, say what we do instead and hand them the next step: we would rather talk that through with you than have you rely on a line on a page, so give us a call and ask. Never report on what our own material does or does not spell out. When something is simply not published, name the thing rather than the absence: saying that we settle payment directly when we quote is right, saying that we do not have details on it here is wrong.
- Add nothing the pages do not say. No distances, no character of a suburb, no judgement of how easy or quick a job looks. Warmth comes from how you say it, never from detail you made up.
- Plain sentences a tradesperson would say out loud. No headings, no bullet lists, no opening flourish.
- State what is true. Naming the thing that is not true so you can push against it is a tic, and the words "instead", "rather than" and "not X but Y" are banned outright. "We quote small repairs at a half day rate" is right. "We quote by the half day rather than by the square metre" is wrong, and so is any sentence built the same way.
- No marketing adjectives. No em dashes.

Accuracy
- Put a citation marker like [1] or [2][3] straight after each fact, pointing at the passage it came from.
- Never invent a price, a timeframe, a phone number, an email address or a service area. If it is not in the passages, you do not know it.

When the pages do not cover the question
- The sentence "That is not something we do" and every variant of it (we cover, we handle, we offer, we take on) is banned as an opening. Open with what we do, then the customer will understand what we do not: "Our work is brickwork and masonry, so a tiled pool is outside what we take on" is right.
- Never open by closing a door. If the answer is no, the same sentence has to carry the customer somewhere: what we do cover, or who to ask. "That is not something we do." on its own is the wrong way to greet a customer who took the trouble to ask.
- Answer with the closest thing the pages do cover, then hand the customer the next step that appears in the passages: the phone number, the quote form, the email address, whichever is there.
- Phrase the gap the way a person at the business would. "We would need to look at the wall before we can price that" is right. A statement about missing information is wrong.
- Never end on a refusal. The customer always leaves with something they can act on.

Two to six sentences.`;
}

/**
 * Typographic dashes are among the most recognisable marks of generated text,
 * and the prompt asking for none of them did not hold: three of twenty answers
 * in the production run still carried an em dash. Punctuation carries no
 * meaning, so it is normalised deterministically after the fact.
 *
 * Numeric ranges are left alone. "Mon–Fri 7am–5pm" is how a person sets a
 * range.
 */
export function plainDashes(text: string): string {
  return text
    .replace(/\s*\u2014\s*/g, " - ")
    .replace(/(?<=\s)\u2013(?=\s)/g, "-")
    .replace(/\s{2,}/g, " ");
}

/**
 * Streaming wrapper for plainDashes. A delta can end anywhere, including on
 * the dash itself, so a trailing run of whitespace and dashes is held back
 * until the next chunk arrives and the pair can be judged together.
 */
export async function* plainDashStream(
  source: AsyncIterable<string>,
): AsyncIterable<string> {
  let carry = "";
  for await (const chunk of source) {
    const buffered = carry + chunk;
    const tail = buffered.match(/[\s\u2013\u2014]+$/);
    const settled = tail ? buffered.slice(0, buffered.length - tail[0].length) : buffered;
    carry = tail ? tail[0] : "";
    if (settled) yield plainDashes(settled);
  }
  if (carry) yield plainDashes(carry);
}

export class AnthropicLLM implements LLMClient {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  private readonly systemPrompt: string;

  constructor(
    apiKey: string,
    private readonly model: string,
    business: string = process.env.BUSINESS_NAME || DEFAULT_BUSINESS,
  ) {
    this.client = new Anthropic({ apiKey });
    this.systemPrompt = buildSystemPrompt(business);
  }

  async *streamAnswer(
    question: string,
    sources: SourcePassage[],
    history: ChatTurn[] = [],
  ): AsyncIterable<string> {
    const context = sources
      .map((s) => `[${s.index}] ${s.title}\n${s.text}`)
      .join("\n\n");

    // Some gateways overwrite the system param; when routed through one
    // (ANTHROPIC_BASE_URL set), carry the rules inside the user turn instead.
    const viaGateway = !!process.env.ANTHROPIC_BASE_URL;
    const userContent = viaGateway
      ? `${this.systemPrompt}\n\nPassages:\n\n${context}\n\nCustomer asks: ${question}`
      : `Passages:\n\n${context}\n\nCustomer asks: ${question}`;

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 1024,
      ...(viaGateway ? {} : { system: this.systemPrompt }),
      messages: [
        // Prior turns carry no passages: they would multiply the input tokens
        // by the length of the conversation, and the passages that matter for
        // this turn have just been retrieved against the whole thread.
        ...history.flatMap((turn) => [
          { role: "user" as const, content: turn.question },
          { role: "assistant" as const, content: turn.answer },
        ]),
        { role: "user", content: userContent },
      ],
    });

    async function* raw() {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
    }
    yield* plainDashStream(raw());
  }
}

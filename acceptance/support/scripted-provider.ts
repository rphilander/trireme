/**
 * A provider that answers from a script instead of a model.
 *
 * The acceptance suite drives trireme's whole loop through this: no network,
 * no model, no waiting, and exact control over tool calls, token usage and
 * failures. Verified against a real agent session before the suite was written.
 */
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export const SCRIPTED_PROVIDER = "scripted";
export const SCRIPTED_MODEL = "scripted-1";
/** What a job manifest or override must say to select this provider. */
export const SCRIPTED_MODEL_REF = `${SCRIPTED_PROVIDER}/${SCRIPTED_MODEL}`;

export interface ScriptedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ScriptedTurn {
  /** Tool calls to emit. When present the turn stops with `toolUse`. */
  tools?: ScriptedToolCall[];
  /** Assistant text. Used when `tools` is absent or empty. */
  text?: string;
  /** Tokens attributed to this turn. Defaults to a small fixed cost. */
  usage?: Partial<TurnUsage>;
  /** Emit a provider error instead of a response, as an outage would. */
  fail?: string;
}

export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ScriptOptions {
  /**
   * Called once per model request, zero-indexed. Returning undefined means
   * "nothing further" and is answered with a plain end-of-turn.
   */
  respond: (request: number) => ScriptedTurn | undefined;
  /**
   * Whether the provider publishes per-token prices. When false every cost is
   * zero, as a flat-rate coding plan reports, and the ledger must treat that as
   * unpriced rather than free.
   */
  priced?: boolean;
}

export interface ScriptedProvider {
  /** Pass to RunOptions.extensions. */
  extension: { name: string; factory: (pi: unknown) => void };
  /** Pass as overrides.model, or put in the manifest. */
  modelRef: string;
  /** How many model requests were made. */
  requests: () => number;
}

const PRICES = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const DEFAULT_USAGE: TurnUsage = { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 };

function priceOf(usage: TurnUsage, priced: boolean) {
  const per = (tokens: number, dollarsPerMillion: number) =>
    priced ? (tokens / 1_000_000) * dollarsPerMillion : 0;
  const input = per(usage.input, PRICES.input);
  const output = per(usage.output, PRICES.output);
  const cacheRead = per(usage.cacheRead, PRICES.cacheRead);
  const cacheWrite = per(usage.cacheWrite, PRICES.cacheWrite);
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

export function scriptedProvider(options: ScriptOptions): ScriptedProvider {
  const priced = options.priced ?? true;
  let requests = 0;

  const model = {
    id: SCRIPTED_MODEL,
    name: "Scripted",
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:1/never-called",
    provider: SCRIPTED_PROVIDER,
    reasoning: false,
    input: ["text"],
    cost: priced
      ? { input: PRICES.input, output: PRICES.output, cacheRead: PRICES.cacheRead, cacheWrite: PRICES.cacheWrite }
      : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_000,
  };

  function streamSimple() {
    const request = requests;
    requests += 1;
    const turn = options.respond(request) ?? { text: "" };
    const usage = { ...DEFAULT_USAGE, ...turn.usage };

    const base = {
      role: "assistant" as const,
      api: "openai-completions",
      provider: SCRIPTED_PROVIDER,
      model: SCRIPTED_MODEL,
      usage: { ...usage, totalTokens: usage.input + usage.output, cost: priceOf(usage, priced) },
      timestamp: Date.now(),
    };

    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      const push = (event: unknown) => stream.push(event as never);

      if (turn.fail !== undefined) {
        const message = { ...base, content: [], stopReason: "error", errorMessage: turn.fail };
        push({ type: "start", partial: message });
        push({ type: "error", reason: "error", error: message });
        return;
      }

      if (turn.tools && turn.tools.length > 0) {
        const content = turn.tools.map((call, index) => ({
          type: "toolCall",
          id: `call_${request}_${index}`,
          name: call.name,
          arguments: call.arguments,
        }));
        const message = { ...base, content, stopReason: "toolUse" };
        push({ type: "start", partial: message });
        content.forEach((toolCall, index) =>
          push({ type: "toolcall_end", contentIndex: index, toolCall, partial: message }),
        );
        push({ type: "done", reason: "toolUse", message });
        return;
      }

      const text = turn.text ?? "";
      const message = { ...base, content: [{ type: "text", text }], stopReason: "stop" };
      push({ type: "start", partial: message });
      push({ type: "text_end", contentIndex: 0, content: text, partial: message });
      push({ type: "done", reason: "stop", message });
    });
    return stream;
  }

  return {
    modelRef: SCRIPTED_MODEL_REF,
    requests: () => requests,
    extension: {
      name: "trireme-scripted-provider",
      factory: (pi: unknown) => {
        (pi as { registerProvider: (name: string, config: unknown) => void }).registerProvider(
          SCRIPTED_PROVIDER,
          {
            name: "Scripted",
            api: "openai-completions",
            baseUrl: model.baseUrl,
            apiKey: "not-needed",
            streamSimple,
            models: [model],
          },
        );
      },
    },
  };
}

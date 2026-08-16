/**
 * The agent session: one per job, with trireme's tools and nothing else.
 *
 * pi's built-in tools are not registered — the agent has no shell, no
 * filesystem access, and no way to address anything the harness did not name.
 * The model is resolved after extensions load, because an extension is how a
 * provider gets registered, and that is the seam the acceptance suite drives.
 */
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession, InlineExtension, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import path from "node:path";
import type { ThinkingLevel } from "../core/types.ts";

/**
 * A run is unattended, so a transient provider failure is retried before it is
 * fatal. Two layers, deliberately:
 *
 * - `provider`: pi-ai retries the HTTP request itself on 408/409/429/5xx,
 *   honouring Retry-After, on a 0.5→1→2→4→8→8s schedule. Six attempts is
 *   ~25s of patience per request. This is off by default and is where a
 *   rate-limit window is outlasted. It happens below the session, so it is
 *   invisible to a scripted provider and to `stalledMs`; only wall clock sees it.
 * - session: when an error still surfaces as an assistant message, the session
 *   retries three times at 1→2→4s and reports each as `auto_retry_start`, which
 *   the ledger records as stalled time.
 *
 * Together: roughly half a minute before a real outage is reported as one.
 */
const RETRY = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 1000,
  provider: { maxRetries: 6, maxRetryDelayMs: 60_000 },
};

export class InfrastructureError extends Error {}

export interface SessionOptions {
  workspace: string;
  model: string;
  thinking: ThinkingLevel;
  systemPrompt: string;
  tools: ToolDefinition[];
  extensions: InlineExtension[];
}

export interface HarnessSession {
  session: AgentSession;
  /** Whether the provider publishes per-token prices. */
  priced: boolean;
  modelRef: string;
  /**
   * The thinking level the model will actually receive. The runtime clamps
   * the requested level to what the model supports — a reasoning model that
   * knows only `high` and `max` receives `high` for `medium`; a model that
   * does not reason receives `off`.
   */
  thinkingEffective: ThinkingLevel;
  /** The resolved model's limits, as the runtime will enforce them. */
  limits: { maxTokens: number; contextWindow: number; reasoning: boolean };
}

/** `provider/model-id`, where the model id may itself contain slashes. */
function splitModelRef(ref: string): { provider: string; modelId: string } {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) {
    throw new InfrastructureError(
      `"${ref}" is not a model reference. Use provider/model-id, for example openrouter/anthropic/claude-sonnet-5.`,
    );
  }
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

/**
 * A provider that publishes no per-token prices reports every cost as zero,
 * which is not the same as a free run. The model's declared prices are the only
 * place that distinction is visible.
 */
function isPriced(model: unknown): boolean {
  const cost = (model as { cost?: unknown } | undefined)?.cost;
  if (!cost || typeof cost !== "object") return false;
  return Object.values(cost as Record<string, unknown>).some(
    (value) => typeof value === "number" && value > 0,
  );
}

export async function createHarnessSession(options: SessionOptions): Promise<HarnessSession> {
  const agentDir = getAgentDir();

  // Trireme owns the session's configuration outright: the user's pi settings,
  // extensions, skills and project context files must not change what a
  // benchmark measures. Credentials are the one thing read from the agent dir.
  const settingsManager = SettingsManager.inMemory({ retry: RETRY });

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.workspace,
    agentDir,
    settingsManager,
    extensionFactories: options.extensions,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: options.systemPrompt,
  });
  await resourceLoader.reload();

  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });

  const { session } = await createAgentSession({
    cwd: options.workspace,
    agentDir,
    modelRuntime,
    settingsManager,
    sessionManager: SessionManager.inMemory(options.workspace),
    resourceLoader,
    customTools: options.tools,
    noTools: "builtin",
    thinkingLevel: options.thinking,
  });

  // Extensions bind here, and a provider an extension registered exists only
  // from this point on — hence resolving the model after, not before.
  await session.bindExtensions({});

  const { provider, modelId } = splitModelRef(options.model);
  const model = modelRuntime.getModel(provider, modelId);
  if (!model) {
    throw new InfrastructureError(
      `The model ${options.model} is not available. Provider "${provider}" knows no model "${modelId}".`,
    );
  }

  try {
    await session.setModel(model);
  } catch (error) {
    throw new InfrastructureError(
      `Cannot use ${options.model}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const resolved = model as { maxTokens?: number; contextWindow?: number; reasoning?: boolean };
  return {
    session,
    priced: isPriced(model),
    modelRef: options.model,
    thinkingEffective: clampThinkingLevel(model, options.thinking) as ThinkingLevel,
    limits: {
      maxTokens: resolved.maxTokens ?? 0,
      contextWindow: resolved.contextWindow ?? 0,
      reasoning: resolved.reasoning === true,
    },
  };
}

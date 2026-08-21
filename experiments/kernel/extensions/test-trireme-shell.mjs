/**
 * test-trireme-shell.mjs — offline test of the trireme-shell pi extension.
 * No LLM: a scripted fake provider emits (1) a bash call with NO timeout,
 * then (2) captures the context of the follow-up turn — asserting that the
 * model would see: the 1s-default timeout error, the [policy] teaching line,
 * and the ambient time/cost stamp with accumulated cost.
 *
 *   TRIREME_WALL_CAP_S=600 TRIREME_STAMP=1 node test-trireme-shell.mjs
 */
process.env.TRIREME_WALL_CAP_S ??= "600";
process.env.TRIREME_STAMP ??= "1";

const PI = `${process.env.HOME}/.local/lib/node/lib/node_modules/@earendil-works/pi-coding-agent`;
const pi = await import(`file://${PI}/dist/index.js`);
const ai = await import(`file://${PI}/node_modules/@earendil-works/pi-ai/dist/index.js`);
const shellExt = (await import("./trireme-shell.ts")).default;

const capturedContexts = [];
let turn = 0;

function scriptedStream(model, _context, _options) {
  const stream = ai.createAssistantMessageEventStream();
  const n = turn++;
  capturedContexts.push(JSON.parse(JSON.stringify(_context.messages ?? [])));
  (async () => {
    const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } };
    const out = { role: "assistant", content: [], api: model.api, provider: model.provider,
      model: model.id, usage, stopReason: "pending", timestamp: Date.now() };
    stream.push({ type: "start", partial: out });
    if (n === 0) {
      out.content = [{ type: "toolCall", id: "call-1", name: "bash",
        arguments: { command: "sleep 3 && echo NEVER" } }];   // no timeout on purpose
      out.stopReason = "toolUse";
    } else {
      out.content = [{ type: "text", text: "end" }];
      out.stopReason = "stop";
    }
    stream.push({ type: "done", reason: out.stopReason, message: out });
    stream.end();
  })();
  return stream;
}

const fakeProviderExt = (api) => {
  api.registerProvider("fake", {
    name: "Fake", baseUrl: "http://localhost:0", apiKey: "none", api: "openai-completions",
    streamSimple: scriptedStream,
    models: [{ id: "fake-1", name: "Fake 1", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000, maxTokens: 4096 }],
  });
};

const cwd = process.cwd();
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-agent-"));
const loader = new pi.DefaultResourceLoader({
  cwd, agentDir,
  extensionFactories: [shellExt, fakeProviderExt],
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
  noContextFiles: true, systemPrompt: "test harness",
});
await loader.reload();
const modelRuntime = await pi.ModelRuntime.create();
const { session, extensionsResult } = await pi.createAgentSession({
  modelRuntime, resourceLoader: loader,
  sessionManager: pi.SessionManager.inMemory(cwd),
  settingsManager: pi.SettingsManager.inMemory({}),
  thinkingLevel: "off",
});
await session.bindExtensions({});
const model = modelRuntime.getModel("fake", "fake-1");
if (!model) {
  console.log("providers:", modelRuntime.getModels().map(m => m.provider + "/" + m.id).slice(0, 8));
  throw new Error("fake model not registered");
}
await session.setModel(model);

const t0 = Date.now();
await session.prompt("go", { expandPromptTemplates: false });
const wall = (Date.now() - t0) / 1000;

// ---- assertions ----
const flat = (msgs) => JSON.stringify(msgs);
const ctx2 = flat(capturedContexts[1] ?? []);
const STAMP_ON = process.env.TRIREME_STAMP === "1";
const checks = [
  ["ran 2 turns", capturedContexts.length === 2],
  [`bash killed by injected 1s default (wall ${wall.toFixed(1)}s < 3s sleep)`, wall < 2.8],
  ["turn-2 context contains timeout error", /timeout:1|timed out/i.test(ctx2)],
  ["turn-2 context contains [policy] teaching line", ctx2.includes("[policy]") && ctx2.includes("default to a 1s timeout")],
  STAMP_ON
    ? ["turn-2 context contains ambient stamp with $0.030", ctx2.includes("⏱") && /remaining/.test(ctx2) && ctx2.includes("$0.030 spent")]
    : ["turn-2 context has NO stamp (arm B)", !ctx2.includes("⏱")],
];
let ok = true;
for (const [name, pass] of checks) { console.log((pass ? "PASS" : "FAIL"), name); ok &&= pass; }
if (!ok) { console.log("\n--- turn-2 context ---\n", ctx2.slice(0, 3000)); process.exit(1); }
console.log("all green");

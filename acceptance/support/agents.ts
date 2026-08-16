/**
 * Scripted agent behaviours the tests reuse.
 *
 * A note on counting: the script is indexed by *model request*, not by
 * iteration. Within one iteration the agent is asked again after each batch of
 * tool results, so an iteration that calls one tool costs two requests — the
 * call, then the turn that ends after seeing the result.
 */
import { scriptedProvider, type ScriptedTurn } from "./scripted-provider.ts";
import { CORRECT_IMPLEMENTATION } from "./job.ts";

const writeEntry = (content: string): ScriptedTurn => ({
  tools: [{ name: "write_entry", arguments: { content } }],
});

const say = (text: string): ScriptedTurn => ({ text });

/** Writes a working implementation on the first turn, then ends. */
export function buildsCorrectly(implementation = CORRECT_IMPLEMENTATION) {
  return scriptedProvider({
    respond: (request) => (request === 0 ? writeEntry(implementation) : say("Implemented.")),
  });
}

/** Writes the given implementation once, then keeps ending turns without acting. */
export function buildsOnceThenIdles(implementation: string) {
  return scriptedProvider({
    respond: (request) => (request === 0 ? writeEntry(implementation) : say("Nothing further.")),
  });
}

/** Never calls a mutating tool. Reads only, so the workspace never changes. */
export function neverActs() {
  return scriptedProvider({
    respond: () => say("I have considered the problem."),
  });
}

/** Keeps writing, never converges. Two requests per iteration. */
export function churnsForever(options: { usagePerTurn?: number; priced?: boolean } = {}) {
  const output = options.usagePerTurn ?? 200;
  return scriptedProvider({
    priced: options.priced ?? true,
    respond: (request) =>
      request % 2 === 0
        ? { ...writeEntry(`export const attempt${request} = ${request};\n`), usage: { output } }
        : { ...say("Trying again."), usage: { output } },
  });
}

/** Calls one named tool with the given arguments, then ends. */
export function callsTool(name: string, args: Record<string, unknown>) {
  return scriptedProvider({
    respond: (request) => (request === 0 ? { tools: [{ name, arguments: args }] } : say("Done.")),
  });
}

/** The provider fails the way an outage does, past whatever retries exist. */
export function providerOutage(message = "upstream connect error") {
  return scriptedProvider({
    respond: () => ({ fail: message }),
  });
}

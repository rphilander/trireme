/**
 * measure-worker.ts — the scoring loop measure.ts runs inside a worker thread.
 *
 * An interpreter under test is arbitrary generated code: it can loop forever on
 * a case it has never seen (a statements edge, a pathological coercion). Sync
 * JS cannot be interrupted in-process, so the loop lives here; the parent
 * watches per-case progress and terminates + respawns the worker past a case
 * that exceeds its time budget, recording it as a fail.
 *
 * Protocol: workerData = { runId, harness, cases, startAt }; posts
 * { i, pass } after each case, then { done: true }.
 */
import { parentPort, workerData } from "node:worker_threads";
import { judge, type Case } from "./test262.ts";
import { loadArtifact } from "./artifact.ts";

const { target, harness, cases, startAt } = workerData as {
  target: string; // a run id, or a file:// URL of an entry module to import directly
  harness: string;
  cases: Case[];
  startAt: number;
};

const { run } = target.startsWith("file://") ? await import(target) : await loadArtifact(target);
for (let i = startAt; i < cases.length; i++) {
  const c = cases[i];
  const pass = judge(run, harness, c.body, c.expected);
  parentPort!.postMessage({ i, pass });
}
parentPort!.postMessage({ done: true });

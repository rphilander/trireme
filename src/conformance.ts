/**
 * Trireme's own conformance check, the same one it generates for every job it
 * runs: the implementation and the contract must be mutually assignable.
 *
 * It is type-level only and emits nothing. If `contract.d.ts` and `src/index.ts`
 * drift apart, this file stops compiling.
 */
import type * as Contract from "../contract.d.ts";
import type * as Implementation from "./index.ts";

const implementationMeetsContract: typeof Contract = null as unknown as typeof Implementation;
const contractCoversImplementation: typeof Implementation = null as unknown as typeof Contract;

void implementationMeetsContract;
void contractCoversImplementation;

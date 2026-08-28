/**
 * platform/values/services-admin — the READ side of the trace service.
 * Harness/shell only: agent worlds never carry this module (composer
 * omits it) and the lint bans importing it from logic code. That
 * asymmetry is what makes trace() benign.
 */
import type { Value } from './core.js';
export declare const sink: Value[];
export declare const drainTrace: () => Value[];

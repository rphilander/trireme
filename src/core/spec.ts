/**
 * Structural validation of a job's `spec.md`.
 *
 * Trireme cannot judge whether a specification is good, so it checks the one
 * thing it can: that the sections a job needs exist and say something. Fenced
 * code blocks are skipped, because a spec that shows a heading in an example
 * is not thereby providing that section.
 */
import type { Diagnostic } from "./types.ts";

export const SPEC_FILE = "spec.md";

export const REQUIRED_SECTIONS: readonly string[] = [
  "Purpose",
  "Public API",
  "Behavior",
  "Constraints",
  "Non-goals",
];

export interface SpecSection {
  title: string;
  body: string;
}

/** The `##` sections of a markdown document, in order, ignoring fenced code. */
export function sectionsOf(text: string): SpecSection[] {
  const sections: SpecSection[] = [];
  let current: { title: string; lines: string[] } | undefined;
  let fence: string | undefined;

  for (const line of text.split("\n")) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      current?.lines.push(line);
      continue;
    }

    const heading = fence === undefined ? /^##[ \t]+(.+?)[ \t]*$/.exec(line) : null;
    if (heading) {
      if (current) sections.push({ title: current.title, body: current.lines.join("\n") });
      current = { title: heading[1]!.trim(), lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  if (current) sections.push({ title: current.title, body: current.lines.join("\n") });
  return sections;
}

/** `undefined` means the file was not there. */
export function validateSpec(text: string | undefined): Diagnostic[] {
  if (text === undefined) {
    return [{ message: `${SPEC_FILE} is missing from the job directory.` }];
  }

  const sections = sectionsOf(text);
  const diagnostics: Diagnostic[] = [];

  for (const required of REQUIRED_SECTIONS) {
    const found = sections.find((s) => s.title.toLowerCase() === required.toLowerCase());
    if (!found) {
      diagnostics.push({
        field: required,
        message: `${SPEC_FILE} has no "## ${required}" section.`,
      });
    } else if (found.body.trim().length === 0) {
      diagnostics.push({
        field: required,
        message: `${SPEC_FILE} section "## ${required}" is empty.`,
      });
    }
  }
  return diagnostics;
}

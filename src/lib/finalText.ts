import { runSegments } from "./segments";
import type { RunDoc } from "./types";

/**
 * The group's "final version": the text with every correction accepted. Words that a reviewer struck through are
 * left out, and nobody's colour, name or comment comes with it, so it can be handed in as it is.
 * One entry per line of the text; empty lines between paragraphs are kept, empty ones at the start and end dropped.
 */
export function finalLines(runs: Pick<RunDoc, "studentId" | "alias" | "colorIndex" | "text" | "segments">[]): string[] {
  const lines = runs.flatMap((r) =>
    runSegments(r)
      .filter((s) => !s.struck)
      .map((s) => s.text)
      .join("")
      // Removing a word can leave two spaces (or a space before the full stop) behind.
      .split("\n")
      .map((l) => l.replace(/ {2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim())
  );
  const first = lines.findIndex((l) => l.length > 0);
  if (first === -1) return [];
  let last = lines.length - 1;
  while (last > first && lines[last].length === 0) last--;
  return lines.slice(first, last + 1);
}

export function finalText(runs: Parameters<typeof finalLines>[0]): string {
  return finalLines(runs).join("\n");
}

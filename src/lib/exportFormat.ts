import { runSegments } from "./segments";
import type { FeedbackDoc, RunDoc } from "./types";

/**
 * Turns a group's ordered writing runs into a single readable block of text,
 * attributing each stretch of text to whoever wrote it. Used in CSV exports
 * (so a grading column shows what the feedback beside it was actually about).
 * Each line of the group's text is one line here; empty lines between are kept.
 */
export function runsToText(runs: RunDoc[]): string {
  const lines = runs.map((r) =>
    runSegments(r)
      .map((seg) => `${seg.alias}: ${seg.text.trim()}`)
      .join(" ")
  );
  const first = lines.findIndex((l) => l.trim().length > 0);
  if (first === -1) return "";
  let last = lines.length - 1;
  while (last > first && lines[last].trim().length === 0) last--;
  return lines.slice(first, last + 1).join("\n");
}

/** A comment as one piece of text; a comment on highlighted words says which words. */
export function feedbackText(e: Pick<FeedbackDoc, "text" | "quote">): string {
  return e.quote ? `[About: "${e.quote}"] ${e.text}` : e.text;
}

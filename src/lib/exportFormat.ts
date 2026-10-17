import { runSegments } from "./segments";
import type { RunDoc } from "./types";

/**
 * Turns a group's ordered writing runs into a single readable block of text,
 * attributing each stretch of text to whoever wrote it. Used both in CSV exports
 * (so a grading column shows what the feedback below it was actually about)
 * and in the printable/PDF view.
 */
export function runsToText(runs: RunDoc[]): string {
  return runs
    .filter((r) => r.text.trim().length > 0)
    .map((r) =>
      runSegments(r)
        .map((seg) => `${seg.alias}: ${seg.text.trim()}`)
        .join(" ")
    )
    .join("\n\n");
}

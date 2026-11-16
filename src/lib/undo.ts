import { mergeSegments, sameSegs } from "./segments";
import type { Segment } from "./types";

/** One undo step: the whole text (all paragraphs, joined with newlines) before and after a burst of editing. */
export interface HistoryEntry {
  before: Segment[];
  after: Segment[];
  /** "del" or "ins": typing and deleting are separate steps. */
  kind: string;
  /** When the last edit in this step happened (ms). */
  at: number;
}

const PAUSE_MS = 1500;
const MAX_STEPS = 100;

/**
 * Notes an edit. Edits of the same kind that follow each other quickly belong to one step, so one undo takes back a
 * whole burst of typing (or one big deletion), not a single letter.
 */
export function recordEdit(stack: HistoryEntry[], before: Segment[], after: Segment[], kind: string, now: number): void {
  if (sameSegs(before, after)) return;
  const last = stack[stack.length - 1];
  if (last && last.kind === kind && now - last.at < PAUSE_MS && sameSegs(last.after, before)) {
    last.after = after;
    last.at = now;
    return;
  }
  stack.push({ before, after, kind, at: now });
  if (stack.length > MAX_STEPS) stack.shift();
}

/**
 * The text after taking back `entry` from the text as it is now. If other people changed the text since, their changes
 * stay. If somebody changed the very same stretch, nothing is undone (returns null), so nobody's words are overwritten.
 */
export function undoOnto(entry: Pick<HistoryEntry, "before" | "after">, current: Segment[]): Segment[] | null {
  if (sameSegs(current, entry.after)) return entry.before;
  const merged = mergeSegments(entry.after, current, entry.before);
  return sameSegs(merged, current) ? null : merged;
}

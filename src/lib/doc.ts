import { applyEdit, normalize, segmentsText } from "./segments";
import type { Author } from "./segments";
import type { Segment } from "./types";

/**
 * The group's text is stored as a list of paragraphs ("runs"), but students see and edit it as ONE
 * text box. These helpers convert between the two views. In the one-box view the paragraphs are
 * joined with "\n"; every character keeps track of who wrote it.
 */

/** Joins paragraphs into one list of segments, with a newline between paragraphs. */
export function flatten(paras: Segment[][]): Segment[] {
  const out: Segment[] = [];
  paras.forEach((p, i) => {
    if (i > 0) out.push({ studentId: "", alias: "", colorIndex: 0, text: "\n" });
    out.push(...p);
  });
  return normalize(out);
}

/** Cuts a flat list of segments back into paragraphs at every newline. Always returns at least one paragraph. */
export function splitParagraphs(segs: Segment[]): Segment[][] {
  const paras: Segment[][] = [[]];
  for (const s of segs) {
    s.text.split("\n").forEach((part, i) => {
      if (i > 0) paras.push([]);
      if (part) paras[paras.length - 1].push({ ...s, text: part });
    });
  }
  return paras.map(normalize);
}

/** Works out the new paragraphs after the box content changed to `newText` (caret = flat offset after the edit). */
export function editParagraphs(oldParas: Segment[][], newText: string, caret: number, author: Author): Segment[][] {
  const oldFlat = flatten(oldParas.length ? oldParas : [[]]);
  let next = applyEdit(oldFlat, newText, caret, author);
  if (segmentsText(next) !== newText) next = newText ? [{ ...author, text: newText }] : [];
  return splitParagraphs(next);
}

function sameSegments(a: Segment[], b: Segment[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.studentId === b[i].studentId && s.text === b[i].text);
}

export interface PlannedRun {
  id: string;
  order: number;
  segments: Segment[];
  /** same = untouched, update = text changed, create = new paragraph */
  kind: "same" | "update" | "create";
  /** true if the sort position changed (so the order field must be written) */
  orderChanged: boolean;
}

export interface Plan {
  runs: PlannedRun[];
  deletes: string[];
}

export interface RunLike {
  id: string;
  order: number;
  segments: Segment[];
}

/**
 * Compares the stored paragraphs with the new ones and decides which stored paragraph is kept,
 * which are created and which deleted. Unchanged paragraphs at the start and the end are left alone;
 * the changed block in the middle reuses the old paragraphs in order.
 */
export function planChanges(old: RunLike[], next: Segment[][], newId: () => string): Plan {
  let i = 0;
  while (i < old.length && i < next.length && sameSegments(old[i].segments, next[i])) i++;
  let j = 0;
  while (
    j < old.length - i &&
    j < next.length - i &&
    sameSegments(old[old.length - 1 - j].segments, next[next.length - 1 - j])
  )
    j++;

  const oldMid = old.slice(i, old.length - j);
  const newMid = next.slice(i, next.length - j);
  const m = newMid.length;

  const before = i > 0 ? old[i - 1].order : null;
  const after = j > 0 ? old[old.length - j].order : null;
  const orderFor = (k: number): number => {
    if (before !== null && after !== null) return before + ((after - before) * (k + 1)) / (m + 1);
    if (before !== null) return before + (k + 1);
    if (after !== null) return after - (m - k);
    return k + 1;
  };
  const reorder = oldMid.length !== m;

  const runs: PlannedRun[] = [];
  for (let k = 0; k < i; k++) runs.push({ ...old[k], segments: next[k], kind: "same", orderChanged: false });
  newMid.forEach((segments, k) => {
    const prev = oldMid[k];
    if (prev) {
      const order = reorder ? orderFor(k) : prev.order;
      runs.push({
        id: prev.id,
        order,
        segments,
        kind: sameSegments(prev.segments, segments) ? "same" : "update",
        orderChanged: order !== prev.order,
      });
    } else {
      runs.push({ id: newId(), order: orderFor(k), segments, kind: "create", orderChanged: true });
    }
  });
  for (let k = 0; k < j; k++) {
    const o = old[old.length - j + k];
    runs.push({ ...o, segments: next[next.length - j + k], kind: "same", orderChanged: false });
  }
  return { runs, deletes: oldMid.slice(m).map((r) => r.id) };
}

/**
 * Combines the paragraphs just received from the server with what this browser knows locally.
 * Paragraphs with unsent edits keep the local version; paragraphs just created here stay even if
 * the server has not echoed them yet; paragraphs just deleted here stay gone.
 */
export function mergeRemote<T extends RunLike>(
  local: T[],
  remote: T[],
  dirty: Set<string>,
  pendingCreates: Set<string>,
  pendingDeletes: Set<string>
): T[] {
  const localById = new Map(local.map((r) => [r.id, r]));
  const remoteIds = new Set(remote.map((r) => r.id));
  const out: T[] = remote
    .filter((r) => !pendingDeletes.has(r.id))
    .map((r) => (dirty.has(r.id) && localById.has(r.id) ? (localById.get(r.id) as T) : r));
  local.forEach((r) => {
    if (pendingCreates.has(r.id) && !remoteIds.has(r.id)) out.push(r);
  });
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export interface Anchor {
  start: number;
  end: number;
  quote: string;
}

/**
 * Finds where a comment's highlighted text is now. If the text at the old position is unchanged it
 * stays there; otherwise the closest copy of the quoted text is used; if there is none, null.
 */
export function resolveAnchor(docText: string, a: Anchor): { start: number; end: number } | null {
  if (!a.quote) return null;
  if (docText.slice(a.start, a.end) === a.quote) return { start: a.start, end: a.end };
  let best = -1;
  let from = 0;
  for (;;) {
    const at = docText.indexOf(a.quote, from);
    if (at === -1) break;
    if (best === -1 || Math.abs(at - a.start) < Math.abs(best - a.start)) best = at;
    from = at + 1;
  }
  return best === -1 ? null : { start: best, end: best + a.quote.length };
}

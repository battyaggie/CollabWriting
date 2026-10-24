import type { RunDoc, Segment } from "./types";

export type Author = Pick<Segment, "studentId" | "alias" | "colorIndex">;

/** Drops empty segments and joins neighbours written by the same student. */
export function normalize(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && last.studentId === s.studentId) {
      out[out.length - 1] = { ...last, text: last.text + s.text };
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

export function segmentsText(segs: Segment[]): string {
  return segs.map((s) => s.text).join("");
}

/** The segments of a paragraph; older documents without segments count as written by the paragraph's author. */
export function runSegments(run: Pick<RunDoc, "studentId" | "alias" | "colorIndex" | "text" | "segments">): Segment[] {
  if (run.segments && segmentsText(run.segments) === run.text) return normalize(run.segments);
  if (!run.text) return [];
  return [{ studentId: run.studentId, alias: run.alias, colorIndex: run.colorIndex, text: run.text }];
}

/** Splits at a character offset into [before, after]; authorship of every character is kept. */
export function splitAt(segs: Segment[], offset: number): [Segment[], Segment[]] {
  const before: Segment[] = [];
  const after: Segment[] = [];
  let pos = 0;
  for (const s of segs) {
    const end = pos + s.text.length;
    if (end <= offset) before.push(s);
    else if (pos >= offset) after.push(s);
    else {
      before.push({ ...s, text: s.text.slice(0, offset - pos) });
      after.push({ ...s, text: s.text.slice(offset - pos) });
    }
    pos = end;
  }
  return [normalize(before), normalize(after)];
}

/** True if both paragraphs have the same text written by the same people. */
export function sameSegs(a: Segment[], b: Segment[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.studentId === b[i].studentId && s.text === b[i].text);
}

/** "Base text from `start` to `end` was replaced by `insert`." */
interface Change {
  start: number;
  end: number;
  insert: Segment[];
}

/** The single stretch that differs between two versions of a paragraph, or null if the text is the same. */
function changeBetween(base: Segment[], next: Segment[]): Change | null {
  const b = segmentsText(base);
  const n = segmentsText(next);
  if (b === n) return null;
  const max = Math.min(b.length, n.length);
  let head = 0;
  while (head < max && b[head] === n[head]) head++;
  let tail = 0;
  while (tail < max - head && b[b.length - 1 - tail] === n[n.length - 1 - tail]) tail++;
  const [, fromHead] = splitAt(next, head);
  const [insert] = splitAt(fromHead, n.length - head - tail);
  return { start: head, end: b.length - tail, insert };
}

/**
 * Three-way merge of one paragraph. `base` is the version both people started from, `local` is what
 * this browser has now, `remote` is what the server has now. If the two changes are in different
 * places, both are kept (with authorship). If they overlap, the local version wins.
 */
export function mergeSegments(base: Segment[], local: Segment[], remote: Segment[]): Segment[] {
  if (sameSegs(local, remote)) return local;
  const lc = changeBetween(base, local);
  const rc = changeBetween(base, remote);
  if (!rc) return local;
  if (!lc) return remote;

  const bothInsertAtSamePoint = rc.start === rc.end && lc.start === lc.end && rc.start === lc.start;
  let first: Change;
  let second: Change;
  if (!bothInsertAtSamePoint && rc.end <= lc.start) {
    first = rc;
    second = lc;
  } else if (!bothInsertAtSamePoint && lc.end <= rc.start) {
    first = lc;
    second = rc;
  } else {
    return local;
  }
  const [pre] = splitAt(base, first.start);
  const [mid] = splitAt(splitAt(base, first.end)[1], second.start - first.end);
  const [, post] = splitAt(base, second.end);
  return normalize([...pre, ...first.insert, ...mid, ...second.insert, ...post]);
}

/**
 * Works out what the typist just did (deleted some text and/or inserted some) by
 * comparing the old paragraph text with the new one, then applies it to the segments:
 * removed characters disappear, inserted characters belong to `author`.
 *
 * `caret` is the caret position after the edit. Typing happens just before the caret,
 * so everything after the caret is unchanged; that pins the edit to the right place
 * even when the same letters repeat ("aaa" + "a").
 */
export function applyEdit(segs: Segment[], newText: string, caret: number, author: Author): Segment[] {
  const oldText = segmentsText(segs);
  if (oldText === newText) return segs;

  let tail = newText.length - Math.min(Math.max(caret, 0), newText.length);
  if (tail > oldText.length || !oldText.endsWith(newText.slice(newText.length - tail))) {
    // Caret unknown or unhelpful: fall back to a plain common-prefix / common-suffix comparison.
    tail = 0;
    const max = Math.min(oldText.length, newText.length);
    while (tail < max && oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]) tail++;
  }
  const oldEnd = oldText.length - tail;
  const newEnd = newText.length - tail;
  let head = 0;
  const maxHead = Math.min(oldEnd, newEnd);
  while (head < maxHead && oldText[head] === newText[head]) head++;

  const inserted = newText.slice(head, newEnd);
  const [left] = splitAt(segs, head);
  const [, right] = splitAt(segs, oldEnd);
  const middle: Segment[] = inserted ? [{ ...author, text: inserted }] : [];
  return normalize([...left, ...middle, ...right]);
}

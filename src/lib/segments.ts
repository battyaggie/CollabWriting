import { isTeacherColor } from "./colors";
import type { RunDoc, Segment } from "./types";

export type Author = Pick<Segment, "studentId" | "alias" | "colorIndex">;

/** Drops empty segments and joins neighbours written by the same student. */
export function normalize(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && last.studentId === s.studentId && !!last.struck === !!s.struck && last.struckBy === s.struckBy) {
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
  return a.every((s, i) => s.studentId === b[i].studentId && s.text === b[i].text && !!s.struck === !!b[i].struck && s.struckBy === b[i].struckBy);
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
 * places, both are kept (with authorship); so are two insertions at the same spot. If they overlap otherwise, the local version wins.
 */
export function mergeSegments(base: Segment[], local: Segment[], remote: Segment[]): Segment[] {
  if (sameSegs(local, remote)) return local;
  const lc = changeBetween(base, local);
  const rc = changeBetween(base, remote);
  if (!rc) return local;
  if (!lc) return remote;

  if (rc.start === rc.end && lc.start === lc.end && rc.start === lc.start) {
    // Both people added text at exactly the same spot: keep both (the server's first), so nobody's words disappear.
    const [before, after] = splitAt(base, lc.start);
    return normalize([...before, ...rc.insert, ...lc.insert, ...after]);
  }
  let first: Change;
  let second: Change;
  if (rc.end <= lc.start) {
    first = rc;
    second = lc;
  } else if (lc.end <= rc.start) {
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
 * What a reviewer's deletion leaves behind: other people's words stay in the text, struck through (still in their
 * author's colour), so the writers can see what was there. The reviewer's own words are really removed, and words that
 * are already struck through stay as they are. Line breaks are not kept (paragraphs simply join).
 */
function strikeRemoved(removed: Segment[], authorId: string, deleterColor?: number): Segment[] {
  const out: Segment[] = [];
  for (const s of removed) {
    if (s.studentId === authorId && !s.struck) continue;
    const text = s.text.split("\n").join("");
    if (!text) continue;
    // Words the teacher deletes turn red; words that were already struck through keep whatever they had.
    if (s.struck) out.push({ ...s, text });
    else if (deleterColor !== undefined) out.push({ ...s, text, struck: true, struckBy: deleterColor });
    else out.push({ ...s, text, struck: true });
  }
  return normalize(out);
}

/** The part of `segs` between two character offsets; authorship of every character is kept. */
function sliceSegs(segs: Segment[], from: number, to: number): Segment[] {
  const [, rest] = splitAt(segs, from);
  return splitAt(rest, to - from)[0];
}

/** A stretch that changed: old characters [oldFrom, oldTo) were replaced by new characters [newFrom, newTo). */
interface Hunk {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

/** Words, runs of spaces, and single punctuation marks. */
function tokenize(s: string): string[] {
  return s.match(/[\p{L}\p{N}_]+|\s+|[^]/gu) ?? [];
}

/** Largest (old tokens x new tokens) comparison we do; bigger edits are treated as one replaced block. */
const MAX_DIFF_CELLS = 250_000;

/**
 * Finds the stretches that really changed between two texts. Words that are the same on both sides stay unchanged,
 * so when one edit touches several places (autocorrect, undo, a browser extension...) the text in between keeps its
 * author. A matching stretch shorter than 3 characters (a lone space, "a") is not worth keeping apart: it is counted
 * as changed, so a replaced phrase is not cut into confetti.
 */
function diffHunks(a: string, b: string): Hunk[] {
  const whole: Hunk[] = a === b ? [] : [{ oldFrom: 0, oldTo: a.length, newFrom: 0, newTo: b.length }];
  if (!a || !b || a === b) return whole;
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = ta.length;
  const m = tb.length;
  if (n * m > MAX_DIFF_CELLS) return whole;

  // Longest common subsequence of tokens.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = ta[i] === tb[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  if (lcs[0] === 0) return whole;

  // Character offset where each token starts.
  const offA: number[] = [0];
  for (const t of ta) offA.push(offA[offA.length - 1] + t.length);
  const offB: number[] = [0];
  for (const t of tb) offB.push(offB[offB.length - 1] + t.length);

  // Walk through both, collecting runs of matching tokens.
  const runs: { oldFrom: number; oldTo: number; newFrom: number; newTo: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      const si = i;
      const sj = j;
      while (i < n && j < m && ta[i] === tb[j]) {
        i++;
        j++;
      }
      runs.push({ oldFrom: offA[si], oldTo: offA[i], newFrom: offB[sj], newTo: offB[j] });
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) i++;
    else j++;
  }

  const keep = runs.filter((r) => a.slice(r.oldFrom, r.oldTo).trim().length >= 3);
  const hunks: Hunk[] = [];
  let oi = 0;
  let ni = 0;
  for (const r of keep) {
    if (r.oldFrom > oi || r.newFrom > ni) hunks.push({ oldFrom: oi, oldTo: r.oldFrom, newFrom: ni, newTo: r.newFrom });
    oi = r.oldTo;
    ni = r.newTo;
  }
  if (oi < a.length || ni < b.length) hunks.push({ oldFrom: oi, oldTo: a.length, newFrom: ni, newTo: b.length });
  return hunks;
}

export interface EditResult {
  segs: Segment[];
  /**
   * The words kept as struck-through: for each stretch, where (in the new text, i.e. without the struck words)
   * it sits and how many characters it is. In order.
   */
  kept: { at: number; len: number }[];
  /** How many characters were typed or pasted in this edit. */
  insertedLen: number;
}

/**
 * Works out what the typist just did (deleted some text and/or inserted some) by
 * comparing the old paragraph text with the new one, then applies it to the segments:
 * inserted characters belong to `author`; removed characters disappear, except when `track` is on (a reviewer
 * correcting someone else's text): then other people's removed words stay, struck through.
 * Text that is the same before and after keeps its author, even if the edit touched several places at once.
 *
 * `caret` is the caret position after the edit. Typing happens just before the caret,
 * so everything after the caret is unchanged; that pins the edit to the right place
 * even when the same letters repeat ("aaa" + "a").
 */
export function applyEdit(segs: Segment[], newText: string, caret: number, author: Author, track = false): EditResult {
  const oldText = segmentsText(segs);
  if (oldText === newText) return { segs, kept: [], insertedLen: 0 };

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

  // Inside the stretch between head and tail, find what really changed (usually it is all one change).
  const hunks = diffHunks(oldText.slice(head, oldEnd), newText.slice(head, newEnd));

  const out: Segment[] = [];
  const kept: { at: number; len: number }[] = [];
  let insertedLen = 0;
  let oldPos = 0; // how much of the old text is already in `out`
  let visible = 0; // length of `out` without the struck words that were kept
  const copyOld = (to: number) => {
    if (to > oldPos) {
      out.push(...sliceSegs(segs, oldPos, to));
      visible += to - oldPos;
      oldPos = to;
    }
  };
  for (const h of hunks) {
    copyOld(head + h.oldFrom);
    const struck = track ? strikeRemoved(sliceSegs(segs, head + h.oldFrom, head + h.oldTo), author.studentId, isTeacherColor(author.colorIndex) ? author.colorIndex : undefined) : [];
    const keptLen = segmentsText(struck).length;
    if (keptLen > 0) {
      out.push(...struck);
      kept.push({ at: visible, len: keptLen });
    }
    const inserted = newText.slice(head + h.newFrom, head + h.newTo);
    if (inserted) {
      out.push({ ...author, text: inserted });
      visible += inserted.length;
      insertedLen += inserted.length;
    }
    oldPos = head + h.oldTo;
  }
  copyOld(oldText.length);
  return { segs: normalize(out), kept, insertedLen };
}

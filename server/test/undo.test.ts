// Undo of one's own last change.
// Run with: npx tsx --test server/test/undo.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { recordEdit, undoOnto, type HistoryEntry } from "../../src/lib/undo";
import { applyEdit, segmentsText } from "../../src/lib/segments";
import type { Segment } from "../../src/lib/types";

const A = { studentId: "A", alias: "Ann", colorIndex: 1 };
const B = { studentId: "B", alias: "Ben", colorIndex: 2 };
const show = (segs: Segment[]) => segs.map((s) => `${s.studentId}${s.struck ? "~" : ""}[${s.text}]`).join(" ");
const start: Segment[] = [{ ...A, text: "The quick brown fox jumps over the lazy dog." }];

test("undo after a reviewer deleted too much brings the words back", () => {
  const cut = "The dog.";
  const after = applyEdit(start, cut, 4, B, true).segs; // reviewer's deletion: words stay struck through
  const stack: HistoryEntry[] = [];
  recordEdit(stack, start, after, "del", 0);
  assert.deepEqual(undoOnto(stack[0], after), start);
});

test("undo after deleting in a normal text restores the words and their authors", () => {
  const after = applyEdit(start, "The dog.", 4, B).segs;
  assert.equal(segmentsText(after), "The dog.");
  assert.equal(show(undoOnto({ before: start, after }, after)!), show(start));
});

test("someone else typed elsewhere meanwhile: their words stay, the deletion is still undone", () => {
  const after = applyEdit(start, "The quick brown fox.", 19, B).segs; // B cut "jumps over the lazy dog"
  const current = applyEdit(after, "The quick brown fox. Bye", 24, A).segs; // A added " Bye" at the end
  const r = undoOnto({ before: start, after }, current)!;
  assert.equal(segmentsText(r), "The quick brown fox jumps over the lazy dog. Bye");
  assert.equal(show(r), "A[The quick brown fox jumps over the lazy dog. Bye]");
});

test("someone else changed the very words the undo would replace: nothing is undone", () => {
  const after = applyEdit(start, "The quick brown fox hops over the lazy dog.", 23, B).segs; // B: "jumps" -> "hops"
  const current = applyEdit(after, "The quick brown fox leaps over the lazy dog.", 25, A).segs; // A: "hops" -> "leaps"
  assert.equal(undoOnto({ before: start, after }, current), null);
});

test("a change right next to the restored words does not block the undo", () => {
  const after = applyEdit(start, "The quick brown fox.", 19, B).segs;
  const current = applyEdit(after, "The quick brown cat.", 19, A).segs;
  assert.equal(segmentsText(undoOnto({ before: start, after }, current)!), "The quick brown cat jumps over the lazy dog.");
});

test("a quick burst of typing is one step; a pause or switching to deleting starts a new one", () => {
  const stack: HistoryEntry[] = [];
  const s0 = start;
  const s1 = applyEdit(s0, "The quick brown fox jumps over the lazy dog.!", 44, B).segs;
  const s2 = applyEdit(s1, "The quick brown fox jumps over the lazy dog.!?", 45, B).segs;
  recordEdit(stack, s0, s1, "ins", 1000);
  recordEdit(stack, s1, s2, "ins", 1200);
  assert.equal(stack.length, 1);
  assert.deepEqual(stack[0].before, s0);
  assert.deepEqual(stack[0].after, s2);
  const s3 = applyEdit(s2, "The quick brown fox.", 19, B).segs;
  recordEdit(stack, s2, s3, "del", 1300);
  assert.equal(stack.length, 2);
  recordEdit(stack, s3, s0, "ins", 9000);
  assert.equal(stack.length, 3);
});

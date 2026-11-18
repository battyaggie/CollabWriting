// Who-wrote-what when text is edited: only what was really typed takes the editor's colour.
// Run with: npx tsx --test server/test/authorship.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { applyEdit, segmentsText } from "../../src/lib/segments";
import { editParagraphs } from "../../src/lib/doc";
import type { Segment } from "../../src/lib/types";

const A = { studentId: "A", alias: "Ann", colorIndex: 1 };
const B = { studentId: "B", alias: "Ben", colorIndex: 2 };
const sentence: Segment[] = [{ ...A, text: "The quick brown fox jumps over the lazy dog." }];

/** "A[The ] B[red] ..." style summary: who wrote which text (struck-through words marked with ~). */
const show = (segs: Segment[]) => segs.map((s) => `${s.studentId}${s.struck ? "~" : ""}[${s.text}]`).join(" ");

test("replacing one word: only the new word is the editor's", () => {
  const t = "The quick red fox jumps over the lazy dog.";
  const r = applyEdit(sentence, t, t.indexOf("red") + 3, B);
  assert.equal(show(r.segs), "A[The quick ] B[red] A[ fox jumps over the lazy dog.]");
});

test("one edit changing two places keeps the words in between", () => {
  const t = "The slow brown fox jumps over the sleepy dog.";
  const r = applyEdit(sentence, t, t.indexOf("sleepy") + 6, B);
  assert.equal(segmentsText(r.segs), t);
  assert.equal(show(r.segs), "A[The ] B[slow] A[ brown fox jumps over the ] B[sleepy] A[ dog.]");
});

test("works the same without a usable caret", () => {
  const t = "The slow brown fox jumps over the tired dog.";
  assert.equal(show(applyEdit(sentence, t, 0, B).segs), "A[The ] B[slow] A[ brown fox jumps over the ] B[tired] A[ dog.]");
});

test("a replaced phrase stays one block (no confetti from matching spaces)", () => {
  const t = "The slow red cat jumps over the lazy dog.";
  assert.equal(show(applyEdit(sentence, t, t.indexOf("cat") + 3, B).segs), "A[The ] B[slow red cat] A[ jumps over the lazy dog.]");
});

test("an insertion and a deletion in one edit", () => {
  const t = "The very quick brown fox jumps over the dog.";
  assert.equal(show(applyEdit(sentence, t, t.indexOf("dog"), B).segs), "A[The ] B[very ] A[quick brown fox jumps over the dog.]");
});

test("tracked changes: each removed word stays struck through in its own place", () => {
  const t = "The slow brown fox jumps over the sleepy dog.";
  const r = applyEdit(sentence, t, t.indexOf("sleepy") + 6, B, true);
  assert.equal(show(r.segs), "A[The ] A~[quick] B[slow] A[ brown fox jumps over the ] A~[lazy] B[sleepy] A[ dog.]");
  assert.deepEqual(r.kept.map((k) => k.len), [5, 4]);
});

test("a reviewer's own words are really removed, not struck through", () => {
  const mixed: Segment[] = [
    { ...A, text: "The quick " },
    { ...B, text: "brown" },
    { ...A, text: " fox jumps over the lazy dog." },
  ];
  const t = "The quick red fox jumps over the lazy dog.";
  assert.equal(show(applyEdit(mixed, t, t.indexOf("red") + 3, B, true).segs), "A[The quick ] B[red] A[ fox jumps over the lazy dog.]");
});

test("editParagraphs: the text of every paragraph keeps its authors, and the caret moves past struck words", () => {
  const paras: Segment[][] = [[{ ...A, text: "One two three." }], [{ ...A, text: "Four five six." }]];
  const t = "One 2 three.\nFour 5 six.";
  const r = editParagraphs(paras, t, t.length - 5, B, false, true);
  assert.deepEqual(r.paras.map(show), ["A[One ] A~[two] B[2] A[ three.]", "A[Four ] A~[five] B[5] A[ six.]"]);
  // Caret is just after "5" in the box; the struck "two" (3) and "five" (4) in front of it are not in the box.
  assert.equal(r.caretShift, 7);
});

test("editParagraphs: nothing is ever recoloured wholesale", () => {
  const paras: Segment[][] = [[{ ...A, text: "Alpha beta gamma delta epsilon zeta." }]];
  const t = "Alpha BETA gamma delta EPSILON zeta.";
  const r = editParagraphs(paras, t, t.indexOf("EPSILON") + 7, B);
  assert.equal(show(r.paras[0]), "A[Alpha ] B[BETA] A[ gamma delta ] B[EPSILON] A[ zeta.]");
});

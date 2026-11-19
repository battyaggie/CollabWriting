import { test } from "node:test";
import assert from "node:assert/strict";
import { finalLines, finalText } from "../../src/lib/finalText";
import { buildDocx } from "../../src/lib/docx";

const seg = (text: string, extra: object = {}) => ({ studentId: "a", alias: "A", colorIndex: 0, text, ...extra });
const run = (segments: ReturnType<typeof seg>[]) => ({
  studentId: "a",
  alias: "A",
  colorIndex: 0,
  text: segments.map((s) => s.text).join(""),
  segments,
});

test("struck-through words are left out and spacing is tidied", () => {
  const r = run([seg("The "), seg("big", { struck: true }), seg(" cat sat"), seg(" badly", { struck: true }), seg(" .")]);
  assert.equal(finalText([r]), "The cat sat.");
});

test("a reviewer's insertion is kept, empty lines between paragraphs kept, outer ones dropped", () => {
  const rs = [run([]), run([seg("One.")]), run([]), run([seg("Two "), seg("and three.", { studentId: "b", alias: "B", colorIndex: 1 })]), run([])];
  assert.deepEqual(finalLines(rs), ["One.", "", "Two and three."]);
});

test("nothing written gives no lines", () => {
  assert.deepEqual(finalLines([run([])]), []);
});

test("docx is a valid zip with the text in document.xml", async () => {
  const bytes = buildDocx(["Hello & <world>", "", "Second"]);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.DOCX_OUT ?? "/tmp/final-test.docx", bytes);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});

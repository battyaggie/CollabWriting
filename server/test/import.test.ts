// Run with: npx tsx --test server/test/import.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseCsv, parseXlsx, peopleFromRows } from "../../src/backend/local/importFile";

const fixture = (name: string) => {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

test("csv: quotes, semicolons, BOM, header detection, names from several columns", () => {
  const text = '﻿Vorname;Nachname;E-Mail\r\nAnna;"Müller; Jr.";anna@example.org\r\nBob;Brown;bob@example.org\r\n;;\r\n';
  const people = peopleFromRows(parseCsv(text));
  assert.deepEqual(people, [
    { name: "Anna Müller; Jr.", email: "anna@example.org" },
    { name: "Bob Brown", email: "bob@example.org" },
  ]);
  assert.deepEqual(peopleFromRows(parseCsv("a@x.org,Al A\nb@x.org,Bo B")), [
    { name: "Al A", email: "a@x.org" },
    { name: "Bo B", email: "b@x.org" },
  ]);
});

test("xlsx: the first sheet, first name before last name, special characters, rows without email", { skip: !existsSync(new URL("./fixtures/lecturers.xlsx", import.meta.url)) }, async () => {
  const rows = await parseXlsx(fixture("lecturers.xlsx"));
  assert.equal(rows[0][3], "E-Mail");
  const people = peopleFromRows(rows);
  assert.deepEqual(people.filter((p) => p.email), [
    { name: "Mark Adams", email: "mark.adams@example.org" },
    { name: "Anna Müller & Söhne", email: "anna.mueller@example.org" },
    { name: "Bob Brown", email: "bob@example.org" },
  ]);
  assert.deepEqual(people.find((p) => !p.email), { name: "Mail Kein", email: "" });
});

test("xlsx without a header row, email first", { skip: !existsSync(new URL("./fixtures/nohead.xlsx", import.meta.url)) }, async () => {
  assert.deepEqual(peopleFromRows(await parseXlsx(fixture("nohead.xlsx"))), [
    { name: "Alice Archer", email: "alice@example.org" },
    { name: "Bert Bell", email: "bert@example.org" },
  ]);
});

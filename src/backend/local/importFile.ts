/**
 * Reads a list of people (names and email addresses) from an Excel (.xlsx) or CSV file, in the
 * browser, without any extra libraries. Used by the administrator page to create many accounts at once.
 */

export interface Person {
  name: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- CSV ---------- */

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  quoted = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      endCell();
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  endCell();
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/* ---------- Excel (.xlsx is a zip file of XML files) ---------- */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This does not look like an Excel file.");
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<string>>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    files.set(name, async () => {
      const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      const raw = bytes.subarray(dataStart, dataStart + compSize);
      const data = method === 0 ? raw : await inflateRaw(raw);
      return new TextDecoder().decode(data);
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decodeXml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const textOf = (xml: string) =>
  Array.from(xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (m) => decodeXml(m[1])).join("");

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf);
  const read = async (name: string) => (await files.get(name)?.()) ?? "";

  const shared = Array.from((await read("xl/sharedStrings.xml")).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), (m) => textOf(m[1]));

  // The first sheet in the workbook (falls back to the lowest-numbered sheet file).
  let sheetPath = "";
  const rid = /<sheet\b[^>]*r:id="([^"]+)"/.exec(await read("xl/workbook.xml"))?.[1];
  if (rid) {
    const rel = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(await read("xl/_rels/workbook.xml.rels"))?.[0];
    const target = rel && /Target="([^"]+)"/.exec(rel)?.[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  if (!files.has(sheetPath)) {
    sheetPath =
      Array.from(files.keys())
        .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
        .sort((a, b) => parseInt(a.replace(/\D+/g, "")) - parseInt(b.replace(/\D+/g, "")))[0] ?? "";
  }
  if (!sheetPath) throw new Error("No worksheet found in this Excel file.");

  const rows: string[][] = [];
  for (const rowMatch of (await read(sheetPath)).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const body = c[2] ?? "";
      let value = "";
      if (type === "s") value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1])] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      const col = ref ? columnIndex(ref) : row.length;
      while (row.length < col) row.push("");
      row[col] = value.trim();
    }
    if (row.some((c) => c !== "")) rows.push(row);
  }
  return rows;
}

/* ---------- from table rows to people ---------- */

const GIVEN = /vorname|first|given|forename/i;
const FAMILY = /nachname|familienname|last|surname|family/i;
const NAMEISH = /name|person|lecturer|teacher|vortragende/i;

/** Finds the email column (the one full of addresses) and builds a name from the other name-like columns. */
export function peopleFromRows(rows: string[][]): Person[] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  let emailCol = -1;
  let best = 0;
  for (let c = 0; c < width; c++) {
    const n = rows.filter((r) => EMAIL_RE.test((r[c] ?? "").replace(/^mailto:/i, ""))).length;
    if (n > best) {
      best = n;
      emailCol = c;
    }
  }
  if (emailCol < 0) return [];

  const hasHeader = !EMAIL_RE.test((rows[0]?.[emailCol] ?? "").replace(/^mailto:/i, ""));
  const header = hasHeader ? rows[0] : [];
  const body = hasHeader ? rows.slice(1) : rows;

  let nameCols: number[] = [];
  if (hasHeader) {
    const given = header.map((h, i) => (i !== emailCol && GIVEN.test(h) ? i : -1)).filter((i) => i >= 0);
    const family = header.map((h, i) => (i !== emailCol && !GIVEN.test(h) && FAMILY.test(h) ? i : -1)).filter((i) => i >= 0);
    const other = header
      .map((h, i) => (i !== emailCol && !GIVEN.test(h) && !FAMILY.test(h) && NAMEISH.test(h) ? i : -1))
      .filter((i) => i >= 0);
    nameCols = given.length || family.length ? [...given, ...family] : other;
  }
  if (nameCols.length === 0) {
    nameCols = Array.from({ length: width }, (_, i) => i).filter(
      (i) => i !== emailCol && body.some((r) => (r[i] ?? "") !== "" && !/^[\d.,\s-]+$/.test(r[i] ?? ""))
    );
  }

  return body
    .map((r) => ({
      name: nameCols.map((i) => r[i] ?? "").filter(Boolean).join(" ").trim(),
      email: (r[emailCol] ?? "").replace(/^mailto:/i, "").trim(),
    }))
    .filter((p) => p.email !== "" || p.name !== "");
}

/** Reads an uploaded .xlsx / .csv / .txt file into a list of people. */
export async function readPeopleFile(file: File): Promise<Person[]> {
  const isExcel = /\.xlsx$/i.test(file.name) || file.type.includes("spreadsheetml");
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. Please save the file as ".xlsx" or ".csv" first.');
  const rows = isExcel ? await parseXlsx(await file.arrayBuffer()) : parseCsv(await file.text());
  return peopleFromRows(rows);
}

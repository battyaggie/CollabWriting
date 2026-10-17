export function toCsv(rows: string[][]): string {
  const escape = (v: string) => {
    if (v.includes(",") || v.includes("\n") || v.includes('"')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = toCsv(rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

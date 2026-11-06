import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../store.mjs";
import { backupNow } from "../backup.mjs";

test("a backup is a complete, readable copy; only the newest ones are kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "cw-backup-"));
  try {
    const store = new Store(join(dir, "live.sqlite"));
    store.commit([{ op: "set", path: "classes/c1", data: { name: "Writing", teacherId: "t" } }]);
    const out = join(dir, "backups");
    let last;
    for (let i = 0; i < 4; i++) {
      store.commit([{ op: "set", path: `classes/extra${i}`, data: { n: i } }]);
      last = backupNow(store, out, 3, new Date(Date.UTC(2026, 9, 24, 3, i, 0)));
    }
    const files = readdirSync(out);
    assert.equal(files.length, 3, "oldest removed");
    assert.ok(!files.some((f) => f.endsWith(".part")));
    assert.ok(files.includes("collab-writing-2026-10-24T03-03-00Z.sqlite"));
    const copy = new DatabaseSync(last, { readOnly: true });
    const n = copy.prepare("SELECT COUNT(*) AS n FROM docs").get().n;
    assert.equal(n, 5, "contains everything written before the backup");
    copy.close();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StoreError } from "./errors.mjs";

const MAX_DOC_BYTES = 1024 * 1024;

/** "classes/abc/groups/g1" -> { coll: "classes/abc/groups", id: "g1" } */
export function splitPath(path) {
  const i = path.lastIndexOf("/");
  return { coll: path.slice(0, i), id: path.slice(i + 1) };
}

/** Document paths have an even number of parts ("collection/id/collection/id"); no empty parts. */
export function checkDocPath(path) {
  if (typeof path !== "string" || path.length > 1500) throw new StoreError("invalid-argument", "Bad path");
  const parts = path.split("/");
  if (parts.length % 2 !== 0 || parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new StoreError("invalid-argument", `Not a document path: ${path}`);
  }
}

/** Collection paths have an odd number of parts. */
export function checkCollPath(path) {
  if (typeof path !== "string" || path.length > 1500) throw new StoreError("invalid-argument", "Bad path");
  const parts = path.split("/");
  if (parts.length % 2 !== 1 || parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new StoreError("invalid-argument", `Not a collection path: ${path}`);
  }
}

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Like Firestore's set(..., {merge: true}): objects are merged key by key, everything else is replaced. */
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/** update(): top-level keys replace; a key like "a.b" changes only that nested field. */
function applyUpdate(base, patch) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) {
    const parts = k.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!isPlain(cur[parts[i]])) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}

/**
 * The database: one SQLite file holding every document as JSON, addressed by its Firestore-style
 * path. Every document has a version number that goes up with each change, which is what lets
 * transactions notice that someone else changed a document in the meantime.
 */
export class Store {
  constructor(file) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        path    TEXT PRIMARY KEY,
        coll    TEXT NOT NULL,
        id      TEXT NOT NULL,
        data    TEXT NOT NULL,
        version INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS docs_coll ON docs (coll);
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.qGet = this.db.prepare("SELECT path, id, data, version FROM docs WHERE path = ?");
    this.qColl = this.db.prepare("SELECT path, id, data, version FROM docs WHERE coll = ?");
    this.qPut = this.db.prepare(
      "INSERT INTO docs (path, coll, id, data, version) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(path) DO UPDATE SET data = excluded.data, version = excluded.version"
    );
    this.qDel = this.db.prepare("DELETE FROM docs WHERE path = ?");
    this.qMetaGet = this.db.prepare("SELECT value FROM meta WHERE key = ?");
    this.qMetaPut = this.db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
  }

  close() {
    this.db.close();
  }

  getMeta(key) {
    const row = this.qMetaGet.get(key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.qMetaPut.run(key, value);
  }

  #row(r) {
    return { path: r.path, id: r.id, data: JSON.parse(r.data), version: r.version };
  }

  getDoc(path) {
    checkDocPath(path);
    const r = this.qGet.get(path);
    return r ? this.#row(r) : null;
  }

  listColl(coll) {
    checkCollPath(coll);
    return this.qColl.all(coll).map((r) => this.#row(r));
  }

  /**
   * Applies a group of writes all-or-nothing.
   *   writes: [{ op: "set" | "update" | "delete", path, data?, merge? }]
   *   reads:  { path: version } -- documents a transaction read; if any of them has changed since
   *           (version 0 = did not exist) nothing is written and an "aborted" error is thrown.
   * Returns the list of paths that were touched.
   */
  commit(writes, reads = {}) {
    if (!Array.isArray(writes) || writes.length > 500) throw new StoreError("invalid-argument", "Too many writes");
    for (const w of writes) {
      checkDocPath(w?.path);
      if (w.op !== "delete") {
        if (!isPlain(w.data)) throw new StoreError("invalid-argument", "Document data must be an object");
        if (JSON.stringify(w.data).length > MAX_DOC_BYTES) throw new StoreError("invalid-argument", "Document too large");
      }
    }
    const changed = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [path, version] of Object.entries(reads)) {
        checkDocPath(path);
        const r = this.qGet.get(path);
        if ((r ? r.version : 0) !== version) throw new StoreError("aborted", "Document changed during transaction");
      }
      for (const w of writes) {
        const cur = this.qGet.get(w.path);
        const curData = cur ? JSON.parse(cur.data) : null;
        if (w.op === "delete") {
          if (cur) this.qDel.run(w.path);
        } else {
          let next;
          if (w.op === "update") {
            if (!curData) throw new StoreError("not-found", `No document to update: ${w.path}`);
            next = applyUpdate(curData, w.data);
          } else if (w.op === "set") {
            next = w.merge && curData ? deepMerge(curData, w.data) : w.data;
          } else {
            throw new StoreError("invalid-argument", `Unknown write: ${w.op}`);
          }
          const { coll, id } = splitPath(w.path);
          this.qPut.run(w.path, coll, id, JSON.stringify(next), (cur ? cur.version : 0) + 1);
        }
        changed.push(w.path);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return changed;
  }
}

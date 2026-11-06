import test from "node:test";
import assert from "node:assert/strict";
import { createBackend } from "../app.mjs";
import { allowAll } from "../rules.mjs";
import { Store } from "../store.mjs";
import { runQuery, parseSpec } from "../query.mjs";

/* ---------- the store on its own ---------- */

test("store: set / merge / update / delete and versions", () => {
  const s = new Store(":memory:");
  s.commit([{ op: "set", path: "classes/a", data: { name: "A", n: { x: 1, y: 2 } } }]);
  assert.equal(s.getDoc("classes/a").version, 1);
  s.commit([{ op: "set", path: "classes/a", data: { n: { y: 9 } }, merge: true }]);
  assert.deepEqual(s.getDoc("classes/a").data, { name: "A", n: { x: 1, y: 9 } });
  s.commit([{ op: "update", path: "classes/a", data: { name: "B", "n.x": 5 } }]);
  assert.deepEqual(s.getDoc("classes/a").data, { name: "B", n: { x: 5, y: 9 } });
  assert.equal(s.getDoc("classes/a").version, 3);
  assert.throws(() => s.commit([{ op: "update", path: "classes/zzz", data: { a: 1 } }]), { code: "not-found" });
  s.commit([{ op: "delete", path: "classes/a" }]);
  assert.equal(s.getDoc("classes/a"), null);
  s.close();
});

test("store: a failed write group changes nothing; stale reads abort", () => {
  const s = new Store(":memory:");
  s.commit([{ op: "set", path: "c/a", data: { v: 1 } }]);
  assert.throws(
    () =>
      s.commit([
        { op: "set", path: "c/b", data: { v: 2 } },
        { op: "update", path: "c/missing", data: { v: 3 } },
      ]),
    { code: "not-found" }
  );
  assert.equal(s.getDoc("c/b"), null);
  assert.throws(() => s.commit([{ op: "set", path: "c/a", data: { v: 9 } }], { "c/a": 7 }), { code: "aborted" });
  s.commit([{ op: "set", path: "c/a", data: { v: 9 } }], { "c/a": 1, "c/new": 0 });
  assert.equal(s.getDoc("c/a").data.v, 9);
  assert.throws(() => s.getDoc("c"), { code: "invalid-argument" });
  assert.throws(() => s.getDoc("../x"), { code: "invalid-argument" });
  s.close();
});

test("query: where, orderBy, ties by id, missing fields", () => {
  const docs = [
    { id: "c", data: { t: "x", n: 2 } },
    { id: "a", data: { t: "x", n: 2 } },
    { id: "b", data: { t: "y", n: 1 } },
    { id: "d", data: { t: "x" } },
  ];
  const ids = (raw) => runQuery(docs, parseSpec(raw)).map((d) => d.id);
  assert.deepEqual(ids({ where: [{ field: "t", op: "==", value: "x" }] }), ["a", "c", "d"]);
  assert.deepEqual(ids({ order: [{ field: "n", dir: "asc" }] }), ["b", "a", "c"]);
  assert.deepEqual(ids({ order: [{ field: "n", dir: "desc" }] }), ["c", "a", "b"]);
  assert.deepEqual(ids({ where: [{ field: "n", op: ">", value: 1 }] }), ["a", "c"]);
});

/* ---------- the server, talked to like a browser would ---------- */

async function start() {
  const backend = createBackend({ dataFile: ":memory:", secret: "test-secret", rules: allowAll });
  const port = await backend.listen(0, "127.0.0.1");
  return { backend, port };
}

/** A tiny browser stand-in: sends requests, collects pushed snapshots. */
function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const log = [];
  const waiters = [];
  let rid = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    log.push(m);
    if (m.t === "res" && pending.has(m.rid)) {
      pending.get(m.rid)(m);
      pending.delete(m.rid);
    }
    for (const w of [...waiters]) if (w.test(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m));
  });
  const open = new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  return {
    ws,
    log,
    open,
    request: (msg) => new Promise((resolve) => ((msg.rid = ++rid), pending.set(msg.rid, resolve), ws.send(JSON.stringify(msg)))),
    send: (msg) => ws.send(JSON.stringify(msg)),
    next: (test) =>
      new Promise((resolve) => {
        const found = log.find((m, i) => i >= 0 && test(m) && !m._seen);
        if (found) return ((found._seen = true), resolve(found));
        waiters.push({ test, resolve: (m) => ((m._seen = true), resolve(m)) });
      }),
    close: () => ws.close(),
  };
}

test("server: health check, anonymous identity that survives reconnecting", async () => {
  const { backend, port } = await start();
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(res.status, 200);

  const a = connect(port);
  await a.open;
  const first = await a.request({ t: "hello" });
  assert.equal(first.user, null);
  const anon = await a.request({ t: "anon" });
  assert.ok(anon.user.uid && anon.token);
  a.close();

  const b = connect(port);
  await b.open;
  const again = await b.request({ t: "hello", token: anon.token });
  assert.equal(again.user.uid, anon.user.uid);
  const forged = await b.request({ t: "hello", token: anon.user.uid + ".forged" });
  assert.equal(forged.user, null);
  b.close();
  await backend.close();
});

test("server: live updates reach other browsers, and the writer sees its own change before the confirmation", async () => {
  const { backend, port } = await start();
  const alice = connect(port);
  const bob = connect(port);
  await Promise.all([alice.open, bob.open]);

  bob.send({ t: "sub", sid: "runs", kind: "query", path: "classes/c1/groups/g1/runs", order: [{ field: "order", dir: "asc" }] });
  const initial = await bob.next((m) => m.t === "snap" && m.sid === "runs");
  assert.deepEqual(initial.docs, []);

  alice.send({ t: "sub", sid: "runs", kind: "query", path: "classes/c1/groups/g1/runs", order: [{ field: "order", dir: "asc" }] });
  await alice.next((m) => m.t === "snap");

  const ack = await alice.request({
    t: "commit",
    writes: [
      { op: "set", path: "classes/c1/groups/g1/runs/r2", data: { text: "second", order: 2 } },
      { op: "set", path: "classes/c1/groups/g1/runs/r1", data: { text: "first", order: 1 } },
    ],
  });
  assert.equal(ack.ok, true);

  // Alice's own snapshot (with both runs) arrived before the ack that confirmed her write.
  const idxAck = alice.log.findIndex((m) => m.t === "res" && m.rid === ack.rid);
  const idxSnap = alice.log.findIndex((m, i) => m.t === "snap" && m.docs.length === 2 && i < idxAck);
  assert.ok(idxSnap >= 0, "snapshot should come before the ack");

  const seen = await bob.next((m) => m.t === "snap" && m.docs.length === 2);
  assert.deepEqual(seen.docs.map((d) => d.data.text), ["first", "second"]);

  // A change to another collection does not send bob anything for this query.
  const before = bob.log.length;
  await alice.request({ t: "commit", writes: [{ op: "set", path: "classes/c1/students/s1", data: { alias: "Al" } }] });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(bob.log.length, before);

  alice.close();
  bob.close();
  await backend.close();
});

test("server: transactions notice a conflicting change (aborted), and a retry succeeds", async () => {
  const { backend, port } = await start();
  const a = connect(port);
  await a.open;
  await a.request({ t: "commit", writes: [{ op: "set", path: "c/doc", data: { n: 1 } }] });
  const read = await a.request({ t: "get", kind: "doc", path: "c/doc" });
  assert.equal(read.doc.version, 1);

  await a.request({ t: "commit", writes: [{ op: "update", path: "c/doc", data: { n: 2 } }] }); // someone else
  const stale = await a.request({
    t: "commit",
    reads: { "c/doc": read.doc.version },
    writes: [{ op: "set", path: "c/doc", data: { n: 99 } }],
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "aborted");

  const fresh = await a.request({ t: "get", kind: "doc", path: "c/doc" });
  const ok = await a.request({
    t: "commit",
    reads: { "c/doc": fresh.doc.version },
    writes: [{ op: "set", path: "c/doc", data: { n: fresh.doc.data.n + 1 } }],
  });
  assert.equal(ok.ok, true);
  assert.equal((await a.request({ t: "get", kind: "doc", path: "c/doc" })).doc.data.n, 3);
  a.close();
  await backend.close();
});

test("server: bad requests get clear errors instead of crashing it", async () => {
  const { backend, port } = await start();
  const a = connect(port);
  await a.open;
  assert.equal((await a.request({ t: "get", kind: "doc", path: "not/a/doc" })).code, "invalid-argument");
  assert.equal((await a.request({ t: "commit", writes: [{ op: "update", path: "x/y", data: { a: 1 } }] })).code, "not-found");
  assert.equal((await a.request({ t: "nonsense" })).ok, false);
  assert.equal((await a.request({ t: "signup" })).code, "auth/operation-not-allowed");
  // Still alive afterwards:
  assert.equal((await a.request({ t: "hello" })).ok, true);
  a.close();
  await backend.close();
});

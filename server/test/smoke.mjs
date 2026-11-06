// End-to-end check of a RUNNING server (used against the built container in GitHub Actions).
//   node server/test/smoke.mjs http://127.0.0.1:3000
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:3000";

async function page(path, mustContain) {
  const res = await fetch(base + path);
  assert.equal(res.status, 200, `${path} -> ${res.status}`);
  const text = await res.text();
  if (mustContain) assert.ok(text.includes(mustContain), `${path} does not contain "${mustContain}"`);
  console.log("ok page", path);
}

function connect() {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
  let rid = 0;
  const waiting = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === "res") waiting.get(m.rid)?.(m);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("WebSocket failed")));
  });
  const ask = (msg) =>
    new Promise((resolve) => {
      const id = ++rid;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ ...msg, rid: id }));
    });
  return { ready, ask, close: () => ws.close() };
}

await page("/healthz", "ok");
if (!process.env.SMOKE_API_ONLY) {
  await page("/");
  await page("/teacher/login");
  await page("/teacher/set-password");
}

const c = connect();
await c.ready;
const me = await c.ask({ t: "anon" });
assert.equal(me.ok, true);
const uid = me.user.uid;

// A student may not create a class owned by someone else, nor change settings, but may own their own.
const forged = await c.ask({ t: "commit", writes: [{ op: "set", path: "classes/smoke", data: { teacherId: "someone-else", status: "live" } }] });
assert.equal(forged.ok, false);
assert.equal(forged.code, "permission-denied");
const own = await c.ask({ t: "commit", writes: [{ op: "set", path: "classes/smoke", data: { teacherId: uid, status: "live" } }] });
assert.equal(own.ok, true);
const read = await c.ask({ t: "get", kind: "doc", path: "classes/smoke" });
assert.equal(read.doc.data.teacherId, uid);
const unknown = await c.ask({ t: "get", kind: "doc", path: "secrets/x" });
assert.equal(unknown.ok, false);
const admin = await c.ask({ t: "admin-overview" });
assert.equal(admin.ok, false, "a student must not see the account list");
await c.ask({ t: "commit", writes: [{ op: "delete", path: "classes/smoke" }] });
c.close();
console.log("ok backend: sign-in, rules, reads, writes");

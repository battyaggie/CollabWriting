import test from "node:test";
import assert from "node:assert/strict";
import { createBackend } from "../app.mjs";

let clock = 1_000_000_000_000;
const now = () => clock;

async function start(extra = {}) {
  const backend = createBackend({ dataFile: ":memory:", secret: "s", adminEmails: ["boss@example.org"], now, ...extra });
  const port = await backend.listen(0, "127.0.0.1");
  return { backend, port };
}

/** A browser stand-in with request/response. */
async function browser(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => ws.addEventListener("open", r));
  let rid = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "res") (pending.get(m.rid)?.(m), pending.delete(m.rid));
  });
  return {
    ask: (msg) => new Promise((resolve) => ((msg.rid = ++rid), pending.set(msg.rid, resolve), ws.send(JSON.stringify(msg)))),
    close: () => ws.close(),
  };
}

test("the administrator sets a password through the start-up link and signs in", async () => {
  const { backend, port } = await start();
  assert.equal(backend.adminSetups.length, 1);
  const { email, setupToken } = backend.adminSetups[0];
  assert.equal(email, "boss@example.org");

  const b = await browser(port);
  assert.equal((await b.ask({ t: "set-password", token: setupToken, password: "short" })).code, "auth/weak-password");
  const done = await b.ask({ t: "set-password", token: setupToken, password: "a-long-enough-password" });
  assert.equal(done.ok, true);
  assert.equal(done.user.isAdmin, true);
  assert.equal((await b.ask({ t: "set-password", token: setupToken, password: "another-long-password" })).code, "auth/invalid-action-code", "a link works once");

  const c = await browser(port);
  assert.equal((await c.ask({ t: "login", email: "boss@example.org", password: "wrong-password-here" })).code, "auth/invalid-credential");
  assert.equal((await c.ask({ t: "login", email: "nobody@example.org", password: "a-long-enough-password" })).code, "auth/invalid-credential");
  const ok = await c.ask({ t: "login", email: "Boss@Example.org", password: "a-long-enough-password" });
  assert.equal(ok.ok, true);
  assert.equal(ok.user.email, "boss@example.org");
  b.close();
  c.close();
  await backend.close();
});

test("request -> approve -> lecturer chooses password -> signs in; nobody can register themselves", async () => {
  const { backend, port } = await start();
  const admin = await browser(port);
  await admin.ask({ t: "set-password", token: backend.adminSetups[0].setupToken, password: "admin-password-123" });

  const lecturer = await browser(port);
  assert.equal((await lecturer.ask({ t: "signup", email: "x@example.org", password: "whatever-long-password" })).code, "auth/operation-not-allowed");
  assert.equal((await lecturer.ask({ t: "access-request", email: "not an email", name: "X" })).code, "invalid-argument");
  assert.equal((await lecturer.ask({ t: "access-request", email: "Anna@Example.org", name: "Anna Adams" })).ok, true);
  assert.equal((await lecturer.ask({ t: "access-request", email: "anna@example.org", name: "again" })).ok, true, "asking twice is harmless");

  // Not an administrator: refused.
  assert.equal((await lecturer.ask({ t: "admin-overview" })).code, "permission-denied");

  const overview = await admin.ask({ t: "admin-overview" });
  const pending = overview.requests.filter((r) => r.status === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].email, "anna@example.org");

  const approved = await admin.ask({ t: "admin-approve", id: pending[0].id });
  assert.equal(approved.ok, true);
  assert.ok(approved.token);

  // Before she chooses a password she cannot sign in.
  assert.equal((await lecturer.ask({ t: "login", email: "anna@example.org", password: "anything-long-enough" })).code, "auth/invalid-credential");

  const set = await lecturer.ask({ t: "set-password", token: approved.token, password: "annas-own-password" });
  assert.equal(set.ok, true);
  assert.equal(set.user.isAdmin, false);
  assert.equal((await lecturer.ask({ t: "admin-overview" })).code, "permission-denied");

  const after = await admin.ask({ t: "admin-overview" });
  assert.equal(after.requests.find((r) => r.email === "anna@example.org").status, "approved");
  assert.deepEqual(after.users.map((u) => u.email).sort(), ["anna@example.org", "boss@example.org"]);

  // A request from someone who already has an account does nothing new.
  await lecturer.ask({ t: "access-request", email: "anna@example.org", name: "Anna" });
  assert.equal((await admin.ask({ t: "admin-overview" })).requests.filter((r) => r.status === "pending").length, 0);
  admin.close();
  lecturer.close();
  await backend.close();
});

test("reject, reset password, switch off and on", async () => {
  const { backend, port } = await start();
  const admin = await browser(port);
  await admin.ask({ t: "set-password", token: backend.adminSetups[0].setupToken, password: "admin-password-123" });
  const t = await browser(port);
  await t.ask({ t: "access-request", email: "bob@example.org", name: "Bob" });
  await t.ask({ t: "access-request", email: "eve@example.org", name: "Eve" });
  const reqs = (await admin.ask({ t: "admin-overview" })).requests;
  const bob = reqs.find((r) => r.email === "bob@example.org");
  const eve = reqs.find((r) => r.email === "eve@example.org");
  assert.equal((await admin.ask({ t: "admin-reject", id: eve.id })).ok, true);
  assert.equal((await admin.ask({ t: "admin-reject", id: eve.id })).code, "not-found");

  const first = await admin.ask({ t: "admin-approve", id: bob.id });
  await t.ask({ t: "set-password", token: first.token, password: "bobs-first-password" });
  const bobUid = (await admin.ask({ t: "admin-overview" })).users.find((u) => u.email === "bob@example.org").uid;

  // Reset: a new link; the old password is unchanged until the link is used.
  const reset = await admin.ask({ t: "admin-reset", uid: bobUid });
  assert.equal((await t.ask({ t: "login", email: "bob@example.org", password: "bobs-first-password" })).ok, true);
  await t.ask({ t: "set-password", token: reset.token, password: "bobs-second-password" });
  assert.equal((await t.ask({ t: "login", email: "bob@example.org", password: "bobs-first-password" })).ok, false);
  assert.equal((await t.ask({ t: "login", email: "bob@example.org", password: "bobs-second-password" })).ok, true);

  // Switched off: cannot sign in, and an existing token stops working.
  const token = (await t.ask({ t: "login", email: "bob@example.org", password: "bobs-second-password" })).token;
  assert.equal((await admin.ask({ t: "admin-disable", uid: bobUid, disabled: true })).ok, true);
  assert.equal((await t.ask({ t: "login", email: "bob@example.org", password: "bobs-second-password" })).code, "auth/invalid-credential");
  const t2 = await browser(port);
  assert.equal((await t2.ask({ t: "hello", token })).user, null);
  await admin.ask({ t: "admin-disable", uid: bobUid, disabled: false });
  assert.equal((await t2.ask({ t: "hello", token })).user.email, "bob@example.org");
  // An administrator cannot lock themselves out.
  const me = (await admin.ask({ t: "admin-overview" })).users.find((u) => u.email === "boss@example.org").uid;
  assert.equal((await admin.ask({ t: "admin-disable", uid: me, disabled: true })).code, "invalid-argument");
  [admin, t, t2].forEach((x) => x.close());
  await backend.close();
});

test("sign-in tokens expire; setup links expire; guessing is slowed down", async () => {
  const { backend, port } = await start();
  const admin = await browser(port);
  const done = await admin.ask({ t: "set-password", token: backend.adminSetups[0].setupToken, password: "admin-password-123" });
  const anon = (await admin.ask({ t: "anon" })).token;
  const probe = await browser(port);
  assert.ok((await probe.ask({ t: "hello", token: done.token })).user);
  assert.ok((await probe.ask({ t: "hello", token: anon })).user);
  clock += 31 * 86400_000; // 31 days later
  assert.equal((await probe.ask({ t: "hello", token: done.token })).user, null, "teacher token expired after 30 days");
  assert.ok((await probe.ask({ t: "hello", token: anon })).user, "student identity lasts longer");
  clock += 400 * 86400_000;
  assert.equal((await probe.ask({ t: "hello", token: anon })).user, null);

  const fresh = await browser(port);
  let last;
  for (let i = 0; i < 12; i++) last = await fresh.ask({ t: "login", email: "boss@example.org", password: `wrong-guess-number-${i}` });
  assert.equal(last.code, "auth/too-many-requests");
  const spam = await browser(port);
  let r;
  for (let i = 0; i < 6; i++) r = await spam.ask({ t: "access-request", email: `p${i}@example.org`, name: "p" });
  assert.equal(r.code, "auth/too-many-requests");
  [admin, probe, fresh, spam].forEach((x) => x.close());
  await backend.close();
});

test("a setup link that is too old no longer works", async () => {
  const { backend, port } = await start();
  const b = await browser(port);
  clock += 8 * 86400_000;
  assert.equal((await b.ask({ t: "set-password", token: backend.adminSetups[0].setupToken, password: "admin-password-123" })).code, "auth/invalid-action-code");
  b.close();
  await backend.close();
});

test("import a list of people: accounts and links for new ones, existing ones left alone", async () => {
  const { backend, port } = await start();
  const admin = await browser(port);
  await admin.ask({ t: "set-password", token: backend.adminSetups[0].setupToken, password: "admin-password-123" });
  const lecturer = await browser(port);
  await lecturer.ask({ t: "access-request", email: "carla@example.org", name: "Carla" });
  assert.equal((await lecturer.ask({ t: "admin-import", people: [] })).code, "permission-denied");

  const res = await admin.ask({
    t: "admin-import",
    people: [
      { name: "Carla Cole", email: "Carla@example.org" },
      { name: "Dan Doe", email: "dan@example.org" },
      { name: "Dan again", email: "DAN@example.org" },
      { name: "Broken", email: "no-at-sign" },
      { name: "Boss", email: "boss@example.org" },
    ],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.rows.map((r) => r.status), ["created", "created", "duplicate", "invalid", "exists"]);
  assert.ok(res.rows[0].token && res.rows[1].token && !res.rows[4].token);

  const dan = await browser(port);
  assert.equal((await dan.ask({ t: "set-password", token: res.rows[1].token, password: "dans-own-password" })).ok, true);
  // Carla's pending request was settled by the import.
  const overview = await admin.ask({ t: "admin-overview" });
  assert.equal(overview.requests.filter((r) => r.status === "pending").length, 0);
  // Running the same import again: Dan (has a password) is left alone, Carla gets a fresh link.
  const again = await admin.ask({ t: "admin-import", people: [{ name: "Carla Cole", email: "carla@example.org" }, { name: "Dan Doe", email: "dan@example.org" }] });
  assert.deepEqual(again.rows.map((r) => r.status), ["link-renewed", "exists"]);
  [admin, lecturer, dan].forEach((x) => x.close());
  await backend.close();
});

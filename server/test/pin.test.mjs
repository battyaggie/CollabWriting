import test from "node:test";
import assert from "node:assert/strict";
import { createBackend } from "../app.mjs";
import { LOCK_MS, MAX_FAILURES, decideClaim, nicknameKey, pinProblem, recordId } from "../pin.mjs";

/* ---------- the rules of PINs, on their own ---------- */

test("pin: nicknames are compared without case and extra spaces; PIN length is checked", () => {
  assert.equal(nicknameKey("  Anna   K "), "anna k");
  assert.equal(recordId("BMR", "Anna_K"), recordId("BMR", " anna_k "));
  assert.notEqual(recordId("BMR", "Anna_K"), recordId("BMR2", "Anna_K"));
  assert.ok(pinProblem("123"));
  assert.ok(pinProblem("x".repeat(33)));
  assert.equal(pinProblem("1234"), null);
  assert.equal(pinProblem("  1234  "), null);
});

test("pin: first use registers, right PIN returns the stored identity, wrong PINs lock the nickname", () => {
  const t0 = 1_000;
  const first = decideClaim(null, "4821", "uid-A", t0);
  assert.equal(first.outcome, "registered");
  assert.equal(first.uid, "uid-A");
  assert.ok(first.record.hash && first.record.salt);
  assert.ok(!JSON.stringify(first.record).includes("4821"), "the PIN itself must not be stored");

  const ok = decideClaim(first.record, " 4821 ", "uid-B", t0);
  assert.equal(ok.outcome, "ok");
  assert.equal(ok.uid, "uid-A");

  let record = first.record;
  for (let i = 1; i < MAX_FAILURES; i++) {
    const w = decideClaim(record, "0000", "uid-B", t0);
    assert.equal(w.outcome, "wrong");
    assert.equal(w.locks, false);
    record = w.record;
  }
  const last = decideClaim(record, "0000", "uid-B", t0);
  assert.equal(last.outcome, "wrong");
  assert.equal(last.locks, true);
  // locked: even the right PIN is refused until the time is up
  assert.equal(decideClaim(last.record, "4821", "uid-B", t0 + 1000).outcome, "locked");
  assert.equal(decideClaim(last.record, "4821", "uid-B", t0 + LOCK_MS + 1).outcome, "ok");
});

/* ---------- through the server, like a browser ---------- */

let clock = 1_000_000_000_000;
const now = () => clock;

async function start() {
  const backend = createBackend({ dataFile: ":memory:", secret: "s", adminEmails: ["boss@example.org"], now });
  const port = await backend.listen(0, "127.0.0.1");
  return { backend, port };
}

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

/** A new browser that is signed in as a new anonymous student. */
async function student(port) {
  const b = await browser(port);
  const r = await b.ask({ t: "anon" });
  return { b, uid: r.user.uid };
}

test("a student gets the same identity back on another device with nickname + PIN", async () => {
  const { backend, port } = await start();
  const laptop = await student(port);
  const first = await laptop.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Anna_K", pin: "4821" });
  assert.equal(first.ok, true);
  assert.equal(first.registered, true);
  assert.equal(first.user.uid, laptop.uid);

  // at home: a new browser, a new anonymous identity, then the PIN
  const phone = await student(port);
  assert.notEqual(phone.uid, laptop.uid);
  const again = await phone.b.ask({ t: "pin-claim", scope: "BMR", nickname: " anna_k", pin: "4821" });
  assert.equal(again.ok, true);
  assert.equal(again.registered, false);
  assert.equal(again.user.uid, laptop.uid);

  // the token that came back really is that identity (a reload keeps it)
  const reload = await browser(port);
  const hello = await reload.ask({ t: "hello", token: again.token });
  assert.equal(hello.user.uid, laptop.uid);

  // the same nickname in another class is a different person
  const other = await student(port);
  const elsewhere = await other.b.ask({ t: "pin-claim", scope: "OTHER", nickname: "Anna_K", pin: "9999" });
  assert.equal(elsewhere.registered, true);
  assert.equal(elsewhere.user.uid, other.uid);
  await backend.close();
});

test("a wrong PIN is refused, five in a row lock the nickname for a while", async () => {
  const { backend, port } = await start();
  const a = await student(port);
  await a.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Ben", pin: "1111" });

  const thief = await student(port);
  for (let i = 0; i < 4; i++) {
    const r = await thief.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Ben", pin: "2222" });
    assert.equal(r.code, "pin/wrong");
  }
  const fifth = await thief.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Ben", pin: "2222" });
  assert.equal(fifth.code, "pin/wrong");
  assert.match(fifth.message, /wait/);
  // locked: the owner's right PIN is also refused for now
  assert.equal((await thief.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Ben", pin: "1111" })).code, "pin/locked");
  clock += LOCK_MS + 1000;
  const back = await thief.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Ben", pin: "1111" });
  assert.equal(back.ok, true);
  assert.equal(back.user.uid, a.uid);
  await backend.close();
});

test("bad input is refused; choosing another nickname frees the old one", async () => {
  const { backend, port } = await start();
  const a = await student(port);
  assert.equal((await a.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Cleo", pin: "12" })).code, "invalid-argument");
  assert.equal((await a.b.ask({ t: "pin-claim", scope: "BMR", nickname: "  ", pin: "1234" })).code, "invalid-argument");
  assert.equal((await a.b.ask({ t: "pin-claim", scope: "", nickname: "Cleo", pin: "1234" })).code, "invalid-argument");

  assert.equal((await a.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Cleo", pin: "1234" })).registered, true);
  assert.equal((await a.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Cleo2", pin: "1234" })).registered, true);
  // "Cleo" is free again: someone else can take it with their own PIN
  const b = await student(port);
  const taken = await b.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Cleo", pin: "7777" });
  assert.equal(taken.registered, true);
  assert.equal(taken.user.uid, b.uid);
  await backend.close();
});

test("a teacher cannot use a PIN, and only the class's own teacher can release its nicknames", async () => {
  const { backend, port } = await start();
  const { setupToken } = backend.adminSetups[0];
  const teacher = await browser(port);
  const set = await teacher.ask({ t: "set-password", token: setupToken, password: "a-long-enough-password" });
  assert.equal(set.ok, true);
  assert.equal((await teacher.ask({ t: "pin-claim", scope: "BMR", nickname: "Boss", pin: "1234" })).code, "permission-denied");

  const made = await teacher.ask({
    t: "commit",
    writes: [{ op: "set", path: "courses/BMR", data: { courseCode: "BMR", teacherId: set.user.uid, className: "BMR" } }],
  });
  assert.equal(made.ok, true);

  const s = await student(port);
  await s.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Dana", pin: "1234" });
  assert.equal((await s.b.ask({ t: "pin-release", scope: "BMR" })).code, "permission-denied"); // students cannot
  assert.equal((await teacher.ask({ t: "pin-release", scope: "NOPE" })).code, "permission-denied"); // not their class

  const released = await teacher.ask({ t: "pin-release", scope: "BMR" });
  assert.equal(released.ok, true);
  assert.equal(released.removed, 1);
  // after the release the nickname is free for anyone
  const later = await student(port);
  const reuse = await later.b.ask({ t: "pin-claim", scope: "BMR", nickname: "Dana", pin: "5555" });
  assert.equal(reuse.registered, true);
  assert.equal(reuse.user.uid, later.uid);
  await backend.close();
});

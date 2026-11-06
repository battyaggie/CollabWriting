// Runs the browser-side stand-in (src/backend/local) against the real server, the way the app uses it.
// Run with: npx tsx --test server/test/shim.test.ts
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createBackend } from "../app.mjs";
import { allowAll } from "../rules.mjs";

const backend = createBackend({ dataFile: ":memory:", secret: "t", rules: allowAll });
let port = 0;
const store = new Map<string, string>();

// A pretend browser environment.
before(async () => {
  port = await backend.listen(0, "127.0.0.1");
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  g.location = { protocol: "http:", host: `127.0.0.1:${port}` };
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

after(async () => {
  await backend.close();
  process.exit(0); // the shim keeps its (reconnecting) socket for the life of the tab
});

/** Another browser, changing things behind the first one's back. */
async function otherBrowser(writes: unknown[], reads: Record<string, number> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => ws.addEventListener("open", r));
  const answer = new Promise<{ ok: boolean }>((resolve) =>
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data));
      if (m.t === "res") resolve(m);
    })
  );
  ws.send(JSON.stringify({ t: "commit", rid: 1, writes, reads }));
  const res = await answer;
  ws.close();
  return res;
}

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("sign in anonymously, and the identity is remembered", async () => {
  const auth = await import("../../src/backend/local/auth");
  const a = auth.getAuth();
  const seen: (string | null)[] = [];
  const stop = auth.onAuthStateChanged(a, (u) => seen.push(u ? u.uid : null));
  await waitFor(() => seen.length === 1);
  assert.equal(seen[0], null);
  const { user } = await auth.signInAnonymously(a);
  assert.ok(user.uid);
  assert.equal(a.currentUser?.uid, user.uid);
  assert.ok(store.get("cw-token"), "token stored for the next page load");
  await waitFor(() => seen.length === 2);
  assert.equal(seen[1], user.uid);
  stop();
  await assert.rejects(() => auth.signInWithEmailAndPassword(a, "t@example.org", "pw"), { code: "auth/invalid-credential" });
  await assert.rejects(() => auth.createUserWithEmailAndPassword(a, "t@example.org", "password12345"), { code: "auth/operation-not-allowed" });
});

test("documents: set, get, update, merge, delete, add", async () => {
  const fs = await import("../../src/backend/local/firestore");
  const db = fs.getFirestore();
  const ref = fs.doc(db, "classes", "abc");
  assert.equal((await fs.getDoc(ref)).exists(), false);
  await fs.setDoc(ref, { name: "Writing", status: "waiting", teacherId: "t1", createdAt: 5 });
  const snap = await fs.getDoc(ref);
  assert.equal(snap.exists(), true);
  assert.equal(snap.id, "abc");
  assert.equal(snap.data()?.name, "Writing");
  await fs.updateDoc(ref, { status: "grouped" });
  await fs.setDoc(ref, { extra: 1 }, { merge: true });
  assert.deepEqual((await fs.getDoc(ref)).data(), { name: "Writing", status: "grouped", teacherId: "t1", createdAt: 5, extra: 1 });
  await assert.rejects(() => fs.updateDoc(fs.doc(db, "classes", "nope"), { a: 1 }), { code: "not-found" });

  const added = await fs.addDoc(fs.collection(db, "classes"), { name: "Second", teacherId: "t1", createdAt: 9 });
  assert.equal(added.id.length, 20);
  await fs.deleteDoc(added);
  assert.equal((await fs.getDoc(added)).exists(), false);
});

test("queries: where + orderBy, and sub-collections through a reference", async () => {
  const fs = await import("../../src/backend/local/firestore");
  const db = fs.getFirestore();
  const batch = fs.writeBatch(db);
  batch.set(fs.doc(db, "classes", "q1"), { teacherId: "t9", n: 3 });
  batch.set(fs.doc(db, "classes", "q2"), { teacherId: "t9", n: 1 });
  batch.set(fs.doc(db, "classes", "q3"), { teacherId: "other", n: 2 });
  batch.set(fs.doc(db, "classes", "q1", "groups", "g1"), { name: "Group 1" });
  await batch.commit();

  const mine = await fs.getDocs(fs.query(fs.collection(db, "classes"), fs.where("teacherId", "==", "t9")));
  assert.deepEqual(mine.docs.map((d) => d.id).sort(), ["q1", "q2"]);
  const ordered = await fs.getDocs(fs.query(fs.collection(db, "classes"), fs.where("teacherId", "==", "t9"), fs.orderBy("n", "asc")));
  assert.deepEqual(ordered.docs.map((d) => d.id), ["q2", "q1"]);
  const groups = await fs.getDocs(fs.collection(fs.doc(db, "classes", "q1"), "groups"));
  assert.equal(groups.size, 1);
  assert.equal(groups.docs[0].ref.parent.path, "classes/q1/groups");
  let n = 0;
  groups.forEach(() => n++);
  assert.equal(n, 1);

  const bad = fs.writeBatch(db);
  bad.set(fs.doc(db, "classes", "q4"), { x: 1 });
  bad.update(fs.doc(db, "classes", "missing"), { x: 1 });
  await assert.rejects(() => bad.commit(), { code: "not-found" });
  assert.equal((await fs.getDoc(fs.doc(db, "classes", "q4"))).exists(), false, "a failed batch writes nothing");
});

test("live listeners: own writes, other browsers' writes, and stopping", async () => {
  const fs = await import("../../src/backend/local/firestore");
  const db = fs.getFirestore();
  const runs = fs.query(fs.collection(db, "classes", "live", "groups", "g", "runs"), fs.orderBy("order", "asc"));
  const states: string[][] = [];
  const stop = fs.onSnapshot(runs, (s) => states.push(s.docs.map((d) => d.data().text as string)));
  await waitFor(() => states.length === 1);
  assert.deepEqual(states[0], []);

  await fs.setDoc(fs.doc(db, "classes", "live", "groups", "g", "runs", "r1"), { text: "one", order: 1 });
  await waitFor(() => states.length === 2);
  assert.deepEqual(states[1], ["one"]);

  await otherBrowser([{ op: "set", path: "classes/live/groups/g/runs/r0", data: { text: "zero", order: 0 } }]);
  await waitFor(() => states.length === 3);
  assert.deepEqual(states[2], ["zero", "one"]);

  const docStates: (string | undefined)[] = [];
  const stopDoc = fs.onSnapshot(fs.doc(db, "classes", "live", "groups", "g", "runs", "r1"), (s) => docStates.push(s.data()?.text));
  await waitFor(() => docStates.length === 1);
  await fs.updateDoc(fs.doc(db, "classes", "live", "groups", "g", "runs", "r1"), { text: "uno" });
  await waitFor(() => docStates.length === 2);
  assert.equal(docStates[1], "uno");

  stop();
  stopDoc();
  const before = states.length;
  await fs.setDoc(fs.doc(db, "classes", "live", "groups", "g", "runs", "r2"), { text: "two", order: 2 });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(states.length, before, "no updates after unsubscribing");
});

test("transactions: run again when someone else changed the document, never lose their change", async () => {
  const fs = await import("../../src/backend/local/firestore");
  const db = fs.getFirestore();
  const ref = fs.doc(db, "counters", "c");
  await fs.setDoc(ref, { n: 10 });

  let attempts = 0;
  await fs.runTransaction(db, async (tx) => {
    attempts++;
    const snap = await tx.get(ref);
    if (attempts === 1) await otherBrowser([{ op: "update", path: "counters/c", data: { n: 20 } }]); // interferes once
    tx.set(ref, { n: (snap.data()?.n as number) + 1 });
  });
  assert.equal(attempts, 2);
  assert.equal((await fs.getDoc(ref)).data()?.n, 21, "built on the other browser's value, not overwritten");

  // A transaction that creates a document only if it does not exist yet (like joining a class).
  const mk = async () =>
    fs.runTransaction(db, async (tx) => {
      const s = await tx.get(fs.doc(db, "counters", "once"));
      if (s.exists()) return "existed";
      tx.set(fs.doc(db, "counters", "once"), { made: true });
      return "created";
    });
  assert.equal(await mk(), "created");
  assert.equal(await mk(), "existed");
});

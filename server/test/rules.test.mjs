import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../store.mjs";
import { firestoreRules as rules } from "../rules.mjs";

const T = { uid: "teacher1", isAnonymous: false };
const T2 = { uid: "teacher2", isAnonymous: false };
const S1 = { uid: "stu1", isAnonymous: true };
const S2 = { uid: "stu2", isAnonymous: true };

function setup() {
  const store = new Store(":memory:");
  store.commit([
    { op: "set", path: "classes/c1", data: { teacherId: "teacher1", status: "live" } },
    { op: "set", path: "classes/done", data: { teacherId: "teacher1", status: "completed" } },
    { op: "set", path: "classes/c1/groups/g1/feedback/f1", data: { studentId: "stu1", text: "x" } },
    { op: "set", path: "classes/done/groups/g1/feedback/f1", data: { studentId: "stu1", text: "x" } },
    { op: "set", path: "classes/done/groups/g1/runs/r1", data: { text: "t" } },
    { op: "set", path: "courses/k1", data: { teacherId: "teacher1" } },
  ]);
  return store;
}
const set = (path, data, extra = {}) => ({ op: "set", path, data, ...extra });
const upd = (path, data) => ({ op: "update", path, data });
const del = (path) => ({ op: "delete", path });
const ok = (store, user, ...w) => assert.doesNotThrow(() => rules.canWrite(user, w, store));
const no = (store, user, ...w) => assert.throws(() => rules.canWrite(user, w, store), { code: "permission-denied" });

test("reads: known collections are public, anything else is refused", () => {
  for (const p of ["classes", "classes/c1", "classes/c1/students", "classes/c1/groups/g1/runs", "classes/c1/groups/g1/feedback/f1", "courses", "courses/k1"]) {
    assert.doesNotThrow(() => rules.canRead(null, p), p);
  }
  for (const p of ["secrets", "classes/c1/other", "users/abc", "classes/c1/groups/g1/hidden/x"]) {
    assert.throws(() => rules.canRead(S1, p), { code: "permission-denied" }, p);
  }
});

test("classes and courses: only the signed-in owner creates and changes them", () => {
  const s = setup();
  ok(s, T, set("classes/new", { teacherId: "teacher1" }));
  no(s, T, set("classes/new", { teacherId: "teacher2" })); // cannot create a class for somebody else
  no(s, S1, upd("classes/c1", { status: "completed" })); // a student cannot close the exercise
  no(s, null, set("classes/new", { teacherId: "x" }));
  ok(s, T, upd("classes/c1", { status: "completed" }));
  no(s, T2, upd("classes/c1", { status: "completed" }));
  no(s, S1, del("classes/c1"));
  ok(s, T, del("classes/c1"));
  ok(s, T, set("courses/new", { teacherId: "teacher1" }));
  no(s, T2, upd("courses/k1", { name: "x" }));
  ok(s, T, upd("courses/k1", { name: "x" }));
  no(s, S1, del("courses/k1"));
});

test("students: own roster entry only; the teacher may update and delete", () => {
  const s = setup();
  ok(s, S1, set("classes/c1/students/stu1", { alias: "A" }));
  no(s, S1, set("classes/c1/students/stu2", { alias: "B" }));
  no(s, null, set("classes/c1/students/stu1", { alias: "A" }));
  s.commit([set("classes/c1/students/stu1", { alias: "A" })]);
  ok(s, S1, upd("classes/c1/students/stu1", { alias: "A2" }));
  no(s, S2, upd("classes/c1/students/stu1", { alias: "hack" }));
  ok(s, T, upd("classes/c1/students/stu1", { group: "g1" }));
  no(s, S1, del("classes/c1/students/stu1"));
  ok(s, T, del("classes/c1/students/stu1"));
});

test("groups are teacher-only", () => {
  const s = setup();
  ok(s, T, set("classes/c1/groups/g2", { name: "G2" }));
  no(s, S1, set("classes/c1/groups/g2", { name: "G2" }));
  no(s, T2, set("classes/c1/groups/g2", { name: "G2" }));
  no(s, T, set("classes/missing/groups/g2", { name: "G2" }));
});

test("writing: any signed-in user while the exercise is open, nobody once it is closed", () => {
  const s = setup();
  ok(s, S1, set("classes/c1/groups/g1/runs/r9", { text: "hi" }));
  ok(s, S2, set("classes/c1/groups/g1/runs/r9", { text: "another student's edit" }));
  ok(s, S2, del("classes/c1/groups/g1/runs/r9"));
  no(s, null, set("classes/c1/groups/g1/runs/r9", { text: "hi" }));
  no(s, S1, set("classes/done/groups/g1/runs/r2", { text: "late" }));
  no(s, S1, upd("classes/done/groups/g1/runs/r1", { text: "late" }));
  no(s, S1, del("classes/done/groups/g1/runs/r1"));
  ok(s, T, del("classes/done/groups/g1/runs/r1"));
  no(s, T2, del("classes/done/groups/g1/runs/r1"));
  no(s, S1, set("classes/missing/groups/g1/runs/r1", { text: "x" }));
});

test("feedback: authored by the writer; only author or teacher change it; closed means closed", () => {
  const s = setup();
  ok(s, S1, set("classes/c1/groups/g1/feedback/new", { studentId: "stu1", text: "a" }));
  no(s, S1, set("classes/c1/groups/g1/feedback/new", { studentId: "stu2", text: "forged" }));
  no(s, S1, set("classes/done/groups/g1/feedback/new", { studentId: "stu1", text: "late" }));
  ok(s, S1, upd("classes/c1/groups/g1/feedback/f1", { text: "mine" }));
  no(s, S2, upd("classes/c1/groups/g1/feedback/f1", { text: "not mine" }));
  ok(s, T, upd("classes/c1/groups/g1/feedback/f1", { text: "moderated" }));
  no(s, S1, upd("classes/done/groups/g1/feedback/f1", { text: "late" }));
  no(s, T, upd("classes/done/groups/g1/feedback/f1", { text: "ok" })); // closed: even the teacher can only delete
  ok(s, T, del("classes/done/groups/g1/feedback/f1"));
  ok(s, S1, del("classes/c1/groups/g1/feedback/f1"));
  no(s, S2, del("classes/c1/groups/g1/feedback/f1"));
  no(s, S1, del("classes/done/groups/g1/feedback/f1"));
});

test("unknown paths, collection paths and a refused write inside a batch are all refused", () => {
  const s = setup();
  no(s, T, set("users/abc", { x: 1 }));
  no(s, T, set("classes/c1/secret/x", { x: 1 }));
  no(s, T, set("classes/c1/groups/g1/runs/r1/extra/x", { x: 1 }));
  no(s, T, set("classes/c1/groups/g2", { n: 1 }), set("other/x", { n: 1 }));
  assert.throws(() => rules.canWrite(T, [upd("classes/none", { a: 1 })], s), { code: "not-found" });
});

import { StoreError } from "./errors.mjs";
import { deepMerge, applyUpdate } from "./store.mjs";

/**
 * Who may read and write what: the server's version of firestore.rules (keep the two in step).
 * canRead / canWrite throw StoreError("permission-denied") to refuse.
 *
 * Trust model (same as the Firebase version): a "student" is anyone signed in anonymously; a
 * "teacher" is a signed-in account whose uid is the class's teacherId. Anything the rules do not
 * mention is refused. Like Firestore, every write of a batch is judged against the state before
 * the batch.
 */

const denied = () => new StoreError("permission-denied", "Missing or insufficient permissions.");

/**
 * Which kind of path this is. Paths are Firestore-style: "classes/c1/groups/g1/runs/r1" is a document
 * (even number of parts), "classes/c1/groups" a collection (odd).
 */
function classify(path) {
  const p = path.split("/");
  const n = p.length;
  const last = n % 2 === 0 ? "doc" : "coll";
  if (p[0] === "courses" && n <= 2) return { kind: "course", last, id: p[1] };
  if (p[0] !== "classes") return null;
  if (n <= 2) return { kind: "class", last, classId: p[1], id: p[1] };
  const classId = p[1];
  if (p[2] === "students" && n <= 4) return { kind: "student", last, classId, id: p[3] };
  if (p[2] === "groups") {
    if (n <= 4) return { kind: "group", last, classId, id: p[3] };
    if (p[4] === "runs" && n <= 6) return { kind: "run", last, classId, id: p[5] };
    if (p[4] === "feedback" && n <= 6) return { kind: "feedback", last, classId, id: p[5] };
  }
  return null;
}

export const firestoreRules = {
  isPlaceholder: false,

  /** Everything that exists in the app is readable by anyone (students look classes up by code before joining). */
  canRead(user, path) {
    const c = classify(path);
    if (!c) throw denied();
  },

  canWrite(user, writes, store) {
    const uid = user?.uid ?? null;
    const signedIn = uid !== null;
    const classCache = new Map();
    const klass = (classId) => {
      if (!classCache.has(classId)) classCache.set(classId, store.getDoc(`classes/${classId}`)?.data ?? null);
      return classCache.get(classId);
    };
    // Like Firestore's get(): a class that does not exist makes the rule fail.
    const isTeacherOf = (classId) => signedIn && klass(classId) !== null && klass(classId).teacherId === uid;
    const isOpen = (classId) => klass(classId) !== null && klass(classId).status !== "completed";

    for (const w of writes) {
      const c = classify(w.path);
      if (!c || c.last !== "doc") throw denied();
      const cur = store.getDoc(w.path)?.data ?? null;
      const op = w.op === "delete" ? "delete" : cur ? "update" : "create";
      if (w.op === "update" && !cur) throw new StoreError("not-found", `No document to update: ${w.path}`);
      let next = null;
      if (op !== "delete") {
        next = w.op === "update" ? applyUpdate(cur, w.data) : w.merge && cur ? deepMerge(cur, w.data) : w.data;
      }

      let ok = false;
      switch (c.kind) {
        case "course":
          ok = signedIn && (op === "create" ? next.teacherId === uid : cur.teacherId === uid);
          break;
        case "class":
          ok = signedIn && (op === "create" ? next.teacherId === uid : isTeacherOf(c.classId));
          break;
        case "student":
          if (op === "create") ok = signedIn && uid === c.id;
          else if (op === "update") ok = signedIn && (uid === c.id || isTeacherOf(c.classId));
          else ok = isTeacherOf(c.classId);
          break;
        case "group":
          ok = isTeacherOf(c.classId);
          break;
        case "run":
          if (op === "delete") ok = signedIn && (isOpen(c.classId) || isTeacherOf(c.classId));
          else ok = signedIn && isOpen(c.classId);
          break;
        case "feedback":
          if (op === "create") ok = signedIn && next.studentId === uid && isOpen(c.classId);
          else if (op === "update") ok = signedIn && isOpen(c.classId) && (cur.studentId === uid || isTeacherOf(c.classId));
          else ok = signedIn && ((cur.studentId === uid && isOpen(c.classId)) || isTeacherOf(c.classId));
          break;
      }
      if (!ok) throw denied();
    }
  },
};

/** Allows everything. Only for tests of the storage itself; never use for real classes. */
export const allowAll = {
  isPlaceholder: true,
  canRead() {},
  canWrite() {},
};

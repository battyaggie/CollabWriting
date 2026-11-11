import { collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where, writeBatch, type DocumentReference } from "firebase/firestore";
import { db } from "./firebase";
import { releaseNicknames } from "./identity";
import type { ClassDoc } from "./types";

async function deleteAll(refs: DocumentReference[]) {
  for (let i = 0; i < refs.length; i += 100) {
    const batch = writeBatch(db);
    refs.slice(i, i + 100).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/**
 * Permanently deletes one exercise (or single session) with everything in it: the groups, their text,
 * all feedback and the list of students. Firestore does not delete sub-collections by itself, so each
 * level is removed first and the exercise itself last (the security rules need it to still exist).
 */
export async function deleteExercise(classId: string) {
  // A single session (not part of a class) owns its students' nicknames and PINs; a class's exercises share the class's.
  const existing = await getDoc(doc(db, "classes", classId));
  if (existing.exists() && !(existing.data() as ClassDoc).courseId) await releaseNicknames(classId);
  const groups = await getDocs(collection(db, "classes", classId, "groups"));
  for (const g of groups.docs) {
    const runs = await getDocs(collection(g.ref, "runs"));
    const feedback = await getDocs(collection(g.ref, "feedback"));
    await deleteAll([...runs.docs.map((d) => d.ref), ...feedback.docs.map((d) => d.ref)]);
  }
  const students = await getDocs(collection(db, "classes", classId, "students"));
  await deleteAll([...groups.docs.map((d) => d.ref), ...students.docs.map((d) => d.ref)]);
  await deleteDoc(doc(db, "classes", classId));
}

/** Deletes an exercise of a class and, if students were being sent to it, points the class at the newest one left (or none). */
export async function deleteExerciseOfCourse(courseId: string, classId: string, activeExerciseId: string | null) {
  await deleteExercise(classId);
  if (activeExerciseId === classId) {
    const rest = await getDocs(query(collection(db, "classes"), where("courseId", "==", courseId)));
    const newest = rest.docs
      .map((d) => ({ id: d.id, createdAt: (d.data() as ClassDoc).createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    await updateDoc(doc(db, "courses", courseId), { activeExerciseId: newest?.id ?? null });
  }
}

/** Deletes a whole class: all its exercises with everything in them, then the class itself. */
export async function deleteCourse(courseId: string) {
  await releaseNicknames(courseId); // while the class still exists: the server checks that it is the teacher's
  const exercises = await getDocs(query(collection(db, "classes"), where("courseId", "==", courseId)));
  for (const e of exercises.docs) await deleteExercise(e.id);
  await deleteDoc(doc(db, "courses", courseId));
}

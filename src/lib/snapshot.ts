import { collection, doc, getDocs, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { runSegments } from "./segments";
import type { OriginalText, RunDoc } from "./types";

/**
 * Saves a copy of a group's current text on the group, so the original can still be
 * shown after reviewers have made corrections. Does nothing if a copy already exists.
 */
export async function saveOriginalText(classId: string, groupId: string, alreadySaved?: boolean) {
  if (alreadySaved) return;
  const snap = await getDocs(
    query(collection(db, "classes", classId, "groups", groupId, "runs"), orderBy("order", "asc"))
  );
  const paragraphs = snap.docs
    .map((d) => runSegments(d.data() as RunDoc))
    .filter((segments) => segments.length > 0)
    .map((segments) => ({ segments }));
  const original: OriginalText = { takenAt: Date.now(), paragraphs };
  await updateDoc(doc(db, "classes", classId, "groups", groupId), { original });
}

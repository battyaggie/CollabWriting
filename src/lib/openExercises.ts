"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ClassDoc } from "@/lib/types";

export type ExerciseRow = ClassDoc & { id: string };

/**
 * The exercises of a class (course) that students can still work in: every exercise that has not been
 * closed, oldest first. Nothing extra is stored for this: "open" simply means status is not "completed".
 * (No orderBy next to where(): that would need a Firestore index, so the sorting happens here.)
 */
function openOnly(docs: { id: string; data: () => unknown }[]): ExerciseRow[] {
  return docs
    .map((d) => ({ id: d.id, ...(d.data() as ClassDoc) }))
    .filter((c) => c.status !== "completed")
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** One-off lookup, used when a student enters the class code. */
export async function fetchOpenExercises(courseId: string): Promise<ExerciseRow[]> {
  const snap = await getDocs(query(collection(db, "classes"), where("courseId", "==", courseId)));
  return openOnly(snap.docs);
}

/** Live list, used on the student's page so a newly opened exercise shows up by itself. */
export function useOpenExercises(courseId: string | null | undefined): ExerciseRow[] {
  const [rows, setRows] = useState<ExerciseRow[]>([]);
  useEffect(() => {
    if (!courseId) {
      setRows([]);
      return;
    }
    const unsub = onSnapshot(query(collection(db, "classes"), where("courseId", "==", courseId)), (snap) => {
      setRows(openOnly(snap.docs));
    });
    return () => unsub();
  }, [courseId]);
  return rows;
}

/** True when this browser already joined that exercise (so opening it goes straight back to the writing page). */
export function hasSessionFor(classId: string): boolean {
  try {
    return !!localStorage.getItem(`tw-session-${classId}`);
  } catch {
    return false;
  }
}

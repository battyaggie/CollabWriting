"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { DeletePanel } from "@/components/DeletePanel";
import { deleteCourse, deleteExercise } from "@/lib/deleteClass";
import type { ClassDoc, CourseDoc } from "@/lib/types";

const STATUS_LABEL: Record<ClassDoc["status"], { label: string; color: string }> = {
  waiting: { label: "Waiting Room", color: "#66A2C4" },
  grouped: { label: "Grouped", color: "#66A2C4" },
  live: { label: "Live", color: "#8BB31D" },
  completed: { label: "Closed", color: "#AAADAF" },
};

export default function MyClassesPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [classes, setClasses] = useState<(ClassDoc & { id: string })[]>([]);
  const [courses, setCourses] = useState<(CourseDoc & { id: string })[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/teacher/login");
        return;
      }
      setUid(user.uid);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!uid) return;
    // Deliberately no orderBy here: combining it with the where() below would
    // require a Firestore composite index. If that index doesn't exist, the
    // listener errors out silently (no error UI, no thrown exception visible
    // to the user) and `classes` just stays empty forever -- which looked
    // exactly like "you have no classes" even though they existed. Sorting
    // client-side avoids needing that index at all.
    const q = query(collection(db, "classes"), where("teacherId", "==", uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClassDoc) }));
        rows.sort((a, b) => b.createdAt - a.createdAt);
        setClasses(rows);
        setLoaded(true);
      },
      (err) => {
        console.error("Failed to load classes", err);
        setLoaded(true);
      }
    );
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "courses"), where("teacherId", "==", uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as CourseDoc) }));
        rows.sort((a, b) => b.createdAt - a.createdAt);
        setCourses(rows);
      },
      (err) => console.error("Failed to load classes", err)
    );
    return () => unsub();
  }, [uid]);

  function statusHref(c: ClassDoc & { id: string }) {
    if (c.status === "waiting") return `/teacher/classes/${c.id}/waiting-room`;
    if (c.status === "grouped") return `/teacher/classes/${c.id}/assign-groups`;
    return `/teacher/classes/${c.id}/dashboard`;
  }

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-display text-xs tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
            <h1 className="font-display text-2xl text-tw-navy m-0">My Classes</h1>
          </div>
          <button className="text-sm text-tw-grey underline" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>

        <Link href="/teacher/courses/new" className="tw-btn tw-btn-primary self-start">
          + New Class
        </Link>

        <div className="flex flex-col gap-3">
          {loaded && classes.length === 0 && courses.length === 0 && (
            <p className="text-sm text-tw-grey">No classes yet — create your first one above.</p>
          )}
          {courses.map((course) => {
            const mine = classes.filter((c) => c.courseId === course.id);
            const active = mine.find((c) => c.id === course.activeExerciseId) ?? mine[0];
            return (
              <div key={course.id} className="flex flex-col gap-2">
                <div className="bg-white border border-tw-grey-light rounded-xl flex items-center hover:border-tw-blue-light">
                  <Link
                    href={`/teacher/courses/${course.id}`}
                    className="flex-1 min-w-0 p-5 flex items-center justify-between gap-4 no-underline"
                  >
                    <div className="min-w-0">
                      <p className="font-display text-base text-tw-navy m-0">
                        {course.semester} &middot; {course.className}
                      </p>
                      <p className="text-sm text-tw-grey m-0">
                        Class code <span className="font-mono font-bold text-tw-blue">{course.courseCode}</span> &middot;{" "}
                        {mine.length} {mine.length === 1 ? "exercise" : "exercises"}
                        {active ? ` · latest: ${active.taskName}` : ""}
                      </p>
                    </div>
                    {active && (
                      <span
                        className="text-xs font-bold rounded-full px-3 py-1.5 text-white flex-none"
                        style={{ background: STATUS_LABEL[active.status].color }}
                      >
                        {STATUS_LABEL[active.status].label}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    className="text-sm text-tw-grey underline px-5"
                    onClick={() => setDeleting(`course:${course.id}`)}
                  >
                    Delete
                  </button>
                </div>
                {deleting === `course:${course.id}` && (
                  <DeletePanel
                    title={`Delete the class ${course.className}?`}
                    description={`This permanently deletes the class, its ${mine.length} ${mine.length === 1 ? "exercise" : "exercises"}, all texts, comments and feedback. It cannot be undone. Export the feedback as CSV first if you still need it for grading.`}
                    confirmWord={course.courseCode}
                    onDelete={async () => {
                      await deleteCourse(course.id);
                      setDeleting(null);
                    }}
                    onCancel={() => setDeleting(null)}
                  />
                )}
              </div>
            );
          })}

          {classes.some((c) => !c.courseId) && (
            <p className="text-xs text-tw-grey tracking-wide uppercase mt-4 mb-0">Single sessions (no class)</p>
          )}
          {classes
            .filter((c) => !c.courseId)
            .map((c) => (
              <div key={c.id} className="flex flex-col gap-2">
                <div className="bg-white border border-tw-grey-light rounded-xl flex items-center hover:border-tw-blue-light">
                  <Link
                    href={statusHref(c)}
                    className="flex-1 min-w-0 p-5 flex items-center justify-between gap-4 no-underline"
                  >
                    <div>
                      <p className="font-display text-base text-tw-navy m-0">
                        {c.semester} &middot; {c.className}
                      </p>
                      <p className="text-sm text-tw-grey m-0">{c.taskName}</p>
                    </div>
                    <span
                      className="text-xs font-bold rounded-full px-3 py-1.5 text-white flex-none"
                      style={{ background: STATUS_LABEL[c.status].color }}
                    >
                      {STATUS_LABEL[c.status].label}
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="text-sm text-tw-grey underline px-5"
                    onClick={() => setDeleting(`class:${c.id}`)}
                  >
                    Delete
                  </button>
                </div>
                {deleting === `class:${c.id}` && (
                  <DeletePanel
                    title={`Delete ${c.className} — ${c.taskName}?`}
                    description="This permanently deletes the session with all texts, comments and feedback. It cannot be undone. Export the feedback as CSV first if you still need it for grading."
                    confirmWord={c.classCode}
                    onDelete={async () => {
                      await deleteExercise(c.id);
                      setDeleting(null);
                    }}
                    onCancel={() => setDeleting(null)}
                  />
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

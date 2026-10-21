"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { makeClassCode } from "@/lib/classCode";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import { DeletePanel } from "@/components/DeletePanel";
import { deleteCourse, deleteExerciseOfCourse } from "@/lib/deleteClass";
import type { ClassDoc, CourseDoc } from "@/lib/types";

const STATUS_LABEL: Record<ClassDoc["status"], { label: string; color: string }> = {
  waiting: { label: "Waiting Room", color: "#66A2C4" },
  grouped: { label: "Grouped", color: "#66A2C4" },
  live: { label: "Live", color: "#8BB31D" },
  completed: { label: "Closed", color: "#AAADAF" },
};

type Exercise = ClassDoc & { id: string };

export default function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseDoc | null | undefined>(undefined);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [taskName, setTaskName] = useState("");
  const [groupSize, setGroupSize] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin.replace(/^https?:\/\//, ""));
  }, []);

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
    const unsub = onSnapshot(doc(db, "courses", courseId), (snap) => {
      if (!snap.exists()) {
        setCourse(null);
        return;
      }
      const data = snap.data() as CourseDoc;
      setCourse(data);
      setGroupSize((g) => (g === 4 ? data.targetGroupSize : g));
    });
    return () => unsub();
  }, [courseId]);

  useEffect(() => {
    // No orderBy next to where(): that would need a Firestore index. Sorted below instead.
    const q = query(collection(db, "classes"), where("courseId", "==", courseId));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClassDoc) }));
      rows.sort((a, b) => b.createdAt - a.createdAt);
      setExercises(rows);
    });
    return () => unsub();
  }, [courseId]);

  function href(c: Exercise) {
    if (c.status === "waiting") return `/teacher/classes/${c.id}/waiting-room`;
    if (c.status === "grouped") return `/teacher/classes/${c.id}/assign-groups`;
    return `/teacher/classes/${c.id}/dashboard`;
  }

  async function createExercise(e: React.FormEvent) {
    e.preventDefault();
    if (!course || !uid || !taskName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let classId = "";
      for (let i = 1; i <= 99; i++) {
        const candidate = makeClassCode(course.className, i);
        const snap = await getDoc(doc(db, "classes", candidate));
        if (!snap.exists()) {
          classId = candidate;
          break;
        }
      }
      if (!classId) {
        setError("Couldn't generate a free exercise code.");
        setBusy(false);
        return;
      }
      const data: ClassDoc = {
        classCode: classId,
        courseId: course.courseCode,
        teacherId: uid,
        semester: course.semester,
        className: course.className,
        taskName: taskName.trim(),
        targetGroupSize: groupSize,
        status: "waiting",
        hotSeatGroupId: null,
        nextColorIndex: 0,
        createdAt: Date.now(),
      };
      await setDoc(doc(db, "classes", classId), data);
      await updateDoc(doc(db, "courses", course.courseCode), { activeExerciseId: classId });
      router.push(`/teacher/classes/${classId}/waiting-room`);
    } catch (err) {
      console.error(err);
      setError("Something went wrong creating the exercise.");
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: ClassDoc["status"]) {
    await updateDoc(doc(db, "classes", id), { status });
  }

  async function makeActive(id: string) {
    await updateDoc(doc(db, "courses", courseId), { activeExerciseId: id });
  }

  if (course === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">Loading&hellip;</p>
      </div>
    );
  }
  if (course === null || (uid && course.teacherId !== uid)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">This class wasn&rsquo;t found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6">
        <a href="/teacher/classes" className="text-sm text-tw-blue no-underline">
          &larr; My Classes
        </a>
        <div>
          <span className="font-display text-xs tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
          <h1 className="font-display text-2xl text-tw-navy m-0">
            {course.semester} &middot; {course.className}
          </h1>
        </div>

        <div className="bg-white border border-tw-grey-light rounded-xl p-6 flex items-center justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-tw-grey">Students go to</span>
            <span className="font-mono text-base text-tw-navy font-bold">{origin}/join</span>
            <span className="text-xs text-tw-grey">and enter the class code (the same every week)</span>
          </div>
          <span className="font-mono text-4xl text-tw-blue font-bold tracking-wide">{course.courseCode}</span>
        </div>

        <form onSubmit={createExercise} className="bg-white border border-tw-grey-light rounded-xl p-6 flex flex-col gap-4">
          <h2 className="font-display text-lg text-tw-navy m-0">New writing exercise</h2>
          <p className="text-sm text-tw-grey m-0">
            Students who enter the class code after this go to the new exercise. Earlier exercises and their
            feedback stay available below.
          </p>
          <div className="flex gap-4">
            <div className="tw-field flex-1">
              <label htmlFor="taskName">Exercise name</label>
              <input
                id="taskName"
                placeholder="e.g. Week 3 — Writing an email"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                required
              />
            </div>
            <div className="tw-field w-32">
              <label htmlFor="groupSize">Group size</label>
              <input
                id="groupSize"
                type="number"
                min={2}
                max={8}
                value={groupSize}
                onChange={(e) => setGroupSize(Number(e.target.value))}
              />
            </div>
          </div>
          <PrivacyNotice label="Notice students will see" caption="Shown on the join screen and in the waiting room." />
          {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
          <button type="submit" className="tw-btn tw-btn-primary self-start" disabled={busy}>
            {busy ? "Creating…" : "Create Exercise & Open Waiting Room"}
          </button>
        </form>

        <div className="flex flex-col gap-3">
          <h2 className="font-display text-lg text-tw-navy m-0">Exercises</h2>
          {exercises.length === 0 && <p className="text-sm text-tw-grey m-0">No exercises yet &mdash; create the first one above.</p>}
          {exercises.map((c) => (
            <div key={c.id} className="flex flex-col gap-2">
            <div className="bg-white border border-tw-grey-light rounded-xl p-5 flex items-center justify-between gap-4">
              <a href={href(c)} className="no-underline min-w-0 flex-1">
                <p className="font-display text-base text-tw-navy m-0">{c.taskName}</p>
                <p className="text-sm text-tw-grey m-0">
                  {new Date(c.createdAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                  {course.activeExerciseId === c.id && " · students joining now"}
                </p>
              </a>
              {course.activeExerciseId !== c.id && (
                <button type="button" className="text-sm text-tw-blue" onClick={() => makeActive(c.id)}>
                  Let students join this one
                </button>
              )}
              <span
                className="text-xs font-bold rounded-full px-3 py-1.5 text-white"
                style={{ background: STATUS_LABEL[c.status].color }}
              >
                {STATUS_LABEL[c.status].label}
              </span>
              {c.status === "completed" ? (
                <button type="button" className="text-sm text-tw-blue" onClick={() => setStatus(c.id, "live")}>
                  Reopen
                </button>
              ) : (
                <button
                  type="button"
                  className="text-sm text-tw-blue"
                  onClick={() => {
                    if (window.confirm(`Close “${c.taskName}”? Students will still see their text and feedback, but nothing can be changed any more. You can reopen it later.`))
                      setStatus(c.id, "completed");
                  }}
                >
                  Close
                </button>
              )}
              <button type="button" className="text-sm text-tw-grey underline" onClick={() => setDeleting(c.id)}>
                Delete
              </button>
            </div>
            {deleting === c.id && (
              <DeletePanel
                title={`Delete the exercise “${c.taskName}”?`}
                description="This permanently deletes this exercise with all texts, comments and feedback. The class and its other exercises stay. It cannot be undone. Export the feedback as CSV first if you still need it for grading."
                onDelete={async () => {
                  await deleteExerciseOfCourse(courseId, c.id, course.activeExerciseId);
                  setDeleting(null);
                }}
                onCancel={() => setDeleting(null)}
              />
            )}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 mt-6">
          {deleting === "course" ? (
            <DeletePanel
              title={`Delete the class ${course.className}?`}
              description={`This permanently deletes the class, its ${exercises.length} ${exercises.length === 1 ? "exercise" : "exercises"}, all texts, comments and feedback. It cannot be undone. Export the feedback as CSV first if you still need it for grading.`}
              confirmWord={course.courseCode}
              onDelete={async () => {
                await deleteCourse(courseId);
                router.push("/teacher/classes");
              }}
              onCancel={() => setDeleting(null)}
            />
          ) : (
            <button type="button" className="text-sm text-tw-grey underline self-start" onClick={() => setDeleting("course")}>
              Delete this class&hellip;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

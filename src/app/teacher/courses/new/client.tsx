"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { makeCourseCode } from "@/lib/classCode";
import type { CourseDoc } from "@/lib/types";

const SEMESTERS = ["WS 2026/27", "SS 2027", "WS 2027/28"];

export default function NewCoursePage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [semester, setSemester] = useState(SEMESTERS[0]);
  const [className, setClassName] = useState("");
  const [targetGroupSize, setTargetGroupSize] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !className.trim()) return;
    setLoading(true);
    setError(null);
    try {
      let code = "";
      for (let n = 1; n <= 99; n++) {
        const candidate = makeCourseCode(className, n);
        if (!candidate) break;
        const snap = await getDoc(doc(db, "courses", candidate));
        if (!snap.exists()) {
          code = candidate;
          break;
        }
      }
      if (!code) {
        setError("Couldn't make a class code from that name — use letters or numbers, e.g. BMR.");
        setLoading(false);
        return;
      }
      const data: CourseDoc = {
        courseCode: code,
        teacherId: uid,
        semester,
        className: className.trim(),
        targetGroupSize,
        activeExerciseId: null,
        createdAt: Date.now(),
      };
      await setDoc(doc(db, "courses", code), data);
      router.push(`/teacher/courses/${code}`);
    } catch (err) {
      console.error(err);
      setError("Something went wrong creating the class. If this keeps happening, the latest Firestore rules may not be published yet.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-tw-bg flex items-center justify-center">
      <div className="w-[520px] bg-white border border-tw-grey-light rounded-2xl p-10 flex flex-col gap-6">
        <div>
          <a href="/teacher/classes" className="text-sm text-tw-blue no-underline">
            &larr; My Classes
          </a>
          <span className="block font-display text-xs tracking-wide text-tw-blue mt-3">TECHNIKUM WIEN</span>
          <h1 className="font-display text-2xl text-tw-navy mt-1 mb-1">New Class</h1>
          <p className="text-sm text-tw-grey m-0">
            Create the class once. Students always use the same class code, and you open a new writing exercise
            in it whenever you need one (for example every week).
          </p>
        </div>
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="tw-field">
            <label htmlFor="semester">Semester</label>
            <select id="semester" value={semester} onChange={(e) => setSemester(e.target.value)}>
              {SEMESTERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="tw-field">
            <label htmlFor="className">Class name (this becomes the class code)</label>
            <input
              id="className"
              placeholder="e.g. BMR"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              required
            />
          </div>
          <div className="tw-field">
            <label htmlFor="groupSize">Usual group size</label>
            <input
              id="groupSize"
              type="number"
              min={2}
              max={8}
              value={targetGroupSize}
              onChange={(e) => setTargetGroupSize(Number(e.target.value))}
            />
          </div>
          {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
          <button type="submit" className="tw-btn tw-btn-primary" disabled={loading}>
            {loading ? "Creating…" : "Create Class"}
          </button>
        </form>
      </div>
    </div>
  );
}

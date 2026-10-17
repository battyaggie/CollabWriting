"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { makeClassCode } from "@/lib/classCode";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import type { ClassDoc } from "@/lib/types";

const SEMESTERS = ["WS 2026/27", "SS 2027", "WS 2027/28"];

export default function NewClassPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [semester, setSemester] = useState(SEMESTERS[0]);
  const [className, setClassName] = useState("");
  const [taskName, setTaskName] = useState("");
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
    if (!uid || !className.trim() || !taskName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // find a free class code (className-01, -02, ...)
      let classId = "";
      for (let i = 1; i <= 99; i++) {
        const candidate = makeClassCode(className, i);
        const snap = await getDoc(doc(db, "classes", candidate));
        if (!snap.exists()) {
          classId = candidate;
          break;
        }
      }
      if (!classId) {
        setError("Couldn't generate a free class code — try a different class name.");
        setLoading(false);
        return;
      }

      const data: ClassDoc = {
        classCode: classId,
        teacherId: uid,
        semester,
        className: className.trim(),
        taskName: taskName.trim(),
        targetGroupSize,
        status: "waiting",
        hotSeatGroupId: null,
        nextColorIndex: 0,
        createdAt: Date.now(),
      };
      await setDoc(doc(db, "classes", classId), data);
      router.push(`/teacher/classes/${classId}/waiting-room`);
    } catch (err) {
      console.error(err);
      setError("Something went wrong creating the class.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-tw-bg flex items-center justify-center">
      <div className="w-[520px] bg-white border border-tw-grey-light rounded-2xl p-10 flex flex-col gap-6">
        <div>
          <span className="font-display text-xs tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
          <h1 className="font-display text-2xl text-tw-navy mt-1 mb-0">New Class Session</h1>
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
            <label htmlFor="className">Class name</label>
            <input
              id="className"
              placeholder="e.g. 3AHITM"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              required
            />
          </div>
          <div className="tw-field">
            <label htmlFor="taskName">Task name</label>
            <input
              id="taskName"
              placeholder="e.g. Writing an Email"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              required
            />
          </div>
          <div className="tw-field">
            <label htmlFor="groupSize">Target group size</label>
            <input
              id="groupSize"
              type="number"
              min={2}
              max={8}
              value={targetGroupSize}
              onChange={(e) => setTargetGroupSize(Number(e.target.value))}
            />
          </div>
          <PrivacyNotice
            label="Notice students will see"
            caption="Shown on the join screen and in the waiting room."
          />
          {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
          <button type="submit" className="tw-btn tw-btn-primary" disabled={loading}>
            {loading ? "Creating…" : "Open Waiting Room & Get Class Code"}
          </button>
        </form>
      </div>
    </div>
  );
}

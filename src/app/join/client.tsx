"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db, ensureAnonymousUser } from "@/lib/firebase";
import { normalizeCode } from "@/lib/classCode";
import type { ClassDoc, StudentSession } from "@/lib/types";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const classId = normalizeCode(code);
    const alias = name.trim();
    if (!classId) {
      setError("Enter the class code your teacher gave you.");
      return;
    }
    if (!alias) {
      setError("Enter a name or nickname.");
      return;
    }
    setLoading(true);
    try {
      const classRef = doc(db, "classes", classId);
      const classSnap = await getDoc(classRef);
      if (!classSnap.exists()) {
        setError("That class code wasn't found. Double-check it with your teacher.");
        setLoading(false);
        return;
      }
      const classData = classSnap.data() as ClassDoc;
      if (classData.status === "completed") {
        setError("This session has already ended.");
        setLoading(false);
        return;
      }

      const user = await ensureAnonymousUser();
      const studentRef = doc(db, "classes", classId, "students", user.uid);

      await runTransaction(db, async (tx) => {
        const existing = await tx.get(studentRef);
        if (existing.exists()) {
          tx.update(studentRef, { alias });
          return;
        }
        const freshClassSnap = await tx.get(classRef);
        const freshClass = freshClassSnap.data() as ClassDoc;
        const colorIndex = freshClass.nextColorIndex ?? 0;
        tx.update(classRef, { nextColorIndex: colorIndex + 1 });
        tx.set(studentRef, {
          alias,
          colorIndex,
          groupId: null,
          joinedAt: Date.now(),
        });
      });

      const session: StudentSession = { classId, studentId: user.uid, alias };
      localStorage.setItem(`tw-session-${classId}`, JSON.stringify(session));
      router.push(`/s/${classId}`);
    } catch (err) {
      console.error(err);
      setError("Something went wrong joining the class. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-tw-bg relative">
      <div className="w-[480px] bg-white border border-tw-grey-light rounded-2xl p-12 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="font-display text-sm tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
          <h1 className="font-display text-3xl text-tw-navy m-0">Collaborative Writing</h1>
          <p className="text-[15px] text-tw-grey m-0">Enter the class code your teacher gave you</p>
        </div>
        <form onSubmit={handleJoin} className="flex flex-col gap-4">
          <div className="tw-field">
            <label htmlFor="tw-code">Class code</label>
            <input
              id="tw-code"
              type="text"
              placeholder="e.g. 3AHITM-04"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono text-lg tracking-wide text-center"
              autoFocus
            />
          </div>
          <div className="tw-field">
            <label htmlFor="tw-name">Your name</label>
            <input
              id="tw-name"
              type="text"
              placeholder="e.g. Anna, or a nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
          <button type="submit" className="tw-btn tw-btn-primary" disabled={loading}>
            {loading ? "Joining…" : "Join Session"}
          </button>
        </form>
        <p className="text-[13px] text-tw-grey text-center m-0">
          Any name or nickname is fine &mdash; check with your teacher how they&rsquo;ll match it to you for grading.
        </p>
      </div>
      <a
        href="/teacher/login"
        className="absolute left-1/2 bottom-8 -translate-x-1/2 text-[13px] text-tw-grey underline whitespace-nowrap"
      >
        Teaching this class? Start a session
      </a>
    </div>
  );
}

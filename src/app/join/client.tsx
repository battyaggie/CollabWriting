"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, getDocs, runTransaction, updateDoc } from "firebase/firestore";
import { auth, db, ensureAnonymousUser } from "@/lib/firebase";
import { normalizeCode } from "@/lib/classCode";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import type { ClassDoc, CourseDoc, StudentSession } from "@/lib/types";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Remember the class code and nickname from last time (and accept ?code=BMR in the address).
  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem("tw-last-join") ?? "null") as { code?: string; alias?: string } | null;
      const fromUrl = new URLSearchParams(window.location.search).get("code");
      if (fromUrl) setCode(fromUrl);
      else if (last?.code) setCode(last.code);
      if (last?.alias) setName(last.alias);
    } catch {
      /* nothing remembered: fine */
    }
  }, []);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const typedCode = normalizeCode(code);
    let classId = typedCode;
    const alias = name.trim();
    if (!typedCode) {
      setError("Enter the class code your teacher gave you.");
      return;
    }
    if (!alias) {
      setError("Enter a nickname.");
      return;
    }
    setLoading(true);
    try {
      let classSnap = await getDoc(doc(db, "classes", classId));
      if (!classSnap.exists()) {
        // Not an exercise code: maybe the code of a whole class (e.g. "BMR"), which leads to the exercise open now.
        const courseSnap = await getDoc(doc(db, "courses", typedCode));
        if (courseSnap.exists()) {
          const active = (courseSnap.data() as CourseDoc).activeExerciseId;
          if (!active) {
            setError("Your teacher hasn't opened an exercise yet. Please try again in a moment.");
            setLoading(false);
            return;
          }
          classId = active;
          classSnap = await getDoc(doc(db, "classes", classId));
        }
      }
      if (!classSnap.exists()) {
        setError("That class code wasn't found. Double-check it with your teacher.");
        setLoading(false);
        return;
      }
      const classData = classSnap.data() as ClassDoc;
      if (classData.status === "completed") {
        setError("This exercise is closed, so it can no longer be joined.");
        setLoading(false);
        return;
      }

      const user = await ensureAnonymousUser();
      const studentRef = doc(db, "classes", classId, "students", user.uid);

      // Students may not write to the class record (only the teacher can), so the
      // colour is chosen here: the lowest colour not yet used by anyone in the class.
      // Two students joining at the very same moment could get the same colour.
      const rosterSnap = await getDocs(collection(db, "classes", classId, "students"));
      const used = new Set(rosterSnap.docs.map((d) => (d.data() as { colorIndex?: number }).colorIndex));
      let colorIndex = 0;
      while (used.has(colorIndex)) colorIndex++;

      await runTransaction(db, async (tx) => {
        const existing = await tx.get(studentRef);
        if (existing.exists()) {
          tx.update(studentRef, { alias });
          return;
        }
        tx.set(studentRef, {
          alias,
          colorIndex,
          groupId: null,
          joinedAt: Date.now(),
        });
      });

      // If two students joined at the very same moment and got the same colour, the one who joined
      // later picks another one (before writing anything), so every colour belongs to one student.
      const check = await getDocs(collection(db, "classes", classId, "students"));
      const roster = check.docs.map((d) => ({ id: d.id, ...(d.data() as { colorIndex?: number; joinedAt?: number }) }));
      const me = roster.find((r) => r.id === user.uid);
      if (me) {
        const clash = roster.some(
          (r) =>
            r.id !== user.uid &&
            r.colorIndex === me.colorIndex &&
            ((r.joinedAt ?? 0) < (me.joinedAt ?? 0) || ((r.joinedAt ?? 0) === (me.joinedAt ?? 0) && r.id < user.uid))
        );
        if (clash) {
          const taken = new Set(roster.filter((r) => r.id !== user.uid).map((r) => r.colorIndex));
          let free = 0;
          while (taken.has(free)) free++;
          await updateDoc(studentRef, { colorIndex: free });
        }
      }

      const session: StudentSession = { classId, studentId: user.uid, alias };
      localStorage.setItem(`tw-session-${classId}`, JSON.stringify(session));
      localStorage.setItem("tw-last-join", JSON.stringify({ code: typedCode, alias }));
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
            <label htmlFor="tw-name">Your nickname</label>
            <input
              id="tw-name"
              type="text"
              placeholder="e.g. Anna_K, or any nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
          <button type="submit" className="tw-btn tw-btn-primary" disabled={loading}>
            {loading ? "Joining…" : "Join Session"}
          </button>
        </form>
        <PrivacyNotice />
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

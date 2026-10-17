"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RosterChips } from "@/components/RosterChips";
import type { ClassDoc, StudentDoc } from "@/lib/types";

export default function WaitingRoomPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [classData, setClassData] = useState<(ClassDoc & { id: string }) | null>(null);
  const [students, setStudents] = useState<(StudentDoc & { id: string })[]>([]);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin.replace(/^https?:\/\//, ""));
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "classes", classId), (snap) => {
      setClassData(snap.exists() ? ({ id: snap.id, ...(snap.data() as ClassDoc) }) : null);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    const q = query(collection(db, "classes", classId, "students"), orderBy("joinedAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as StudentDoc) })));
    });
    return () => unsub();
  }, [classId]);

  if (!classData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">Loading&hellip;</p>
      </div>
    );
  }

  const joinUrl = `${origin}/join`;

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col gap-2">
        <a href="/teacher/classes" className="text-sm text-tw-blue no-underline">
          &larr; My Classes
        </a>
        <h1 className="font-display text-2xl text-tw-navy m-0">
          Waiting Room &mdash; {classData.semester} &middot; {classData.className}
        </h1>
        <p className="text-sm text-tw-grey mt-0 mb-6">
          {classData.taskName} &middot; students join on their own device, then you form the groups.
        </p>

        <div className="flex gap-8">
          <div className="w-[340px] flex-none bg-white border border-tw-grey-light rounded-xl p-8 flex flex-col items-center gap-5 text-center">
            <div className="flex flex-col gap-2">
              <span className="text-xs text-tw-grey">Most students will type this in on their laptop</span>
              <span className="text-xs text-tw-grey mt-1.5">Go to</span>
              <span className="font-mono text-base text-tw-navy font-bold">{joinUrl}</span>
              <span className="text-xs text-tw-grey">and enter class code</span>
              <span className="font-mono text-3xl text-tw-blue font-bold tracking-wide">{classData.classCode}</span>
            </div>
            <div className="w-full bg-[#EAF1F5] border border-tw-blue-light rounded-lg p-3">
              <span className="text-xs text-tw-navy">
                Runs on your Firebase project &mdash; only your class can see this data.
              </span>
            </div>
          </div>

          <div className="flex-1 bg-white border border-tw-grey-light rounded-xl p-7 flex flex-col gap-5 min-w-0">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-tw-navy m-0">Students who have joined</h2>
              <span className="bg-tw-green text-white font-bold text-sm rounded-full px-3.5 py-1.5">
                {students.length} joined
              </span>
            </div>
            <RosterChips people={students} />
            <p className="text-sm text-tw-grey italic m-0">
              Waiting for more students to join&hellip; you don&rsquo;t have to wait for everyone.
            </p>
            <div className="mt-auto flex items-center gap-4 pt-4 border-t border-tw-border">
              <button
                className="tw-btn tw-btn-primary"
                disabled={students.length === 0}
                onClick={() => router.push(`/teacher/classes/${classId}/assign-groups?mode=random`)}
              >
                Form Groups Randomly
              </button>
              <button
                className="text-sm text-tw-blue"
                disabled={students.length === 0}
                onClick={() => router.push(`/teacher/classes/${classId}/assign-groups`)}
              >
                I&rsquo;ll assign them myself
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

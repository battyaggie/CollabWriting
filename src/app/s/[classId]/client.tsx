"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { GroupWriter } from "@/components/GroupWriter";
import { FeedbackThread } from "@/components/FeedbackThread";
import { colorFor } from "@/lib/colors";
import type { ClassDoc, StudentDoc, StudentSession } from "@/lib/types";

export default function StudentClassPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<StudentSession | null>(null);
  const [classData, setClassData] = useState<ClassDoc | null>(null);
  const [student, setStudent] = useState<StudentDoc | null>(null);
  const [tab, setTab] = useState<"write" | "feedback">("write");

  useEffect(() => {
    const raw = localStorage.getItem(`tw-session-${classId}`);
    if (!raw) {
      router.replace("/join");
      return;
    }
    setSession(JSON.parse(raw));
  }, [classId, router]);

  useEffect(() => {
    if (!classId) return;
    const unsub = onSnapshot(doc(db, "classes", classId), (snap) => {
      setClassData(snap.exists() ? (snap.data() as ClassDoc) : null);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    if (!classId || !session) return;
    const unsub = onSnapshot(doc(db, "classes", classId, "students", session.studentId), (snap) => {
      setStudent(snap.exists() ? (snap.data() as StudentDoc) : null);
    });
    return () => unsub();
  }, [classId, session]);

  if (!session || !classData || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">Loading&hellip;</p>
      </div>
    );
  }

  if (!student.groupId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <div className="w-[420px] bg-white border border-tw-grey-light rounded-2xl p-10 flex flex-col gap-3 text-center">
          <h1 className="font-display text-xl text-tw-navy m-0">You&rsquo;re in, {session.alias}!</h1>
          <p className="text-sm text-tw-grey m-0">
            {classData.className} &middot; {classData.taskName}
          </p>
          <p className="text-sm text-tw-grey m-0">Waiting for your teacher to form the groups&hellip;</p>
        </div>
      </div>
    );
  }

  const isHotSeat = classData.hotSeatGroupId === student.groupId;

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-display text-xs tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
            <h1 className="font-display text-xl text-tw-navy m-0">{classData.taskName}</h1>
          </div>
          <span
            className="tw-chip"
            style={{ background: "#F4F5F6" }}
          >
            <span
              className="w-3 h-3 rounded-full inline-block"
              style={{ background: colorFor(student.colorIndex) }}
            />
            <span className="text-sm">{session.alias}</span>
          </span>
        </div>

        <div className="flex gap-2">
          <button
            className={`tw-btn ${tab === "write" ? "tw-btn-primary" : "tw-btn-secondary"}`}
            onClick={() => setTab("write")}
          >
            Our Writing
          </button>
          <button
            className={`tw-btn ${tab === "feedback" ? "tw-btn-primary" : "tw-btn-secondary"}`}
            onClick={() => setTab("feedback")}
            disabled={!classData.hotSeatGroupId}
          >
            Give Feedback
          </button>
        </div>

        {tab === "write" && (
          <GroupWriter
            classId={classId}
            groupId={student.groupId}
            studentId={session.studentId}
            alias={session.alias}
            colorIndex={student.colorIndex}
          />
        )}

        {tab === "feedback" && classData.hotSeatGroupId && (
          <div className="bg-white border border-tw-grey-light rounded-xl p-8">
            <h2 className="font-display text-lg text-tw-navy mt-0 mb-1">
              {isHotSeat ? "Your group is in the hot seat" : "Feedback for the group on the projector"}
            </h2>
            <p className="text-sm text-tw-grey mt-0 mb-5">
              {isHotSeat
                ? "Here's what the rest of the class is saying about your writing."
                : "Read their writing on the projector, then share what's working and what could be clearer."}
            </p>
            <FeedbackThread
              classId={classId}
              groupId={classData.hotSeatGroupId}
              studentId={session.studentId}
              alias={session.alias}
              colorIndex={student.colorIndex}
              readOnly={isHotSeat}
            />
          </div>
        )}
      </div>
    </div>
  );
}

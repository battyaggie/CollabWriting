"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { GroupWriter } from "@/components/GroupWriter";
import { WaitingScreen } from "@/components/WaitingScreen";
import { CommentComposer, FeedbackThread, anchorsOf, useFeedbackEntries } from "@/components/FeedbackThread";
import { colorFor } from "@/lib/colors";
import type { ClassDoc, GroupDoc, StudentDoc, StudentSession } from "@/lib/types";

export default function StudentClassPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<StudentSession | null>(null);
  const [classData, setClassData] = useState<ClassDoc | null>(null);
  const [student, setStudent] = useState<StudentDoc | null>(null);
  const [tab, setTab] = useState<"write" | "feedback">("write");
  const [groups, setGroups] = useState<Record<string, GroupDoc>>({});
  const [roster, setRoster] = useState<(StudentDoc & { id: string })[]>([]);

  const ownGroupId = student?.groupId ?? null;
  const reviewsId = ownGroupId ? groups[ownGroupId]?.reviewsGroupId ?? null : null;
  // Comments on highlighted words: marked in the text of the group they are about.
  const ownAnchors = anchorsOf(useFeedbackEntries(classId, ownGroupId));
  const reviewAnchors = anchorsOf(useFeedbackEntries(classId, reviewsId));

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

  useEffect(() => {
    if (!classId) return;
    const unsub = onSnapshot(collection(db, "classes", classId, "groups"), (snap) => {
      const next: Record<string, GroupDoc> = {};
      snap.docs.forEach((d) => (next[d.id] = d.data() as GroupDoc));
      setGroups(next);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    if (!classId) return;
    const unsub = onSnapshot(collection(db, "classes", classId, "students"), (snap) => {
      setRoster(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as StudentDoc) }))
          .sort((a, b) => a.joinedAt - b.joinedAt)
      );
    });
    return () => unsub();
  }, [classId]);

  if (!session || !classData || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">Loading&hellip;</p>
      </div>
    );
  }

  // Until the teacher has formed the groups AND pressed start, everyone waits here.
  if (!student.groupId || classData.status === "waiting" || classData.status === "grouped") {
    const groupName = student.groupId ? groups[student.groupId]?.name ?? null : null;
    const groupMates = student.groupId
      ? roster.filter((r) => r.groupId === student.groupId && r.id !== session.studentId)
      : [];
    return (
      <WaitingScreen
        classData={classData}
        alias={session.alias}
        colorIndex={student.colorIndex}
        roster={roster}
        groupName={groupName}
        groupMates={groupMates}
      />
    );
  }

  const isHotSeat = classData.hotSeatGroupId === student.groupId;
  const reviewsName = reviewsId ? groups[reviewsId]?.name ?? "another group" : null;
  const showHotSeatPanel = !!classData.hotSeatGroupId && classData.hotSeatGroupId !== reviewsId;
  const canGiveFeedback = !!classData.hotSeatGroupId || !!reviewsId;

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
            disabled={!canGiveFeedback}
          >
            Give Feedback
          </button>
          <span className="flex-1" />
          <a
            href={`/s/${classId}/print`}
            target="_blank"
            rel="noreferrer"
            className="tw-btn tw-btn-secondary no-underline"
          >
            Print / Save as PDF
          </a>
        </div>

        {tab === "write" && reviewsId && (
          <div className="bg-[#EAF1F5] border border-tw-blue-light rounded-lg p-4 flex items-center justify-between gap-4">
            <span className="text-sm text-tw-navy">
              Your group can now read <strong>{reviewsName}</strong> and give them feedback.
            </span>
            <button className="tw-btn tw-btn-primary" onClick={() => setTab("feedback")}>
              Give Feedback
            </button>
          </div>
        )}

        {tab === "write" && (
          <GroupWriter
            classId={classId}
            groupId={student.groupId}
            studentId={session.studentId}
            alias={session.alias}
            colorIndex={student.colorIndex}
            anchors={ownAnchors}
          />
        )}

        {tab === "feedback" && reviewsId && (
          <div className="flex flex-col gap-4">
            <div className="bg-white border border-tw-grey-light rounded-xl p-8">
              <h2 className="font-display text-lg text-tw-navy mt-0 mb-1">Give feedback to {reviewsName}</h2>
              <p className="text-sm text-tw-grey mt-0 mb-5">
                Read their writing below and correct it directly &mdash; your corrections show in your colour
                (your teacher keeps a copy of the original). To comment on a particular part, select the words
                and press &ldquo;Comment on this&rdquo;. Use the box at the bottom for feedback on the whole text.
              </p>
              <GroupWriter
                classId={classId}
                groupId={reviewsId}
                studentId={session.studentId}
                alias={session.alias}
                colorIndex={student.colorIndex}
                anchors={reviewAnchors}
                renderCommentBox={(selection, close) => (
                  <CommentComposer
                    classId={classId}
                    groupId={reviewsId}
                    studentId={session.studentId}
                    alias={session.alias}
                    colorIndex={student.colorIndex}
                    selection={selection}
                    onDone={close}
                  />
                )}
              />
              <div className="mt-6">
                <FeedbackThread
                  classId={classId}
                  groupId={reviewsId}
                  studentId={session.studentId}
                  alias={session.alias}
                  colorIndex={student.colorIndex}
                />
              </div>
            </div>
          </div>
        )}

        {tab === "feedback" && showHotSeatPanel && (
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
              groupId={classData.hotSeatGroupId!}
              studentId={session.studentId}
              alias={session.alias}
              colorIndex={student.colorIndex}
              readOnly={isHotSeat}
            />
          </div>
        )}

        {tab === "feedback" && !isHotSeat && (
          <div className="bg-white border border-tw-grey-light rounded-xl p-8">
            <h2 className="font-display text-lg text-tw-navy mt-0 mb-1">Feedback on your group&rsquo;s writing</h2>
            <p className="text-sm text-tw-grey mt-0 mb-5">What other groups have said about your text so far.</p>
            <FeedbackThread
              classId={classId}
              groupId={student.groupId}
              studentId={session.studentId}
              alias={session.alias}
              colorIndex={student.colorIndex}
              readOnly
            />
          </div>
        )}
      </div>
    </div>
  );
}

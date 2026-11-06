"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { GroupWriter } from "@/components/GroupWriter";
import { ColorPicker } from "@/components/ColorPicker";
import { WaitingScreen } from "@/components/WaitingScreen";
import { CommentComposer, FeedbackThread, anchorsOf, useFeedbackEntries } from "@/components/FeedbackThread";
import { colorFor, isTeacherColor } from "@/lib/colors";
import type { ClassDoc, CourseDoc, GroupDoc, StudentDoc, StudentSession } from "@/lib/types";

export default function StudentClassPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<StudentSession | null>(null);
  const [classData, setClassData] = useState<ClassDoc | null>(null);
  const [student, setStudent] = useState<StudentDoc | null>(null);
  const [tab, setTab] = useState<"write" | "feedback" | "hotseat">("write");
  const [groups, setGroups] = useState<Record<string, GroupDoc>>({});
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [roster, setRoster] = useState<(StudentDoc & { id: string })[]>([]);

  const ownGroupId = student?.groupId ?? null;
  const reviewsId = ownGroupId ? groups[ownGroupId]?.reviewsGroupId ?? null : null;
  // Comments on highlighted words: marked in the text of the group they are about.
  const ownEntries = useFeedbackEntries(classId, ownGroupId);
  const ownAnchors = anchorsOf(ownEntries);
  const hasTeacherComments = ownEntries.some((e) => isTeacherColor(e.colorIndex));
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

  // If the teacher opens a newer exercise in the same class, offer a way into it.
  useEffect(() => {
    const courseId = classData?.courseId;
    if (!courseId) return;
    const unsub = onSnapshot(doc(db, "courses", courseId), (snap) => {
      setActiveExerciseId(snap.exists() ? (snap.data() as CourseDoc).activeExerciseId : null);
    });
    return () => unsub();
  }, [classData?.courseId]);

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
        classId={classId}
        studentId={session.studentId}
        classData={classData}
        alias={session.alias}
        colorIndex={student.colorIndex}
        roster={roster}
        groupName={groupName}
        groupMates={groupMates}
      />
    );
  }

  const closed = classData.status === "completed";
  const isHotSeat = classData.hotSeatGroupId === student.groupId;
  const reviewsName = reviewsId ? groups[reviewsId]?.name ?? "another group" : null;
  const hasHotSeat = !!classData.hotSeatGroupId;
  // If the projector stops showing a group while a student is on the Hot Seat tab, fall back to the writing tab.
  const activeTab = tab === "hotseat" && !hasHotSeat ? "write" : tab;

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
        {classData.courseId && activeExerciseId && activeExerciseId !== classId && (
          <div className="bg-[#EAF1F5] border border-tw-blue-light rounded-lg p-4 flex items-center justify-between gap-4">
            <span className="text-sm text-tw-navy">Your teacher has opened a new exercise for this class.</span>
            <a href={`/join?code=${encodeURIComponent(classData.courseId)}`} className="tw-btn tw-btn-primary no-underline">
              Join the new exercise
            </a>
          </div>
        )}
        {closed && (
          <div className="bg-[#EEEFF0] border border-tw-grey-light rounded-lg p-4 text-sm text-tw-navy">
            <strong>This exercise is closed.</strong> You can still read everything and print or save it, but nothing
            can be changed any more.
          </div>
        )}
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

        <div className="bg-white border border-tw-grey-light rounded-xl px-5 py-3">
          <ColorPicker
            classId={classId}
            studentId={session.studentId}
            colorIndex={student.colorIndex}
            roster={roster}
            disabled={closed}
          />
        </div>

        <div className="flex gap-2">
          <button
            className={`tw-btn ${activeTab === "write" ? "tw-btn-primary" : "tw-btn-secondary"}`}
            onClick={() => setTab("write")}
          >
            Our Writing
          </button>
          <button
            className={`tw-btn ${activeTab === "feedback" ? "tw-btn-primary" : "tw-btn-secondary"}`}
            onClick={() => setTab("feedback")}
            disabled={!reviewsId}
          >
            Give Feedback
          </button>
          {hasHotSeat && (
            <button
              className={`tw-btn ${activeTab === "hotseat" ? "tw-btn-primary" : "tw-btn-secondary"}`}
              onClick={() => setTab("hotseat")}
            >
              Hot Seat
            </button>
          )}
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

        {activeTab === "write" && hasHotSeat && (
          <div className="bg-[#FFF6D6] border border-[#FFE066] rounded-lg p-4 flex items-center justify-between gap-4">
            <span className="text-sm text-tw-navy">
              {isHotSeat ? (
                <>Your group is in the hot seat: the class can see your text on the projector.</>
              ) : (
                <>
                  <strong>{groups[classData.hotSeatGroupId!]?.name ?? "A group"}</strong> is on the projector.
                </>
              )}
            </span>
            <button className="tw-btn tw-btn-primary" onClick={() => setTab("hotseat")}>
              Hot Seat
            </button>
          </div>
        )}

        {activeTab === "write" && reviewsId && (
          <div className="bg-[#EAF1F5] border border-tw-blue-light rounded-lg p-4 flex items-center justify-between gap-4">
            <span className="text-sm text-tw-navy">
              Your group can now read <strong>{reviewsName}</strong> and give them feedback.
            </span>
            <button className="tw-btn tw-btn-primary" onClick={() => setTab("feedback")}>
              Give Feedback
            </button>
          </div>
        )}

        {activeTab === "write" && (
          <GroupWriter
            classId={classId}
            groupId={student.groupId}
            studentId={session.studentId}
            alias={session.alias}
            colorIndex={student.colorIndex}
            anchors={ownAnchors}
            readOnly={closed}
          />
        )}

        {activeTab === "write" && hasTeacherComments && (
          <div className="bg-white border border-tw-grey-light rounded-xl p-8">
            <h2 className="font-display text-lg text-tw-navy mt-0 mb-1">Comments from your teacher</h2>
            <p className="text-sm text-tw-grey mt-0 mb-5">
              Your teacher&rsquo;s corrections in your text and these comments are shown in red. Comments about
              particular words are highlighted in your text.
            </p>
            <FeedbackThread
              classId={classId}
              groupId={student.groupId}
              studentId={session.studentId}
              alias={session.alias}
              colorIndex={student.colorIndex}
              teacherOnly
              readOnly
            />
          </div>
        )}

        {activeTab === "feedback" && reviewsId && (
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
                readOnly={closed}
                trackChanges
                renderCommentBox={(selection, close) => (
                  <CommentComposer
                    classId={classId}
                    groupId={reviewsId}
                    studentId={session.studentId}
                    alias={session.alias}
                    colorIndex={student.colorIndex}
                    selection={selection}
                    onDone={close}
                    kind="peer"
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
                  readOnly={closed}
                  kind="peer"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === "hotseat" && hasHotSeat && (
          <div className="bg-white border border-tw-grey-light rounded-xl p-8">
            <h2 className="font-display text-lg text-tw-navy mt-0 mb-1">
              {isHotSeat ? "Your group is in the hot seat" : `Hot seat: feedback for ${groups[classData.hotSeatGroupId!]?.name ?? "the group on the projector"}`}
            </h2>
            <p className="text-sm text-tw-grey mt-0 mb-5">
              {isHotSeat
                ? "Here's what the rest of the class is saying about your writing."
                : "This is separate from the group you review. Read their writing on the projector, then share what's working and what could be clearer."}
            </p>
            <FeedbackThread
              classId={classId}
              groupId={classData.hotSeatGroupId!}
              studentId={session.studentId}
              alias={session.alias}
              colorIndex={student.colorIndex}
              readOnly={isHotSeat || closed}
              kind="hotseat"
            />
          </div>
        )}

        {activeTab === "feedback" && !isHotSeat && (
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

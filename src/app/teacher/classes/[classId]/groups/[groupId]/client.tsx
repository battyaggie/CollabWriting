"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db, waitForAuthUser } from "@/lib/firebase";
import { GroupWriter } from "@/components/GroupWriter";
import { CommentComposer, FeedbackThread, anchorsOf, useFeedbackEntries } from "@/components/FeedbackThread";
import { RosterChips } from "@/components/RosterChips";
import { TEACHER_ALIAS, TEACHER_COLOR, TEACHER_COLOR_INDEX } from "@/lib/colors";
import type { ClassDoc, GroupDoc, StudentDoc } from "@/lib/types";

type GroupRow = GroupDoc & { id: string };

/**
 * The teacher's view of one group while the students are writing: the group's live text, which the
 * teacher can correct directly (corrections show in red, the teacher's colour), plus comments on
 * highlighted words and on the whole text. Students see all of this on their own writing page.
 */
export default function TeacherGroupFeedbackPage() {
  const { classId, groupId } = useParams<{ classId: string; groupId: string }>();
  const [classData, setClassData] = useState<(ClassDoc & { id: string }) | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [members, setMembers] = useState<(StudentDoc & { id: string })[]>([]);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const entries = useFeedbackEntries(classId, groupId);

  useEffect(() => {
    waitForAuthUser().then(setUser);
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "classes", classId), (snap) => {
      setClassData(snap.exists() ? { id: snap.id, ...(snap.data() as ClassDoc) } : null);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "classes", classId, "groups"), orderBy("createdAt", "asc")), (snap) => {
      setGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as GroupDoc) })));
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "classes", classId, "students"), (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as StudentDoc) }));
      setMembers(all.filter((s) => s.groupId === groupId).sort((a, b) => a.joinedAt - b.joinedAt));
    });
    return () => unsub();
  }, [classId, groupId]);

  const group = groups.find((g) => g.id === groupId) ?? null;

  if (user === undefined || !classData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">Loading&hellip;</p>
      </div>
    );
  }

  // Only the signed-in teacher gives feedback here (a student's anonymous session must not).
  if (!user || user.isAnonymous) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <div className="bg-white border border-tw-grey-light rounded-xl p-8 max-w-md flex flex-col gap-4">
          <p className="m-0 text-tw-navy">Please sign in as a teacher to give feedback.</p>
          <a href="/teacher/login" className="tw-btn tw-btn-primary no-underline">
            Teacher sign-in
          </a>
        </div>
      </div>
    );
  }

  const closed = classData.status === "completed";

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
        <a href={`/teacher/classes/${classId}/dashboard`} className="text-sm text-tw-blue no-underline">
          &larr; Dashboard
        </a>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="font-display text-xs tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
              <h1 className="font-display text-xl text-tw-navy m-0">
                Feedback for {group?.name ?? "this group"} &mdash; {classData.taskName}
              </h1>
            </div>
            <span className="tw-chip" style={{ background: "#F4F5F6" }}>
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: TEACHER_COLOR }} />
              <span className="text-sm" style={{ color: TEACHER_COLOR }}>
                You are {TEACHER_ALIAS}
              </span>
            </span>
          </div>
          {groups.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a group">
              {groups.map((g) => (
                <a
                  key={g.id}
                  href={`/teacher/classes/${classId}/groups/${g.id}`}
                  className={`tw-btn no-underline ${g.id === groupId ? "tw-btn-primary" : "tw-btn-secondary"}`}
                  style={{ padding: "8px 14px", fontSize: 13 }}
                >
                  {g.name}
                </a>
              ))}
            </div>
          )}
          {members.length > 0 && <RosterChips people={members} />}
        </div>

        {closed && (
          <div className="bg-[#EEEFF0] border border-tw-grey-light rounded-lg p-4 text-sm text-tw-navy">
            <strong>This exercise is closed.</strong> Reopen it on the dashboard to give more feedback.
          </div>
        )}

        {!group ? (
          <p className="text-sm text-tw-grey italic">This group was not found.</p>
        ) : (
          <>
            <div className="bg-white border border-tw-grey-light rounded-xl p-8">
              <h2 className="font-display text-lg text-tw-navy mt-0 mb-1">Their writing, live</h2>
              <p className="text-sm text-tw-grey mt-0 mb-5">
                The students keep writing while you read. Correct the text directly &mdash; your corrections show in{" "}
                <strong style={{ color: TEACHER_COLOR }}>red</strong> and the students see them at once. To comment on
                a particular part, select the words and press &ldquo;Comment on this&rdquo;. Use the box below for
                feedback on the whole text.
              </p>
              <GroupWriter
                classId={classId}
                groupId={groupId}
                studentId={user.uid}
                alias={TEACHER_ALIAS}
                colorIndex={TEACHER_COLOR_INDEX}
                anchors={anchorsOf(entries)}
                readOnly={closed}
                renderCommentBox={(selection, close) => (
                  <CommentComposer
                    classId={classId}
                    groupId={groupId}
                    studentId={user.uid}
                    alias={TEACHER_ALIAS}
                    colorIndex={TEACHER_COLOR_INDEX}
                    selection={selection}
                    onDone={close}
                  />
                )}
              />
            </div>

            <div className="bg-white border border-tw-grey-light rounded-xl p-8">
              <h2 className="font-display text-lg text-tw-navy mt-0 mb-1">Feedback on {group.name}</h2>
              <p className="text-sm text-tw-grey mt-0 mb-5">
                All comments on this group&rsquo;s text so far, from you and from other groups. Your own comments are
                shown to the students on their writing page.
              </p>
              <FeedbackThread
                classId={classId}
                groupId={groupId}
                studentId={user.uid}
                alias={TEACHER_ALIAS}
                colorIndex={TEACHER_COLOR_INDEX}
                readOnly={closed}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

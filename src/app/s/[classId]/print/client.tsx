"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { GroupPrintSheet } from "@/components/GroupPrintSheet";
import type { ClassDoc, FeedbackDoc, GroupDoc, RunDoc, StudentDoc, StudentSession } from "@/lib/types";

/**
 * A student's own printout: their group's text (the original and the text with the
 * reviewers' corrections) and the feedback the group received, ready for "Save as PDF".
 */
export default function StudentPrintPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<StudentSession | null>(null);
  const [classData, setClassData] = useState<ClassDoc | null>(null);
  const [groupId, setGroupId] = useState<string | null | undefined>(undefined);
  const [group, setGroup] = useState<(GroupDoc & { id: string }) | null>(null);
  const [runs, setRuns] = useState<RunDoc[]>([]);
  const [feedback, setFeedback] = useState<(FeedbackDoc & { id: string })[]>([]);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const raw = localStorage.getItem(`tw-session-${classId}`);
    if (!raw) {
      router.replace("/join");
      return;
    }
    setSession(JSON.parse(raw));
  }, [classId, router]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "classes", classId), (snap) => {
      setClassData(snap.exists() ? (snap.data() as ClassDoc) : null);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    if (!session) return;
    const unsub = onSnapshot(doc(db, "classes", classId, "students", session.studentId), (snap) => {
      setGroupId(snap.exists() ? (snap.data() as StudentDoc).groupId : null);
    });
    return () => unsub();
  }, [classId, session]);

  useEffect(() => {
    if (!groupId) return;
    const base = ["classes", classId, "groups", groupId] as const;
    const unsubs = [
      onSnapshot(doc(db, ...base), (snap) => {
        setGroup(snap.exists() ? { id: snap.id, ...(snap.data() as GroupDoc) } : null);
      }),
      onSnapshot(query(collection(db, ...base, "runs"), orderBy("order", "asc")), (snap) => {
        setRuns(snap.docs.map((d) => d.data() as RunDoc));
      }),
      onSnapshot(query(collection(db, ...base, "feedback"), orderBy("createdAt", "asc")), (snap) => {
        setFeedback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeedbackDoc) })));
      }),
      onSnapshot(collection(db, "classes", classId, "students"), (snap) => {
        const ids = new Set<string>();
        snap.docs.forEach((d) => {
          if ((d.data() as StudentDoc).groupId === groupId) ids.add(d.id);
        });
        setMemberIds(ids);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [classId, groupId]);

  if (!session || !classData || groupId === undefined || (groupId && !group)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">Loading&hellip;</p>
      </div>
    );
  }

  if (!groupId || !group) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">You are not in a group yet, so there is nothing to print.</p>
      </div>
    );
  }

  return (
    <div className="bg-white text-tw-navy">
      <style>{`
        @media print {
          .tw-no-print { display: none !important; }
        }
        @page { margin: 1.6cm; }
      `}</style>

      <div className="tw-no-print sticky top-0 z-10 bg-tw-bg border-b border-tw-grey-light px-6 py-4 flex items-center justify-between">
        <div>
          <a href={`/s/${classId}`} className="text-sm text-tw-blue no-underline">
            &larr; Back to the writing
          </a>
          <p className="m-0 text-xs text-tw-grey">
            Your group&rsquo;s text, the corrections and the feedback. Use the Print dialog and choose &ldquo;Save as
            PDF&rdquo; as the destination.
          </p>
        </div>
        <button type="button" className="tw-btn tw-btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-10 py-10">
        <GroupPrintSheet classData={classData} group={group} allRuns={runs} feedback={feedback} memberIds={memberIds} />
      </div>
    </div>
  );
}

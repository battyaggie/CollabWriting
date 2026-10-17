"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import { runSegments } from "@/lib/segments";
import type { ClassDoc, FeedbackDoc, GroupDoc, RunDoc, Segment, StudentDoc } from "@/lib/types";

type GroupRow = GroupDoc & { id: string };

function CorrectedSegment({ seg, isReviewer }: { seg: Segment; isReviewer: boolean }) {
  if (!isReviewer) return <span style={{ color: colorFor(seg.colorIndex) }}>{seg.text}</span>;
  return (
    <span style={{ color: colorFor(seg.colorIndex), textDecoration: "underline", fontWeight: 600 }}>
      {seg.text}
      <sup className="text-[9px] font-normal no-underline"> {seg.alias}</sup>
    </span>
  );
}

/**
 * A plain, printable "one group per page" document: the group's writing,
 * then the feedback it received underneath -- so a lecturer grading on
 * paper (or a saved PDF) doesn't have to flip between two screens like the
 * CSV export requires. Uses the browser's own Print dialog ("Save as PDF"
 * is a built-in destination in every modern browser) rather than a PDF
 * library, since nothing else in this app needs a server or a heavy
 * client-side dependency.
 */
export default function PrintExportPage() {
  const { classId } = useParams<{ classId: string }>();
  const [classData, setClassData] = useState<(ClassDoc & { id: string }) | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [memberIdsByGroup, setMemberIdsByGroup] = useState<Record<string, Set<string>>>({});
  const [runsByGroup, setRunsByGroup] = useState<Record<string, RunDoc[]>>({});
  const [feedbackByGroup, setFeedbackByGroup] = useState<Record<string, (FeedbackDoc & { id: string })[]>>({});

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "classes", classId), (snap) => {
      setClassData(snap.exists() ? ({ id: snap.id, ...(snap.data() as ClassDoc) }) : null);
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
      const map: Record<string, Set<string>> = {};
      snap.docs.forEach((d) => {
        const st = d.data() as StudentDoc;
        if (st.groupId) (map[st.groupId] ??= new Set()).add(d.id);
      });
      setMemberIdsByGroup(map);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    if (groups.length === 0) return;
    const unsubs = groups.map((g) =>
      onSnapshot(
        query(collection(db, "classes", classId, "groups", g.id, "runs"), orderBy("order", "asc")),
        (snap) => {
          setRunsByGroup((prev) => ({ ...prev, [g.id]: snap.docs.map((d) => d.data() as RunDoc) }));
        }
      )
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.map((g) => g.id).join(",")]);

  useEffect(() => {
    if (groups.length === 0) return;
    const unsubs = groups.map((g) =>
      onSnapshot(
        query(collection(db, "classes", classId, "groups", g.id, "feedback"), orderBy("createdAt", "asc")),
        (snap) => {
          setFeedbackByGroup((prev) => ({
            ...prev,
            [g.id]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeedbackDoc) })),
          }));
        }
      )
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.map((g) => g.id).join(",")]);

  /** True if the text was written by someone who is not a member of this group (i.e. a reviewing student). */
  function isReviewer(groupId: string, seg: Segment): boolean {
    const members = memberIdsByGroup[groupId];
    return !!members && !members.has(seg.studentId);
  }

  if (!classData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">Loading&hellip;</p>
      </div>
    );
  }

  return (
    <div className="bg-white text-tw-navy">
      <style>{`
        @media print {
          .tw-no-print { display: none !important; }
          .tw-print-group { page-break-after: always; }
          .tw-print-group:last-child { page-break-after: auto; }
        }
        @page { margin: 1.6cm; }
      `}</style>

      <div className="tw-no-print sticky top-0 z-10 bg-tw-bg border-b border-tw-grey-light px-6 py-4 flex items-center justify-between">
        <div>
          <p className="m-0 text-sm text-tw-grey">
            {classData.semester} &middot; {classData.className} &middot; {classData.taskName}
          </p>
          <p className="m-0 text-xs text-tw-grey">
            One group per page &mdash; use your browser&rsquo;s Print dialog and choose &ldquo;Save as PDF&rdquo; as the
            destination.
          </p>
        </div>
        <button type="button" className="tw-btn tw-btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-10 py-10">
        {groups.length === 0 && <p className="text-tw-grey italic">No groups yet.</p>}
        {groups.map((g) => {
          const runs = (runsByGroup[g.id] ?? []).filter((r) => r.text.trim().length > 0);
          const feedback = feedbackByGroup[g.id] ?? [];
          return (
            <div key={g.id} className="tw-print-group pb-10 mb-10 border-b border-tw-border">
              <p className="text-xs text-tw-grey tracking-wide uppercase m-0">
                {classData.semester} &middot; {classData.className} &middot; {classData.taskName}
              </p>
              <h1 className="font-display text-2xl text-tw-navy mt-1 mb-6">{g.name}</h1>

              {g.original ? (
                <>
                  <h2 className="font-display text-sm text-tw-grey tracking-wide uppercase mt-0 mb-1">
                    Original text
                  </h2>
                  <p className="text-xs text-tw-grey mt-0 mb-3">
                    As the group had written it when it was linked to a reviewing group (
                    {new Date(g.original.takenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}).
                  </p>
                  {g.original.paragraphs.length === 0 && <p className="text-sm text-tw-grey italic">Nothing was written.</p>}
                  <div className="text-[15px] leading-[1.7] mb-8">
                    {g.original.paragraphs.map((para, i) => (
                      <p key={i} className="m-0 mb-3">
                        {para.segments.map((seg, j) => (
                          <span key={j} style={{ color: colorFor(seg.colorIndex) }}>
                            <strong>{seg.alias}: </strong>
                            {seg.text}{" "}
                          </span>
                        ))}
                      </p>
                    ))}
                  </div>

                  <h2 className="font-display text-sm text-tw-grey tracking-wide uppercase mt-0 mb-1">
                    Text with the reviewers&rsquo; corrections
                  </h2>
                  <p className="text-xs text-tw-grey mt-0 mb-3">
                    Underlined text was added by a student from another group; their nickname is shown in small
                    type. Words they deleted are no longer shown here &mdash; see the original above.
                  </p>
                </>
              ) : (
                <h2 className="font-display text-sm text-tw-grey tracking-wide uppercase mt-0 mb-3">Their Writing</h2>
              )}
              {runs.length === 0 && <p className="text-sm text-tw-grey italic">Nothing was written.</p>}
              <div className="text-[15px] leading-[1.7] mb-8">
                {runs.map((r, i) => (
                  <p key={i} className="m-0 mb-3">
                    {runSegments(r).map((seg, j) =>
                      g.original ? (
                        <CorrectedSegment key={j} seg={seg} isReviewer={isReviewer(g.id, seg)} />
                      ) : (
                        <span key={j} style={{ color: colorFor(seg.colorIndex) }}>
                          <strong>{seg.alias}: </strong>
                          {seg.text}{" "}
                        </span>
                      )
                    )}
                  </p>
                ))}
              </div>

              <h2 className="font-display text-sm text-tw-grey tracking-wide uppercase mt-0 mb-3">
                Feedback from the Class
              </h2>
              {feedback.length === 0 && <p className="text-sm text-tw-grey italic">No feedback was posted.</p>}
              {feedback.map((e, i) => (
                <div key={e.id} className={`py-3 ${i > 0 ? "border-t border-tw-border" : ""}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ background: colorFor(e.colorIndex) }}
                    />
                    <span className="font-bold text-sm text-tw-navy">{e.alias}</span>
                  </div>
                  <p className="text-sm m-0">{e.text}</p>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

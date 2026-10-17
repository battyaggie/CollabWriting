import { colorFor } from "@/lib/colors";
import { runSegments } from "@/lib/segments";
import type { ClassDoc, FeedbackDoc, GroupDoc, RunDoc, Segment } from "@/lib/types";

function CorrectedSegment({ seg, isReviewer }: { seg: Segment; isReviewer: boolean }) {
  if (!isReviewer) return <span style={{ color: colorFor(seg.colorIndex) }}>{seg.text}</span>;
  return (
    <span style={{ color: colorFor(seg.colorIndex), textDecoration: "underline", fontWeight: 600 }}>
      {seg.text}
      <sup className="text-[9px] font-normal no-underline"> {seg.alias}</sup>
    </span>
  );
}

interface Props {
  classData: ClassDoc;
  group: GroupDoc & { id: string };
  /** all paragraphs of the group's current text, in order */
  allRuns: RunDoc[];
  feedback: (FeedbackDoc & { id: string })[];
  /** ids of the students in this group (used to tell the group's own text from reviewers' corrections) */
  memberIds?: Set<string>;
}

/**
 * One printable page about one group: its original text (if saved), its current text with
 * the reviewers' corrections marked, and the feedback it received. Used by the teacher's
 * print view (all groups) and by the student's print view (own group only).
 */
export function GroupPrintSheet({ classData, group, allRuns, feedback, memberIds }: Props) {
  const runs = allRuns.filter((r) => r.text.trim().length > 0);
  const isReviewer = (seg: Segment) => !!memberIds && !memberIds.has(seg.studentId);
  return (
      <div className="tw-print-group pb-10 mb-10 border-b border-tw-border">
        <p className="text-xs text-tw-grey tracking-wide uppercase m-0">
          {classData.semester} &middot; {classData.className} &middot; {classData.taskName}
        </p>
        <h1 className="font-display text-2xl text-tw-navy mt-1 mb-6">{group.name}</h1>

        {group.original ? (
          <>
            <h2 className="font-display text-sm text-tw-grey tracking-wide uppercase mt-0 mb-1">
              Original text
            </h2>
            <p className="text-xs text-tw-grey mt-0 mb-3">
              As the group had written it when it was linked to a reviewing group (
              {new Date(group.original.takenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}).
            </p>
            {group.original.paragraphs.length === 0 && <p className="text-sm text-tw-grey italic">Nothing was written.</p>}
            <div className="text-[15px] leading-[1.7] mb-8">
              {group.original.paragraphs.map((para, i) => (
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
                group.original ? (
                  <CorrectedSegment key={j} seg={seg} isReviewer={isReviewer(seg)} />
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
}

import { colorFor } from "@/lib/colors";
import { runSegments } from "@/lib/segments";
import type { ClassDoc, FeedbackDoc, GroupDoc, RunDoc } from "@/lib/types";

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

  // Everyone who appears on this page (in the text, the original or the feedback), with their colour.
  const people = new Map<string, { alias: string; colorIndex: number }>();
  const note = (studentId: string, alias: string, colorIndex: number) => {
    if (!people.has(studentId)) people.set(studentId, { alias, colorIndex });
  };
  group.original?.paragraphs.forEach((p) => p.segments.forEach((sg) => note(sg.studentId, sg.alias, sg.colorIndex)));
  runs.forEach((r) => runSegments(r).forEach((sg) => note(sg.studentId, sg.alias, sg.colorIndex)));
  feedback.forEach((e) => note(e.studentId, e.alias, e.colorIndex));
  const isWriter = (studentId: string) => !memberIds || memberIds.has(studentId);
  const legend = Array.from(people.entries())
    .map(([studentId, v]) => ({ studentId, ...v, writer: isWriter(studentId) }))
    .sort((a, b) => Number(b.writer) - Number(a.writer) || a.alias.localeCompare(b.alias));

  return (
    <div className="tw-print-group pb-10 mb-10 border-b border-tw-border">
      <p className="text-xs text-tw-grey tracking-wide uppercase m-0">
        {classData.semester} &middot; {classData.className} &middot; {classData.taskName}
      </p>
      <h1 className="font-display text-2xl text-tw-navy mt-1 mb-4">{group.name}</h1>

      {legend.length > 0 && (
        <table className="text-sm mb-6 border-collapse">
          <thead>
            <tr className="text-xs text-tw-grey text-left">
              <th className="pr-6 pb-1 font-normal">Colour</th>
              <th className="pr-6 pb-1 font-normal">Nickname</th>
              {memberIds && <th className="pb-1 font-normal">Role</th>}
            </tr>
          </thead>
          <tbody>
            {legend.map((p) => (
              <tr key={p.studentId}>
                <td className="pr-6 py-0.5" style={{ color: colorFor(p.colorIndex) }}>
                  <span className="text-lg leading-none">&#9632;&#9632;&#9632;</span>
                </td>
                <td className="pr-6 py-0.5 font-bold" style={{ color: colorFor(p.colorIndex) }}>
                  {p.alias}
                </td>
                {memberIds && (
                  <td className="py-0.5 text-tw-grey">{p.writer ? "Writer in this group" : "Reviewer from another group"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {group.original ? (
        <>
          <h2 className="font-display text-sm text-tw-grey tracking-wide uppercase mt-0 mb-1">Original text</h2>
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
                    {seg.text}
                  </span>
                ))}
              </p>
            ))}
          </div>

          <h2 className="font-display text-sm text-tw-grey tracking-wide uppercase mt-0 mb-1">
            Text with the reviewers&rsquo; corrections
          </h2>
          <p className="text-xs text-tw-grey mt-0 mb-3">
            Corrections appear in the colour of the reviewer who made them. Words they deleted are no longer
            shown here &mdash; see the original above.
          </p>
        </>
      ) : (
        <h2 className="font-display text-sm text-tw-grey tracking-wide uppercase mt-0 mb-3">Their Writing</h2>
      )}
      {runs.length === 0 && <p className="text-sm text-tw-grey italic">Nothing was written.</p>}
      <div className="text-[15px] leading-[1.7] mb-8">
        {runs.map((r, i) => (
          <p key={i} className="m-0 mb-3">
            {runSegments(r).map((seg, j) => (
              <span key={j} style={{ color: colorFor(seg.colorIndex) }}>
                {seg.text}
              </span>
            ))}
          </p>
        ))}
      </div>

      <h2 className="font-display text-sm text-tw-grey tracking-wide uppercase mt-0 mb-3">Feedback from the Class</h2>
      {feedback.length === 0 && <p className="text-sm text-tw-grey italic">No feedback was posted.</p>}
      {feedback.map((e, i) => (
        <div key={e.id} className={`py-3 ${i > 0 ? "border-t border-tw-border" : ""}`}>
          <div className="mb-1 text-sm font-bold" style={{ color: colorFor(e.colorIndex) }}>
            &#9632; {e.alias}
          </div>
          <p className="text-sm m-0">{e.text}</p>
        </div>
      ))}
    </div>
  );
}

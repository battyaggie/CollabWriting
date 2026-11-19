"use client";

import { groupNumber, planRoundRobin } from "@/lib/matching";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import { saveOriginalText } from "@/lib/snapshot";
import { PinResetPanel } from "@/components/PinResetPanel";
import type { ClassDoc, GroupDoc, StudentDoc } from "@/lib/types";

type GroupRow = GroupDoc & { id: string };
type StudentRow = StudentDoc & { id: string };

/** Special values of the "put in group" menus. */
const NEW_GROUP = "__new__";
const NO_GROUP = "__none__";

const selectClass = "text-sm text-tw-navy border border-tw-grey-light rounded-md px-2 py-1.5 bg-white";

export default function TeacherDashboardPage() {
  const { classId } = useParams<{ classId: string }>();
  const [classData, setClassData] = useState<(ClassDoc & { id: string }) | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [linkA, setLinkA] = useState("");
  const [linkB, setLinkB] = useState("");
  const [mutual, setMutual] = useState(true);
  /** A link that would replace what a group is already doing: waits for the teacher's OK. */
  const [pendingLink, setPendingLink] = useState<string[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [hotSeatPick, setHotSeatPick] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const [placeMessage, setPlaceMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "classes", classId), (snap) => {
      setClassData(snap.exists() ? ({ id: snap.id, ...(snap.data() as ClassDoc) }) : null);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "classes", classId, "groups"), orderBy("createdAt", "asc")), (snap) => {
      setGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as GroupDoc) })));
      setGroupsLoaded(true);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "classes", classId, "students"), (snap) => {
      setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as StudentDoc) })));
      setStudentsLoaded(true);
    });
    return () => unsub();
  }, [classId]);

  const membersByGroup = useMemo(() => {
    const map = new Map<string, StudentRow[]>();
    groups.forEach((g) => map.set(g.id, []));
    students.forEach((s) => {
      if (s.groupId && map.has(s.groupId)) map.get(s.groupId)!.push(s);
    });
    return map;
  }, [groups, students]);

  /** Students who are in the class but not in any group (late joiners, people who reconnected as a new device). */
  const unassigned = useMemo(() => {
    if (!groupsLoaded || !studentsLoaded) return [];
    return students
      .filter((s) => !s.groupId || !groups.some((g) => g.id === s.groupId))
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }, [groups, students, groupsLoaded, studentsLoaded]);

  async function project(groupId: string) {
    await updateDoc(doc(db, "classes", classId), { hotSeatGroupId: groupId });
  }

  /** Hot seat is off until the teacher starts it; stopping it hides the Hot Seat tab from all students. */
  async function stopHotSeat() {
    await updateDoc(doc(db, "classes", classId), { hotSeatGroupId: null });
  }

  async function setStatus(status: ClassDoc["status"]) {
    await updateDoc(doc(db, "classes", classId), { status });
    setConfirmClose(false);
  }

  const groupName = (id: string | null | undefined) => groups.find((g) => g.id === id)?.name ?? "—";
  /** A group with no students takes no part in the feedback round. (Only known once the students have loaded.) */
  const isEmpty = (id: string) => studentsLoaded && (membersByGroup.get(id) ?? []).length === 0;
  const anyLinks = groups.some((g) => g.reviewsGroupId);
  const noReviewer = (id: string) => !groups.some((o) => o.reviewsGroupId === id);
  const warnings = anyLinks
    ? groups.filter((g) => !isEmpty(g.id) && (noReviewer(g.id) || !g.reviewsGroupId))
    : [];

  /** Id and name for a brand-new group, numbered after the highest existing one. */
  function nextGroup() {
    const nums = groups
      .map((g) => parseInt(g.id.replace(/^group-/, ""), 10))
      .filter((n) => !Number.isNaN(n));
    const n = Math.max(0, groups.length, ...nums) + 1;
    return { id: `group-${n}`, name: `Group ${n}` };
  }

  /**
   * Puts one student into a group (or takes them out of it, or into a brand-new group).
   * Only that student's own record changes, so the other groups keep working undisturbed;
   * the student's screen switches to the writing page by itself.
   */
  async function assignStudent(studentId: string, target: string) {
    if (!target) return;
    const student = students.find((s) => s.id === studentId);
    const studentRef = doc(db, "classes", classId, "students", studentId);
    try {
      if (target === NEW_GROUP) {
        const g = nextGroup();
        const batch = writeBatch(db);
        batch.set(doc(db, "classes", classId, "groups", g.id), {
          name: g.name,
          memberIds: [],
          createdAt: Date.now(),
        } as GroupDoc);
        batch.update(studentRef, { groupId: g.id });
        await batch.commit();
        setPlaceMessage(`${student?.alias ?? "Student"} is now in the new ${g.name}.`);
      } else if (target === NO_GROUP) {
        await updateDoc(studentRef, { groupId: null });
        setPlaceMessage(`${student?.alias ?? "Student"} is no longer in a group.`);
      } else {
        await updateDoc(studentRef, { groupId: target });
        setPlaceMessage(`${student?.alias ?? "Student"} is now in ${groupName(target)}.`);
      }
    } catch (err) {
      console.error(err);
      setPlaceMessage("That didn't work. Please try again.");
    }
  }

  /** Everyone who is waiting goes into whichever group is currently the smallest. */
  async function placeAllInSmallest() {
    if (groups.length === 0 || unassigned.length === 0) return;
    const counts = new Map(groups.map((g) => [g.id, (membersByGroup.get(g.id) ?? []).length]));
    const batch = writeBatch(db);
    unassigned.forEach((s) => {
      let best = groups[0].id;
      groups.forEach((g) => {
        if (counts.get(g.id)! < counts.get(best)!) best = g.id;
      });
      counts.set(best, counts.get(best)! + 1);
      batch.update(doc(db, "classes", classId, "students", s.id), { groupId: best });
    });
    try {
      await batch.commit();
      setPlaceMessage(`${unassigned.length} ${unassigned.length === 1 ? "student was" : "students were"} added to the smallest groups.`);
    } catch (err) {
      console.error(err);
      setPlaceMessage("That didn't work. Please try again.");
    }
  }

  /** Keeps a copy of the original text of every group that is about to be reviewed (only the first time). */
  async function saveOriginals(groupIds: string[]) {
    await Promise.all(
      groupIds.map((id) => saveOriginalText(classId, id, !!groups.find((g) => g.id === id)?.original))
    );
  }

  /** Group A reviews group B (and B reviews A too if "they review each other" is ticked). */
  async function linkGroups(confirmed = false) {
    if (!linkA || !linkB || linkA === linkB) {
      setMessage("Pick two different groups.");
      return;
    }
    if (isEmpty(linkA) || isEmpty(linkB)) {
      setMessage("A group without students cannot take part. Pick groups that have students.");
      return;
    }
    // Never change a group's existing link without asking.
    const replaced: string[] = [];
    const a = groups.find((g) => g.id === linkA);
    const b = groups.find((g) => g.id === linkB);
    if (a?.reviewsGroupId && a.reviewsGroupId !== linkB)
      replaced.push(`${a.name} already gives feedback to ${groupName(a.reviewsGroupId)}`);
    if (mutual && b?.reviewsGroupId && b.reviewsGroupId !== linkA)
      replaced.push(`${b.name} already gives feedback to ${groupName(b.reviewsGroupId)}`);
    if (replaced.length > 0 && !confirmed) {
      setPendingLink(replaced);
      return;
    }
    setPendingLink(null);
    await saveOriginals(mutual ? [linkA, linkB] : [linkB]);
    const batch = writeBatch(db);
    batch.update(doc(db, "classes", classId, "groups", linkA), { reviewsGroupId: linkB });
    if (mutual) batch.update(doc(db, "classes", classId, "groups", linkB), { reviewsGroupId: linkA });
    await batch.commit();
    setMessage(
      mutual
        ? `${groupName(linkA)} and ${groupName(linkB)} now review each other.`
        : `${groupName(linkA)} now reviews ${groupName(linkB)}.`
    );
    setLinkA("");
    setLinkB("");
  }

  async function unlink(groupId: string) {
    await updateDoc(doc(db, "classes", classId, "groups", groupId), { reviewsGroupId: null });
  }

  /** Removes every link, so you can start again. The texts and feedback stay. */
  async function clearAllLinks() {
    const linked = groups.filter((g) => g.reviewsGroupId);
    if (linked.length > 0) {
      const batch = writeBatch(db);
      linked.forEach((g) => batch.update(doc(db, "classes", classId, "groups", g.id), { reviewsGroupId: null }));
      await batch.commit();
    }
    setConfirmClear(false);
    setMessage("All links are removed.");
  }

  /** Time's up: every group that is not yet linked gives feedback to the next group above it that nobody reviews yet. */
  async function linkRestAtRandom() {
    const active = groups.filter((g) => !isEmpty(g.id));
    if (active.length < 2) {
      setMessage("You need at least two groups with students.");
      return;
    }
    if (active.every((g) => g.reviewsGroupId && !isEmpty(g.reviewsGroupId))) {
      setMessage("Every group already has a group to give feedback to.");
      return;
    }
    const { links, uncovered, skippedEmpty, doubled } = planRoundRobin(
      groups.map((g, i) => ({
        id: g.id,
        order: groupNumber(g.id, g.name) ?? 1000 + i,
        empty: isEmpty(g.id),
        reviewsGroupId: g.reviewsGroupId,
      }))
    );
    await saveOriginals(Array.from(new Set(links.map(([, reviewed]) => reviewed))));
    const batch = writeBatch(db);
    links.forEach(([reviewer, reviewed]) =>
      batch.update(doc(db, "classes", classId, "groups", reviewer), { reviewsGroupId: reviewed })
    );
    await batch.commit();
    const notes: string[] = [];
    if (skippedEmpty.length) notes.push(`${skippedEmpty.map(groupName).join(", ")} ${skippedEmpty.length === 1 ? "has" : "have"} no students and was left out.`);
    if (uncovered.length) notes.push(`${uncovered.map(groupName).join(", ")} still get${uncovered.length === 1 ? "s" : ""} no feedback: link by hand.`);
    if (doubled.length) notes.push(`${doubled.map(groupName).join(", ")} now get${doubled.length === 1 ? "s" : ""} feedback from two groups.`);
    setMessage(`Done: each remaining group gives feedback to the next group above it. ${notes.join(" ")}`.trim());
  }

  if (!classData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">Loading&hellip;</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col gap-6">
        <a href="/teacher/classes" className="text-sm text-tw-blue no-underline">
          &larr; My Classes
        </a>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl text-tw-navy m-0">
              {classData.semester} &middot; {classData.className} &mdash; {classData.taskName}
            </h1>
            <p className="text-sm text-tw-green flex items-center gap-1.5 mt-1 mb-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8BB31D" strokeWidth="3">
                <polyline points="4,13 9,18 20,6" />
              </svg>
              Writing and feedback are saved automatically as students work
            </p>
          </div>
          <nav className="flex gap-4 text-sm">
            <a href={`/teacher/classes/${classId}/feedback/by-group`} className="text-tw-blue no-underline">
              Feedback
            </a>
            <a href={`/teacher/classes/${classId}/print`} target="_blank" className="text-tw-blue no-underline">
              Print / Save as PDF
            </a>
          </nav>
        </div>

        {classData.status === "completed" ? (
          <div className="bg-[#EEEFF0] border border-tw-grey-light rounded-xl p-5 flex items-center justify-between gap-4">
            <span className="text-sm text-tw-navy">
              <strong>This exercise is closed.</strong> Students can read their text and feedback, but nothing can be
              changed any more.
            </span>
            <button type="button" className="tw-btn tw-btn-secondary" onClick={() => setStatus("live")}>
              Reopen
            </button>
          </div>
        ) : confirmClose ? (
          <div className="bg-[#EAF1F5] border border-tw-blue-light rounded-xl p-5 flex flex-col gap-3">
            <span className="text-sm text-tw-navy">
              Close this exercise? Students will still see their text and feedback, but no one can change anything
              any more. You can reopen it later.
            </span>
            <div className="flex gap-3">
              <button type="button" className="tw-btn tw-btn-primary" onClick={() => setStatus("completed")}>
                Close exercise
              </button>
              <button type="button" className="tw-btn tw-btn-secondary" onClick={() => setConfirmClose(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="text-sm text-tw-blue self-start" onClick={() => setConfirmClose(true)}>
            Close this exercise (no more changes)&hellip;
          </button>
        )}

        <PinResetPanel scope={classData.courseId ?? classId} aliases={students.map((s) => s.alias)} />

        {classData.status !== "completed" && unassigned.length > 0 && (
          <div
            className="bg-[#FDF3E1] border border-[#E9C46A] rounded-xl p-6 flex flex-col gap-4"
            role="status"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-base text-tw-navy m-0">
                  Not in a group yet ({unassigned.length})
                </h2>
                <p className="text-sm text-tw-grey mt-1 mb-0">
                  These students joined late or came back on a new device. They are waiting on their screen: as soon
                  as you choose a group, their writing page opens by itself. The other groups are not disturbed.
                </p>
              </div>
              <button
                className="tw-btn tw-btn-secondary whitespace-nowrap"
                disabled={groups.length === 0}
                onClick={placeAllInSmallest}
              >
                Add all to the smallest groups
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {unassigned.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-tw-navy">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ background: colorFor(s.colorIndex) }}
                    />
                    {s.alias}
                  </span>
                  <select
                    className={selectClass}
                    value=""
                    aria-label={`Put ${s.alias} in a group`}
                    onChange={(e) => assignStudent(s.id, e.target.value)}
                  >
                    <option value="">Put in a group&hellip;</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({(membersByGroup.get(g.id) ?? []).length})
                      </option>
                    ))}
                    <option value={NEW_GROUP}>+ New group</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
        {placeMessage && <p className="text-sm text-tw-green m-0">{placeMessage}</p>}

        <div className="bg-white border border-tw-grey-light rounded-xl p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-display text-base text-tw-navy m-0">Groups give each other feedback</h2>
            <p className="text-sm text-tw-grey mt-1 mb-0">
              Link two groups that have finished so they can read each other&rsquo;s text and give feedback. When
              time is up, every group that is not linked yet gives feedback to the next group above it (the last
              group to the first); groups you linked yourself are skipped, and groups without students are left out.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-tw-grey">
              Group
              <select className="text-sm text-tw-navy border border-tw-grey-light rounded-md px-2 py-1.5 bg-white" value={linkA} onChange={(e) => setLinkA(e.target.value)}>
                <option value="">Choose&hellip;</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm text-tw-grey pb-1.5">{mutual ? "\u2194" : "\u2192"}</span>
            <label className="flex flex-col gap-1 text-xs text-tw-grey">
              Group
              <select className="text-sm text-tw-navy border border-tw-grey-light rounded-md px-2 py-1.5 bg-white" value={linkB} onChange={(e) => setLinkB(e.target.value)}>
                <option value="">Choose&hellip;</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-tw-navy pb-1.5">
              <input type="checkbox" checked={mutual} onChange={(e) => setMutual(e.target.checked)} />
              They review each other
            </label>
            <button className="tw-btn tw-btn-primary" onClick={() => linkGroups()}>
              Link groups
            </button>
            <span className="flex-1" />
            <button className="tw-btn tw-btn-secondary" onClick={linkRestAtRandom}>
              Time&rsquo;s up &mdash; each group gives feedback to the next
            </button>
          </div>
          {pendingLink && (
            <div className="bg-[#FDF3E1] border border-[#E9C46A] rounded-lg p-4 flex flex-col gap-2">
              <span className="text-sm text-tw-navy">
                {pendingLink.join(". ")}. Linking now would replace that. Replace it?
              </span>
              <div className="flex gap-3">
                <button className="tw-btn tw-btn-primary" onClick={() => linkGroups(true)}>
                  Replace
                </button>
                <button className="tw-btn tw-btn-secondary" onClick={() => setPendingLink(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {message && <p className="text-sm text-tw-green m-0">{message}</p>}
          {warnings.length > 0 && (
            <p className="text-sm text-[#B3261E] m-0">
              {warnings
                .map((g) => {
                  const bits = [];
                  if (noReviewer(g.id)) bits.push("gets no feedback");
                  if (!g.reviewsGroupId) bits.push("gives feedback to nobody");
                  return `${g.name} ${bits.join(" and ")}`;
                })
                .join(" \u00b7 ")}
            </p>
          )}
          {anyLinks &&
            (confirmClear ? (
              <div className="flex items-center gap-3 text-sm text-tw-navy">
                Remove every link? Texts and feedback stay.
                <button className="tw-btn tw-btn-primary" onClick={clearAllLinks}>
                  Remove all links
                </button>
                <button className="tw-btn tw-btn-secondary" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="text-sm text-tw-blue self-start" onClick={() => setConfirmClear(true)}>
                Remove all links&hellip;
              </button>
            ))}
        </div>

        <div className="bg-white border border-tw-grey-light rounded-xl p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-display text-base text-tw-navy m-0">Hot seat (whole-class feedback)</h2>
            <p className="text-sm text-tw-grey mt-1 mb-0">
              {classData.hotSeatGroupId
                ? "The hot seat is on: all students see a Hot Seat tab with the group on the projector. Use \u201cProject to Class\u201d on a group card to switch groups."
                : "Off. Students do not see a Hot Seat tab until you start it. Most classes only need the group-to-group feedback above."}
            </p>
          </div>
          {classData.hotSeatGroupId ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-tw-navy">
                On the projector now: <strong>{groupName(classData.hotSeatGroupId)}</strong>
              </span>
              <a href={`/teacher/classes/${classId}/projector`} target="_blank" className="text-sm text-tw-blue">
                Open Projector &rarr;
              </a>
              <span className="flex-1" />
              <button className="tw-btn tw-btn-secondary" onClick={stopHotSeat}>
                Stop hot seat feedback
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-tw-grey">
                Start with group
                <select
                  className="text-sm text-tw-navy border border-tw-grey-light rounded-md px-2 py-1.5 bg-white"
                  value={hotSeatPick}
                  onChange={(e) => setHotSeatPick(e.target.value)}
                >
                  <option value="">Choose&hellip;</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="tw-btn tw-btn-primary" disabled={!hotSeatPick} onClick={() => project(hotSeatPick)}>
                Start hot seat feedback
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-5">
          {groups.map((g) => {
            const isHot = classData.hotSeatGroupId === g.id;
            const members = membersByGroup.get(g.id) ?? [];
            return (
              <div key={g.id} className="bg-white border border-tw-grey-light rounded-xl p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base text-tw-navy m-0">{g.name}</h2>
                  {isHot && (
                    <span className="bg-tw-green text-white text-xs font-bold rounded-full px-3 py-1">LIVE</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {members.length === 0 && (
                    <span className="text-xs text-tw-grey italic">No students in this group &mdash; left out of the feedback round</span>
                  )}
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-xs text-tw-navy">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ background: colorFor(m.colorIndex) }}
                        />
                        {m.alias}
                      </span>
                      <select
                        className="text-xs text-tw-grey border border-tw-grey-light rounded-md px-1.5 py-1 bg-white"
                        value=""
                        aria-label={`Move ${m.alias} to another group`}
                        onChange={(e) => assignStudent(m.id, e.target.value)}
                      >
                        <option value="">Move&hellip;</option>
                        {groups
                          .filter((o) => o.id !== g.id)
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              to {o.name}
                            </option>
                          ))}
                        <option value={NEW_GROUP}>to a new group</option>
                        <option value={NO_GROUP}>out of the group</option>
                      </select>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-tw-grey flex flex-col gap-0.5">
                  <span>
                    Gives feedback to:{" "}
                    <strong className="text-tw-navy">{g.reviewsGroupId ? groupName(g.reviewsGroupId) : "not linked yet"}</strong>
                    {g.reviewsGroupId && (
                      <button className="ml-2 text-tw-blue" onClick={() => unlink(g.id)}>
                        unlink
                      </button>
                    )}
                  </span>
                  <span>
                    Gets feedback from:{" "}
                    {groups.filter((o) => o.reviewsGroupId === g.id).length === 0 && (
                      <strong className={anyLinks && members.length > 0 ? "text-[#B3261E]" : "text-tw-navy"}>—</strong>
                    )}
                    {groups
                      .filter((o) => o.reviewsGroupId === g.id)
                      .map((o) => (
                        <span key={o.id} className="ml-1 inline-flex items-center gap-1">
                          <strong className="text-tw-navy">{o.name}</strong>
                          <button className="text-tw-blue" aria-label={`Stop ${o.name} giving feedback to ${g.name}`} onClick={() => unlink(o.id)}>
                            &times;
                          </button>
                        </span>
                      ))}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-auto pt-3 border-t border-tw-border">
                  <a
                    href={`/teacher/classes/${classId}/groups/${g.id}`}
                    className="text-sm font-bold text-tw-blue no-underline"
                  >
                    Give feedback
                  </a>
                  {classData.hotSeatGroupId && (
                    <button
                      className={`text-sm ${isHot ? "font-bold text-tw-green" : "text-tw-blue"}`}
                      onClick={() => project(g.id)}
                    >
                      {isHot ? "Projecting Now" : "Project to Class"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

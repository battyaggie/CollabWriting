"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import { saveOriginalText } from "@/lib/snapshot";
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

  async function setStatus(status: ClassDoc["status"]) {
    await updateDoc(doc(db, "classes", classId), { status });
    setConfirmClose(false);
  }

  const groupName = (id: string | null | undefined) => groups.find((g) => g.id === id)?.name ?? "—";

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
  async function linkGroups() {
    if (!linkA || !linkB || linkA === linkB) {
      setMessage("Pick two different groups.");
      return;
    }
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

  /** Time's up: every group that is not yet linked gets a random partner. */
  async function linkRestAtRandom() {
    const free = groups.filter((g) => !g.reviewsGroupId);
    if (free.length === 0) {
      setMessage("Every group already has a group to review.");
      return;
    }
    if (groups.length < 2) {
      setMessage("You need at least two groups.");
      return;
    }
    const shuffled = [...free].sort(() => Math.random() - 0.5);
    const links: [string, string][] = []; // [reviewer, reviewed]
    while (shuffled.length >= 2) {
      const a = shuffled.pop()!;
      const b = shuffled.pop()!;
      links.push([a.id, b.id], [b.id, a.id]);
    }
    if (shuffled.length === 1) {
      // an odd group out reviews a random other group
      const lone = shuffled[0];
      const others = groups.filter((g) => g.id !== lone.id);
      const pick = others[Math.floor(Math.random() * others.length)];
      links.push([lone.id, pick.id]);
    }
    await saveOriginals(Array.from(new Set(links.map(([, reviewed]) => reviewed))));
    const batch = writeBatch(db);
    links.forEach(([reviewer, reviewed]) =>
      batch.update(doc(db, "classes", classId, "groups", reviewer), { reviewsGroupId: reviewed })
    );
    await batch.commit();
    setMessage("Done: the remaining groups were matched at random.");
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
              time is up, match all the remaining groups at random.
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
            <button className="tw-btn tw-btn-primary" onClick={linkGroups}>
              Link groups
            </button>
            <span className="flex-1" />
            <button className="tw-btn tw-btn-secondary" onClick={linkRestAtRandom}>
              Time&rsquo;s up &mdash; match the rest at random
            </button>
          </div>
          {message && <p className="text-sm text-tw-green m-0">{message}</p>}
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
                  {members.length === 0 && <span className="text-xs text-tw-grey italic">No students in this group</span>}
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
                    <strong className="text-tw-navy">
                      {groups.filter((o) => o.reviewsGroupId === g.id).map((o) => o.name).join(", ") || "—"}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-auto pt-3 border-t border-tw-border">
                  <button
                    className={`text-sm ${isHot ? "font-bold text-tw-green" : "text-tw-blue"}`}
                    onClick={() => project(g.id)}
                  >
                    {isHot ? "Projecting Now" : "Project to Class"}
                  </button>
                  {isHot && (
                    <>
                      <a
                        href={`/teacher/classes/${classId}/projector`}
                        target="_blank"
                        className="text-sm text-tw-grey"
                      >
                        Open Projector →
                      </a>
                    </>
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

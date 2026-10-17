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

export default function TeacherDashboardPage() {
  const { classId } = useParams<{ classId: string }>();
  const [classData, setClassData] = useState<(ClassDoc & { id: string }) | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [linkA, setLinkA] = useState("");
  const [linkB, setLinkB] = useState("");
  const [mutual, setMutual] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

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
      setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as StudentDoc) })));
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

  async function project(groupId: string) {
    await updateDoc(doc(db, "classes", classId), { hotSeatGroupId: groupId });
  }

  const groupName = (id: string | null | undefined) => groups.find((g) => g.id === id)?.name ?? "—";

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
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => (
                    <span key={m.id} className="flex items-center gap-1.5 text-xs text-tw-navy">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ background: colorFor(m.colorIndex) }}
                      />
                      {m.alias}
                    </span>
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

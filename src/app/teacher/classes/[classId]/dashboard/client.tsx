"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import type { ClassDoc, GroupDoc, StudentDoc } from "@/lib/types";

type GroupRow = GroupDoc & { id: string };
type StudentRow = StudentDoc & { id: string };

export default function TeacherDashboardPage() {
  const { classId } = useParams<{ classId: string }>();
  const [classData, setClassData] = useState<(ClassDoc & { id: string }) | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);

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

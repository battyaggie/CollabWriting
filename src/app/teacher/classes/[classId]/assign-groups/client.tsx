"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import type { ClassDoc, GroupDoc, StudentDoc } from "@/lib/types";

type StudentRow = StudentDoc & { id: string };
type GroupRow = GroupDoc & { id: string };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function AssignGroupsPage() {
  const { classId } = useParams<{ classId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [classData, setClassData] = useState<(ClassDoc & { id: string }) | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "classes", classId), (snap) => {
      setClassData(snap.exists() ? ({ id: snap.id, ...(snap.data() as ClassDoc) }) : null);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "classes", classId, "students"), orderBy("joinedAt", "asc")), (snap) => {
      setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as StudentDoc) })));
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "classes", classId, "groups"), orderBy("createdAt", "asc")), (snap) => {
      setGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as GroupDoc) })));
    });
    return () => unsub();
  }, [classId]);

  // one-time setup: create groups if none exist yet
  useEffect(() => {
    if (!classData || students.length === 0) return;
    (async () => {
      const existing = await getDocs(collection(db, "classes", classId, "groups"));
      if (!existing.empty) {
        setInitializing(false);
        return;
      }
      const groupCount = Math.max(1, Math.ceil(students.length / classData.targetGroupSize));
      const groupIds = Array.from({ length: groupCount }, (_, i) => `group-${i + 1}`);
      const batch = writeBatch(db);
      groupIds.forEach((gid, i) => {
        batch.set(doc(db, "classes", classId, "groups", gid), {
          name: `Group ${i + 1}`,
          memberIds: [],
          createdAt: Date.now(),
        } as GroupDoc);
      });

      if (searchParams.get("mode") === "random") {
        const shuffled = shuffle(students);
        shuffled.forEach((s, i) => {
          const gid = groupIds[i % groupIds.length];
          batch.update(doc(db, "classes", classId, "students", s.id), { groupId: gid });
        });
      }

      batch.update(doc(db, "classes", classId), { status: "grouped" });
      await batch.commit();
      setInitializing(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classData, students.length]);

  const byGroup = useMemo(() => {
    const map = new Map<string, StudentRow[]>();
    groups.forEach((g) => map.set(g.id, []));
    map.set("unassigned", []);
    students.forEach((s) => {
      const key = s.groupId && map.has(s.groupId) ? s.groupId : "unassigned";
      map.get(key)!.push(s);
    });
    return map;
  }, [groups, students]);

  async function reassign(studentId: string, groupId: string) {
    await updateDoc(doc(db, "classes", classId, "students", studentId), {
      groupId: groupId === "unassigned" ? null : groupId,
    });
  }

  async function startSession() {
    if (groups.length === 0) return;
    await updateDoc(doc(db, "classes", classId), {
      status: "live",
      hotSeatGroupId: groups[0].id,
    });
    router.push(`/teacher/classes/${classId}/dashboard`);
  }

  if (!classData || initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tw-bg">
        <p className="text-tw-grey">Setting up groups&hellip;</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col gap-6">
        <a href={`/teacher/classes/${classId}/waiting-room`} className="text-sm text-tw-blue no-underline">
          &larr; Waiting Room
        </a>
        <h1 className="font-display text-2xl text-tw-navy m-0">
          Review Groups &mdash; {classData.className}
        </h1>

        <div className="grid grid-cols-2 gap-5">
          {groups.map((g) => (
            <div key={g.id} className="bg-white border border-tw-grey-light rounded-xl p-5 flex flex-col gap-3">
              <h2 className="font-display text-base text-tw-navy m-0">{g.name}</h2>
              {(byGroup.get(g.id) ?? []).length === 0 && (
                <p className="text-sm text-tw-grey italic m-0">No students yet</p>
              )}
              {(byGroup.get(g.id) ?? []).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-tw-navy">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ background: colorFor(s.colorIndex) }}
                    />
                    {s.alias}
                  </span>
                  <select
                    className="text-sm border border-tw-grey-light rounded-md px-2 py-1"
                    value={s.groupId ?? "unassigned"}
                    onChange={(e) => reassign(s.id, e.target.value)}
                  >
                    <option value="unassigned">Unassigned</option>
                    {groups.map((gg) => (
                      <option key={gg.id} value={gg.id}>
                        {gg.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>

        {(byGroup.get("unassigned") ?? []).length > 0 && (
          <div className="bg-white border border-tw-grey-light rounded-xl p-5 flex flex-col gap-3">
            <h2 className="font-display text-base text-tw-navy m-0">Unassigned</h2>
            {(byGroup.get("unassigned") ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-tw-navy">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ background: colorFor(s.colorIndex) }}
                  />
                  {s.alias}
                </span>
                <select
                  className="text-sm border border-tw-grey-light rounded-md px-2 py-1"
                  value="unassigned"
                  onChange={(e) => reassign(s.id, e.target.value)}
                >
                  <option value="unassigned">Unassigned</option>
                  {groups.map((gg) => (
                    <option key={gg.id} value={gg.id}>
                      {gg.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        <button className="tw-btn tw-btn-primary self-start" onClick={startSession}>
          Start Session
        </button>
      </div>
    </div>
  );
}

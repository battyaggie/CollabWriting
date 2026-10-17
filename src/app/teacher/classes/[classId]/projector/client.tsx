"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { GroupWriter } from "@/components/GroupWriter";
import { colorFor } from "@/lib/colors";
import type { ClassDoc, GroupDoc, StudentDoc } from "@/lib/types";

export default function ProjectorPage() {
  const { classId } = useParams<{ classId: string }>();
  const [classData, setClassData] = useState<(ClassDoc & { id: string }) | null>(null);
  const [group, setGroup] = useState<(GroupDoc & { id: string }) | null>(null);
  const [members, setMembers] = useState<(StudentDoc & { id: string })[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "classes", classId), (snap) => {
      setClassData(snap.exists() ? ({ id: snap.id, ...(snap.data() as ClassDoc) }) : null);
    });
    return () => unsub();
  }, [classId]);

  useEffect(() => {
    if (!classData?.hotSeatGroupId) return;
    const unsub = onSnapshot(doc(db, "classes", classId, "groups", classData.hotSeatGroupId), (snap) => {
      setGroup(snap.exists() ? ({ id: snap.id, ...(snap.data() as GroupDoc) }) : null);
    });
    return () => unsub();
  }, [classId, classData?.hotSeatGroupId]);

  useEffect(() => {
    if (!classData?.hotSeatGroupId) return;
    const unsub = onSnapshot(collection(db, "classes", classId, "students"), (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as StudentDoc) }));
      setMembers(all.filter((s) => s.groupId === classData.hotSeatGroupId));
    });
    return () => unsub();
  }, [classId, classData?.hotSeatGroupId]);

  if (!classData || !classData.hotSeatGroupId || !group) {
    return (
      <div className="min-h-screen bg-tw-navy text-white flex items-center justify-center">
        <p>Waiting for the teacher to project a group&hellip;</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tw-navy text-white flex flex-col">
      <div className="flex-none px-14 py-7 flex items-center justify-between border-b border-white/20">
        <div className="flex items-center gap-5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] tracking-wide opacity-70">TECHNIKUM WIEN</span>
            <span className="font-display text-[34px]">{group.name}</span>
          </div>
          <span className="bg-tw-green text-[#14231A] font-bold text-sm rounded-full px-4 py-1.5">&#9679; LIVE</span>
          <div role="group" aria-label="What to project" className="flex gap-2">
            <span className="font-display text-[13px] rounded-full px-[18px] py-2 bg-white text-tw-navy">
              Their Writing
            </span>
            <a
              href={`/teacher/classes/${classId}/projector/feedback`}
              className="font-display text-[13px] rounded-full px-[18px] py-2 border border-white/50 text-white no-underline"
            >
              Class Feedback
            </a>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {members.map((m) => (
            <span key={m.id} className="flex items-center gap-2 text-[17px]">
              <span
                className="w-4 h-4 rounded-full inline-block"
                style={{ background: colorFor(m.colorIndex) }}
              />
              {m.alias}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-16 py-12 min-h-0">
        <div className="w-full max-w-5xl h-full bg-white text-tw-navy rounded-2xl p-14 overflow-auto">
          <GroupWriter
            classId={classId}
            groupId={classData.hotSeatGroupId}
            studentId=""
            alias=""
            colorIndex={0}
            projector
          />
        </div>
      </div>
    </div>
  );
}

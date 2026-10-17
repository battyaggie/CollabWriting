"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import { downloadCsv } from "@/lib/csv";
import { runsToText } from "@/lib/exportFormat";
import type { ClassDoc, FeedbackDoc, GroupDoc, RunDoc } from "@/lib/types";

type GroupRow = GroupDoc & { id: string };
type Entry = FeedbackDoc & { id: string; groupId: string; groupName: string };

export default function FeedbackByGroupPage() {
  const { classId } = useParams<{ classId: string }>();
  const [classData, setClassData] = useState<(ClassDoc & { id: string }) | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [writingByGroup, setWritingByGroup] = useState<Record<string, RunDoc[]>>({});

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
    if (groups.length === 0) return;
    const unsubs = groups.map((g) =>
      onSnapshot(
        query(collection(db, "classes", classId, "groups", g.id, "feedback"), orderBy("createdAt", "asc")),
        (snap) => {
          setEntries((prev) => {
            const withoutThisGroup = prev.filter((e) => e.groupId !== g.id);
            const fresh = snap.docs.map((d) => ({
              id: d.id,
              groupId: g.id,
              groupName: g.name,
              ...(d.data() as FeedbackDoc),
            }));
            return [...withoutThisGroup, ...fresh];
          });
        }
      )
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.map((g) => g.id).join(",")]);

  // The group's shared writing, so grading can see what the feedback below
  // was actually written about without cross-referencing another screen.
  useEffect(() => {
    if (groups.length === 0) return;
    const unsubs = groups.map((g) =>
      onSnapshot(
        query(collection(db, "classes", classId, "groups", g.id, "runs"), orderBy("order", "asc")),
        (snap) => {
          setWritingByGroup((prev) => ({
            ...prev,
            [g.id]: snap.docs.map((d) => d.data() as RunDoc),
          }));
        }
      )
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.map((g) => g.id).join(",")]);

  function exportCsv() {
    const rows = [["Group", "Writing", "Student", "Feedback", "Posted at"]];
    entries
      .slice()
      .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.createdAt - b.createdAt)
      .forEach((e) =>
        rows.push([
          e.groupName,
          runsToText(writingByGroup[e.groupId] ?? []),
          e.alias,
          e.text,
          new Date(e.createdAt).toLocaleString(),
        ])
      );
    downloadCsv(`${classData?.className ?? "class"}-feedback-by-group.csv`, rows);
  }

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col gap-6">
        <a href={`/teacher/classes/${classId}/dashboard`} className="text-sm text-tw-blue no-underline">
          &larr; Dashboard
        </a>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl text-tw-navy m-0">Feedback &mdash; By Group</h1>
          <div className="flex gap-4 items-center">
            <a href={`/teacher/classes/${classId}/feedback/by-student`} className="text-sm text-tw-blue no-underline">
              View by Student
            </a>
            <a href={`/teacher/classes/${classId}/print`} target="_blank" className="text-sm text-tw-blue no-underline">
              Print / Save as PDF
            </a>
            <button className="tw-btn tw-btn-secondary" onClick={exportCsv}>
              Export as CSV
            </button>
          </div>
        </div>

        {groups.map((g) => {
          const groupEntries = entries.filter((e) => e.groupId === g.id);
          return (
            <div key={g.id} className="bg-white border border-tw-grey-light rounded-xl p-6">
              <h2 className="font-display text-lg text-tw-navy mt-0 mb-3">{g.name}</h2>
              {groupEntries.length === 0 && <p className="text-sm text-tw-grey italic m-0">No feedback yet.</p>}
              {groupEntries.map((e, i) => (
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

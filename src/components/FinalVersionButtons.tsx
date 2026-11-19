"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildDocx } from "@/lib/docx";
import { finalLines } from "@/lib/finalText";
import type { ClassDoc, GroupDoc, RunDoc } from "@/lib/types";

interface Props {
  classId: string;
  groupId: string;
  classData: Pick<ClassDoc, "taskName" | "className">;
  group?: Pick<GroupDoc, "name"> | null;
}

/**
 * "Final version" for the students: the group's text with all corrections accepted (struck-through words gone),
 * in one colour, with no names and no comments, ready to be handed in. As a Word file or copied to the clipboard.
 */
export function FinalVersionButtons({ classId, groupId, classData, group }: Props) {
  const [runs, setRuns] = useState<RunDoc[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "classes", classId, "groups", groupId, "runs"), orderBy("order", "asc"));
    const unsub = onSnapshot(q, (snap) => setRuns(snap.docs.map((d) => d.data() as RunDoc)));
    return () => unsub();
  }, [classId, groupId]);

  const lines = finalLines(runs);

  const download = () => {
    const bytes = buildDocx(lines);
    const blob = new Blob([bytes.buffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const name = [classData.className, classData.taskName, group?.name, "final version"]
      .filter(Boolean)
      .join(" - ")
      .replace(/[\\/:*?"<>|]+/g, "")
      .trim();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "final version"}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available: the Word file still works */
    }
  };

  return (
    <>
      <button
        type="button"
        className="tw-btn tw-btn-secondary"
        onClick={download}
        disabled={lines.length === 0}
        title="Your text with all corrections accepted: no colours, no struck-through words, no comments"
      >
        Final version (Word)
      </button>
      <button type="button" className="tw-btn tw-btn-secondary" onClick={copy} disabled={lines.length === 0}>
        {copied ? "Copied" : "Copy final text"}
      </button>
    </>
  );
}

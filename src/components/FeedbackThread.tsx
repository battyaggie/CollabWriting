"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import type { FeedbackDoc } from "@/lib/types";

interface Props {
  classId: string;
  groupId: string;
  studentId?: string;
  alias?: string;
  colorIndex?: number;
  /** hide the composer (used on the projector view) */
  readOnly?: boolean;
}

type Entry = FeedbackDoc & { id: string };

export function FeedbackThread({ classId, groupId, studentId, alias, colorIndex, readOnly }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const feedbackCol = collection(db, "classes", classId, "groups", groupId, "feedback");

  useEffect(() => {
    const q = query(feedbackCol, orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setEntries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeedbackDoc) })));
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, groupId]);

  async function post() {
    if (!draft.trim() || !studentId || !alias) return;
    await addDoc(feedbackCol, {
      studentId,
      alias,
      colorIndex: colorIndex ?? 0,
      text: draft.trim(),
      createdAt: Date.now(),
    } as FeedbackDoc);
    setDraft("");
    setSavedAt(new Date());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0">
        {entries.length === 0 && <p className="text-sm text-tw-grey italic">No feedback yet.</p>}
        {entries.map((entry, i) => (
          <div
            key={entry.id}
            className={`py-4 ${i > 0 ? "border-t border-tw-border" : ""}`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="w-3.5 h-3.5 rounded-full inline-block"
                style={{ background: colorFor(entry.colorIndex) }}
              />
              <span className="font-bold text-sm text-tw-navy">{entry.alias}</span>
            </div>
            <p className="m-0 text-[15px] leading-relaxed">{entry.text}</p>
          </div>
        ))}
      </div>
      {!readOnly && (
        <div className="flex flex-col gap-2 border-t border-tw-border pt-4">
          <textarea
            className="tw-field"
            style={{ minHeight: 90 }}
            placeholder="What's working well? What could be clearer?"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-tw-grey">Posting as {alias}</span>
            {savedAt && (
              <span className="text-xs text-tw-green flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8BB31D" strokeWidth="3">
                  <polyline points="4,13 9,18 20,6" />
                </svg>
                Saved
              </span>
            )}
          </div>
          <button type="button" className="tw-btn tw-btn-primary" onClick={post} disabled={!draft.trim()}>
            Post Feedback
          </button>
        </div>
      )}
    </div>
  );
}

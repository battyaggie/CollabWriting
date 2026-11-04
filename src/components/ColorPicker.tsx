"use client";

import { useState } from "react";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { STUDENT_COLORS, colorFor } from "@/lib/colors";
import type { StudentDoc } from "@/lib/types";

interface Props {
  classId: string;
  studentId: string;
  colorIndex: number;
  /** everyone in the class, to show which colours are already taken */
  roster: (StudentDoc & { id: string })[];
  /** locked (e.g. the exercise is closed) */
  disabled?: boolean;
}

/**
 * Lets a student choose their own writing colour (for example if they find one hard to see).
 * Every colour belongs to one student in the class, and red is reserved for the teacher, so only
 * the colours nobody else has are offered. Only the student's own roster entry is changed.
 */
export function ColorPicker({ classId, studentId, colorIndex, roster, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const takenBy = new Map<number, string>();
  roster.forEach((r) => {
    if (r.id !== studentId) takenBy.set(r.colorIndex, r.alias);
  });

  async function choose(index: number) {
    if (busy || index === colorIndex) return;
    setBusy(true);
    setMessage(null);
    try {
      // Look again right now: someone may have taken this colour a moment ago.
      const fresh = await getDocs(collection(db, "classes", classId, "students"));
      const clash = fresh.docs.some((d) => d.id !== studentId && (d.data() as StudentDoc).colorIndex === index);
      if (clash) {
        setMessage("Someone just took that colour. Please pick another one.");
      } else {
        await updateDoc(doc(db, "classes", classId, "students", studentId), { colorIndex: index });
        setOpen(false);
      }
    } catch (err) {
      console.error(err);
      setMessage("The colour could not be changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="tw-btn tw-btn-secondary self-start"
        style={{ padding: "6px 12px", fontSize: 13 }}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
      >
        {open ? "Close" : "Change my colour"}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2.5" role="group" aria-label="Choose your colour">
            {STUDENT_COLORS.map((_, i) => {
              const taker = takenBy.get(i);
              const mine = i === colorIndex;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => choose(i)}
                  disabled={!!taker || busy}
                  aria-label={mine ? "Your colour" : taker ? `Taken by ${taker}` : "Choose this colour"}
                  aria-pressed={mine}
                  title={mine ? "Your colour" : taker ? `Taken by ${taker}` : "Choose this colour"}
                  className="w-9 h-9 rounded-full border-0 flex items-center justify-center text-white font-bold"
                  style={{
                    background: colorFor(i),
                    opacity: taker ? 0.2 : 1,
                    cursor: taker ? "not-allowed" : "pointer",
                    outline: mine ? "3px solid #323F4F" : "none",
                    outlineOffset: 2,
                  }}
                >
                  {mine ? "✓" : ""}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-tw-grey m-0">
            New text you write will appear in this colour; text you have already written keeps its old colour. Faded
            colours are taken. Red is your teacher&rsquo;s colour.
          </p>
          {message && <p className="text-xs text-[#C1440E] m-0">{message}</p>}
        </div>
      )}
    </div>
  );
}

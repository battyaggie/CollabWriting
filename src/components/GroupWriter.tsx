"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import type { RunDoc } from "@/lib/types";

interface Props {
  classId: string;
  groupId: string;
  studentId: string;
  alias: string;
  colorIndex: number;
  /** true for the read-only, enlarged projector rendering */
  projector?: boolean;
}

type Run = RunDoc & { id: string };

/** Offset of the caret within `el`, counted in plain-text characters. */
function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;
  const preRange = document.createRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

/** Moves the caret to a plain-text character offset within `el`. */
function placeCaret(el: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const textNode = el.firstChild;
  const range = document.createRange();
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    const safeOffset = Math.min(offset, textNode.textContent?.length ?? 0);
    range.setStart(textNode, safeOffset);
  } else {
    range.selectNodeContents(el);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function GroupWriter({ classId, groupId, studentId, alias, colorIndex, projector }: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const spanRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const pendingFocus = useRef<{ id: string; offset: number } | null>(null);
  const hasCheckedEmpty = useRef(false);

  const runsCol = collection(db, "classes", classId, "groups", groupId, "runs");

  useEffect(() => {
    const q = query(runsCol, orderBy("order", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setRuns(snap.docs.map((d) => ({ id: d.id, ...(d.data() as RunDoc) })));
      if (!hasCheckedEmpty.current) {
        hasCheckedEmpty.current = true;
        if (snap.empty) {
          addDoc(runsCol, {
            studentId,
            alias,
            colorIndex,
            text: "",
            order: 0,
            updatedAt: Date.now(),
          } as RunDoc);
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, groupId]);

  useLayoutEffect(() => {
    // Apply any pending focus move FIRST, including writing that span's
    // correct text. If we synced the DOM before moving focus, the generic
    // pass below would see the *old* span as "currently focused" and skip
    // trimming it, and the *new* span would still count as "not focused yet"
    // only for one tick -- ordering this first keeps both spans correct in
    // a single pass, so the split/merge feels instant rather than waiting
    // on a Firestore round trip.
    const pending = pendingFocus.current;
    if (pending) {
      const el = spanRefs.current.get(pending.id);
      if (el) {
        pendingFocus.current = null;
        const run = runs.find((r) => r.id === pending.id);
        if (run && el.textContent !== run.text) {
          el.textContent = run.text;
        }
        el.focus();
        placeCaret(el, pending.offset);
      }
    }

    // Sync Firestore state into the DOM, but never touch a span the user is
    // actively typing in -- that's what was yanking the cursor back to the
    // start on every pause.
    runs.forEach((r) => {
      const el = spanRefs.current.get(r.id);
      if (!el) return;
      if (document.activeElement === el) return;
      if (el.textContent !== r.text) {
        el.textContent = r.text;
      }
    });
  }, [runs]);

  function scheduleSave(runId: string, text: string) {
    if (saveTimers.current[runId]) clearTimeout(saveTimers.current[runId]);
    saveTimers.current[runId] = setTimeout(async () => {
      if (text.trim().length === 0 && runs.length > 1) {
        await deleteDoc(doc(runsCol, runId));
      } else {
        await updateDoc(doc(runsCol, runId), { text, updatedAt: Date.now() });
      }
      setSavedAt(new Date());
    }, 500);
  }

  async function deleteRun(runId: string) {
    if (saveTimers.current[runId]) clearTimeout(saveTimers.current[runId]);
    await deleteDoc(doc(runsCol, runId));
  }

  /** Enter: split the paragraph at the caret into two, like a normal document. */
  function splitRun(runId: string) {
    const idx = runs.findIndex((r) => r.id === runId);
    if (idx === -1) return;
    const el = spanRefs.current.get(runId);
    if (!el) return;
    if (saveTimers.current[runId]) clearTimeout(saveTimers.current[runId]);

    const fullText = el.textContent ?? "";
    const offset = getCaretOffset(el);
    const before = fullText.slice(0, offset);
    const after = fullText.slice(offset);

    const current = runs[idx];
    const nextOrder = idx + 1 < runs.length ? runs[idx + 1].order : current.order + 1;
    const newOrder = (current.order + nextOrder) / 2;
    const newId = doc(runsCol).id;

    const newRun: Run = {
      id: newId,
      studentId,
      alias,
      colorIndex,
      text: after,
      order: newOrder,
      updatedAt: Date.now(),
    };

    // Update local state immediately -- the split shouldn't wait on a
    // network round trip to feel like it happened.
    setRuns((prevRuns) => {
      const next = prevRuns.map((r) => (r.id === runId ? { ...r, text: before } : r));
      next.splice(idx + 1, 0, newRun);
      return next;
    });
    pendingFocus.current = { id: newId, offset: 0 };
    setSavedAt(new Date());

    updateDoc(doc(runsCol, runId), { text: before, updatedAt: Date.now() }).catch(console.error);
    setDoc(doc(runsCol, newId), {
      studentId,
      alias,
      colorIndex,
      text: after,
      order: newOrder,
      updatedAt: Date.now(),
    } as RunDoc).catch(console.error);
  }

  /** Backspace at the very start of a paragraph: merge it into the previous one. */
  function mergeUp(runId: string) {
    const idx = runs.findIndex((r) => r.id === runId);
    if (idx <= 0) return;
    const prev = runs[idx - 1];
    const current = runs[idx];
    const el = spanRefs.current.get(runId);
    const currentText = el?.textContent ?? current.text;

    if (saveTimers.current[runId]) clearTimeout(saveTimers.current[runId]);
    if (saveTimers.current[prev.id]) clearTimeout(saveTimers.current[prev.id]);

    const mergedText = (prev.text ?? "") + currentText;
    const mergeOffset = (prev.text ?? "").length;

    setRuns((prevRuns) =>
      prevRuns
        .filter((r) => r.id !== runId)
        .map((r) => (r.id === prev.id ? { ...r, text: mergedText } : r))
    );
    pendingFocus.current = { id: prev.id, offset: mergeOffset };
    setSavedAt(new Date());

    updateDoc(doc(runsCol, prev.id), { text: mergedText, updatedAt: Date.now() }).catch(console.error);
    deleteDoc(doc(runsCol, runId)).catch(console.error);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLSpanElement>, runId: string, isFirst: boolean) {
    if (e.key === "Enter") {
      e.preventDefault();
      splitRun(runId);
    } else if (e.key === "Backspace") {
      const el = e.currentTarget;
      if (!isFirst && getCaretOffset(el) === 0) {
        e.preventDefault();
        mergeUp(runId);
      }
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLSpanElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  if (projector) {
    return (
      <div className="text-[23px] leading-[1.75]">
        {runs.length === 0 && <p className="text-tw-grey-light italic">Nothing written yet&hellip;</p>}
        {runs.map((r) => (
          <p key={r.id} className="m-0 mb-[22px]" style={{ color: colorFor(r.colorIndex) }}>
            {r.text || " "}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-tw-grey">
        <span>
          Click anywhere and type &mdash; it&rsquo;s shared, like a Word document. Press Enter for a new
          paragraph.
        </span>
        <span className="flex items-center gap-2">
          {savedAt && (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8BB31D" strokeWidth="3">
                <polyline points="4,13 9,18 20,6" />
              </svg>
              Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </>
          )}
        </span>
      </div>
      <div className="bg-white border border-tw-grey-light rounded-xl p-10 min-h-[400px] text-[17px] leading-[1.7]">
        {runs.map((r, i) => (
          <p key={r.id} className="m-0 mb-4 group flex items-start gap-2">
            <span
              ref={(el) => {
                if (el) spanRefs.current.set(r.id, el);
                else spanRefs.current.delete(r.id);
              }}
              className="tw-run flex-1"
              contentEditable
              suppressContentEditableWarning
              style={{ color: colorFor(r.colorIndex) }}
              onInput={(e) => scheduleSave(r.id, e.currentTarget.textContent ?? "")}
              onKeyDown={(e) => onKeyDown(e, r.id, i === 0)}
              onPaste={onPaste}
            />
            <button
              type="button"
              onClick={() => deleteRun(r.id)}
              title="Delete this paragraph"
              className="opacity-0 group-hover:opacity-100 text-tw-grey text-xs"
            >
              ✕
            </button>
          </p>
        ))}
      </div>
    </div>
  );
}

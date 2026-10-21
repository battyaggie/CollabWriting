"use client";

import { useEffect, useRef, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { colorFor } from "@/lib/colors";
import type { Anchor } from "@/lib/doc";
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

export type FeedbackEntry = FeedbackDoc & { id: string };

/** All feedback on a group's text, live. Pass null to listen to nothing. */
export function useFeedbackEntries(classId: string, groupId: string | null): FeedbackEntry[] {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  useEffect(() => {
    setEntries([]);
    if (!groupId) return;
    const q = query(collection(db, "classes", classId, "groups", groupId, "feedback"), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setEntries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as FeedbackDoc) })));
    });
    return () => unsub();
  }, [classId, groupId]);
  return entries;
}

/** The comments that point at a highlighted part of the text, in the form the text box wants them. */
export function anchorsOf(entries: FeedbackEntry[]): (Anchor & { id: string })[] {
  return entries
    .filter((e) => !!e.quote)
    .map((e) => ({ id: e.id, start: e.start ?? 0, end: e.end ?? 0, quote: e.quote as string }));
}

/** The highlighted words a comment is about. */
export function QuotedText({ quote }: { quote: string }) {
  return (
    <p className="m-0 mb-1.5 pl-3 border-l-4 border-[#FFE066] text-sm italic text-tw-grey line-clamp-4">
      &ldquo;{quote}&rdquo;
    </p>
  );
}

interface ComposerProps {
  classId: string;
  groupId: string;
  studentId: string;
  alias: string;
  colorIndex: number;
  selection: Anchor;
  onDone: () => void;
}

/** The small box that opens next to highlighted text: write a comment about exactly that part. */
export function CommentComposer({ classId, groupId, studentId, alias, colorIndex, selection, onDone }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function post() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await addDoc(collection(db, "classes", classId, "groups", groupId, "feedback"), {
        studentId,
        alias,
        colorIndex,
        text: draft.trim(),
        createdAt: Date.now(),
        quote: selection.quote,
        start: selection.start,
        end: selection.end,
      } as FeedbackDoc);
      onDone();
    } catch (err) {
      console.error(err);
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-tw-blue-light rounded-xl shadow-xl p-4 flex flex-col gap-2 text-base leading-normal">
      <QuotedText quote={selection.quote} />
      <div className="tw-field">
        <textarea
          ref={ref}
          style={{ minHeight: 70 }}
          placeholder="Your comment on this part…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      {failed && <p className="m-0 text-sm text-[#C1440E]">The comment could not be saved. Please try again.</p>}
      <div className="flex items-center gap-2">
        <button type="button" className="tw-btn tw-btn-primary" onClick={post} disabled={!draft.trim() || busy}>
          Post comment
        </button>
        <button type="button" className="tw-btn tw-btn-secondary" onClick={onDone}>
          Cancel
        </button>
        <span className="text-xs text-tw-grey ml-auto">Posting as {alias}</span>
      </div>
    </div>
  );
}

export function FeedbackThread({ classId, groupId, studentId, alias, colorIndex, readOnly }: Props) {
  const entries = useFeedbackEntries(classId, groupId);
  const [draft, setDraft] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function post() {
    if (!draft.trim() || !studentId || !alias) return;
    await addDoc(collection(db, "classes", classId, "groups", groupId, "feedback"), {
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
            {entry.quote && <QuotedText quote={entry.quote} />}
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

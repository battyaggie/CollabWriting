"use client";

import { useState } from "react";

interface Props {
  title: string;
  description: string;
  /** If given, the teacher must type this (e.g. the class code) before the button works. */
  confirmWord?: string;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}

/** Asks before something is deleted for good. */
export function DeletePanel({ title, description, confirmWord, onDelete, onCancel }: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = !confirmWord || typed.trim().toUpperCase() === confirmWord.toUpperCase();

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      console.error(err);
      setError("Not everything could be deleted (some parts may already be gone). Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="border border-[#C1440E] bg-[#FDF3EE] rounded-xl p-5 flex flex-col gap-3">
      <p className="font-display text-base text-tw-navy m-0">{title}</p>
      <p className="text-sm text-tw-navy m-0">{description}</p>
      {confirmWord && (
        <div className="tw-field">
          <label htmlFor="confirm-delete">
            To confirm, type <span className="font-mono">{confirmWord}</span>
          </label>
          <input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
      {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="tw-btn"
          style={{ background: "#C1440E", color: "#fff", opacity: ok && !busy ? 1 : 0.5 }}
          disabled={!ok || busy}
          onClick={go}
        >
          {busy ? "Deleting…" : "Delete permanently"}
        </button>
        <button type="button" className="tw-btn tw-btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

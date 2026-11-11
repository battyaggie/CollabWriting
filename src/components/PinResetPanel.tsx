"use client";

import { useState } from "react";
import { IdentityError, resetStudentPin } from "@/lib/identity";

/**
 * For the teacher: a student forgot their PIN. Resetting keeps the student's group and text; they have half an
 * hour to choose a new PIN on the join page (class code, same nickname, new PIN). Collapsed until needed.
 */
export function PinResetPanel({ scope, aliases }: { scope: string; aliases: string[] }) {
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="text-sm text-tw-blue self-start" onClick={() => setOpen(true)}>
        A student forgot their PIN&hellip;
      </button>
    );
  }

  async function reset() {
    if (!alias) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await resetStudentPin(scope, alias);
      setDone(alias);
    } catch (err) {
      setError(err instanceof IdentityError ? err.message : "Could not reset the PIN. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="bg-white border border-tw-grey-light rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base text-tw-navy m-0">Reset a forgotten PIN</h2>
          <p className="text-sm text-tw-grey mt-1 mb-0">
            The student keeps their group and text. Tell them to join again straight away with the class code, the same
            nickname and a new PIN: they have 30 minutes. (In that time anyone who types that nickname can choose the
            PIN, so do it when the student is ready.)
          </p>
        </div>
        <button type="button" className="text-sm text-tw-grey underline whitespace-nowrap" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="flex items-center gap-3">
        <select
          className="text-sm text-tw-navy border border-tw-grey-light rounded-md px-2 py-1.5 bg-white"
          value={alias}
          aria-label="Student whose PIN to reset"
          onChange={(e) => {
            setAlias(e.target.value);
            setDone(null);
            setError(null);
          }}
        >
          <option value="">Choose a student&hellip;</option>
          {[...aliases].sort((a, b) => a.localeCompare(b)).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button type="button" className="tw-btn tw-btn-secondary" disabled={!alias || busy} onClick={reset}>
          {busy ? "Resetting…" : "Reset PIN"}
        </button>
      </div>
      {done && (
        <p className="text-sm text-tw-green m-0">
          Done. {done} can now choose a new PIN on the join page within 30 minutes.
        </p>
      )}
      {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
    </div>
  );
}

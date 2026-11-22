"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TeacherAccessError,
  addAllowed,
  approveExisting,
  listAllowed,
  removeAllowed,
  resetLink,
  type AddResult,
  type AllowedTeacher,
} from "@/lib/teacherAccess";
import { adminCopyEmail } from "@/lib/config";

const card = "bg-white border border-tw-grey-light rounded-xl p-5 flex flex-col gap-3";
const STATUS: Record<AddResult["status"], string> = {
  added: "approved",
  already: "was already approved",
  invalid: "not a valid email address",
  failed: "could not be set up, try again",
};

function day(ms: number) {
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/** Opens a ready-made email (with a copy to the administrator) in the mail program; the administrator picks the sender there. */
function openEmailWithLink(email: string, link: string) {
  const origin = window.location.origin;
  const body =
    `Hello,\n\nYou now have access to the Collaborative Writing App as a teacher. Please choose your password with this link ` +
    `(it works once and only for a limited time, so please use it soon):\n\n${link}\n\n` +
    `Afterwards you can sign in at ${origin}/teacher/login with this email address.\n\n` +
    `If the link no longer works, open ${origin}/teacher/login, press "First time here, or forgot your password? Send me a password link" ` +
    `and follow the email you receive. If nothing arrives, let me know and I will send you a new link.\n`;
  const to = encodeURIComponent(email).replace(/%40/g, "@");
  const cc = adminCopyEmail ? `&cc=${encodeURIComponent(adminCopyEmail).replace(/%40/g, "@")}` : "";
  const a = document.createElement("a");
  a.href = `mailto:${to}?subject=${encodeURIComponent("Your access to the Collaborative Writing App")}${cc}&body=${encodeURIComponent(body)}`;
  a.click();
}

/** The administrator's page for the Vercel version: who may use the app as a teacher. */
export function ApprovedTeachers() {
  const [rows, setRows] = useState<AllowedTeacher[] | null>(null);
  const [admins, setAdmins] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [results, setResults] = useState<AddResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listAllowed();
      setRows(r.rows);
      setAdmins(r.admins);
    } catch (err) {
      setError(err instanceof TeacherAccessError ? err.message : "Could not load the list.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof TeacherAccessError ? err.message : "Something went wrong.");
    }
    setBusy(false);
  }

  return (
    <>
      {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
      {note && <p className="text-sm text-tw-green m-0">{note}</p>}

      <div className={card}>
        <h2 className="font-display text-lg text-tw-navy m-0">Approve teachers</h2>
        <p className="text-sm text-tw-grey m-0">
          One email address per line (or separated by commas). Only approved addresses can create classes. Tell each
          teacher to open the teacher sign-in page and press <b>Send me a password link</b>: the email they receive lets
          them choose a password. If that email does not arrive (some universities block it), press{" "}
          <b>Send email with link</b> next to their address below: it opens a ready-made email in your mail program
          {adminCopyEmail ? ` with a copy to ${adminCopyEmail}` : ""}, where you choose which of your addresses to send it from.
        </p>
        <textarea
          className="border border-tw-grey-light rounded-md p-2 text-sm text-tw-navy min-h-[90px]"
          placeholder="anna.example@technikum-wien.at"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <div>
          <button
            type="button"
            className="tw-btn tw-btn-primary"
            disabled={busy || !input.trim()}
            onClick={() =>
              run(async () => {
                const emails = input.split(/[\s,;]+/).filter(Boolean);
                const r = await addAllowed(emails);
                setResults(r.results);
                setInput("");
              })
            }
          >
            {busy ? "Please wait…" : "Approve"}
          </button>
        </div>
        {results && (
          <ul className="text-sm text-tw-navy m-0 pl-5">
            {results.map((r) => (
              <li key={r.email}>
                {r.email}: {STATUS[r.status]}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <h2 className="font-display text-lg text-tw-navy m-0">Approved teachers{rows ? ` (${rows.length})` : ""}</h2>
        {rows === null && !error && <p className="text-sm text-tw-grey m-0">Loading…</p>}
        {rows?.length === 0 && <p className="text-sm text-tw-grey m-0">Nobody is approved yet.</p>}
        {rows?.map((r) => (
          <div key={r.email} className="flex items-center justify-between gap-3 border-t border-tw-grey-light pt-2">
            <div>
              <div className="text-sm text-tw-navy">
                {r.email}
                {admins.includes(r.email) && <span className="text-xs text-tw-grey"> · administrator</span>}
              </div>
              <div className="text-xs text-tw-grey">
                {r.signedIn ? `last signed in ${day(r.signedIn)}` : "has not signed in yet"}
              </div>
            </div>
            <div className="flex gap-3 flex-none">
              <button
                type="button"
                className="text-sm text-tw-blue underline"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const { link } = await resetLink(r.email);
                    openEmailWithLink(r.email, link);
                    setNote(`An email to ${r.email} is open in your mail program. The link only works for a short time, so send it now.`);
                  })
                }
              >
                Send email with link
              </button>
              {!admins.includes(r.email) && (
                <button
                  type="button"
                  className="text-sm text-tw-grey underline"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${r.email}? They can no longer sign in or create classes.`)) {
                      run(async () => {
                        await removeAllowed(r.email);
                      });
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={card}>
        <h2 className="font-display text-lg text-tw-navy m-0">Teachers who already have an account</h2>
        <p className="text-sm text-tw-grey m-0">
          One-off, before switching on the approval rule: approves every address that already has a teacher account, so
          nobody is locked out. Safe to press more than once.
        </p>
        <div>
          <button
            type="button"
            className="tw-btn tw-btn-secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await approveExisting();
                setNote(r.added === 0 ? "Everyone with an account was already approved." : `${r.added} existing account(s) approved.`);
              })
            }
          >
            Approve all existing accounts
          </button>
        </div>
      </div>
    </>
  );
}

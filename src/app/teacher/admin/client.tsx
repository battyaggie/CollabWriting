"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { isLocalBackend } from "@/lib/backend";
import {
  adminApprove,
  adminDisable,
  adminImport,
  adminOverview,
  adminReject,
  adminReset,
  mailtoFor,
  setupUrl,
  type AccessRequest,
  type AccountInfo,
  type ImportRow,
  type SetupLink,
} from "@/backend/local/accounts";
import { readPeopleFile, type Person } from "@/backend/local/importFile";

const card = "bg-white border border-tw-grey-light rounded-xl p-5 flex flex-col gap-3";
const IMPORT_STATUS: Record<ImportRow["status"], string> = {
  created: "Account created",
  "link-renewed": "Waiting for password — new link",
  exists: "Already has an account",
  duplicate: "Listed twice — skipped",
  invalid: "Not a valid email address — skipped",
};

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function csvCell(v: string) {
  return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function LinkRow({ link }: { link: SetupLink }) {
  const [copied, setCopied] = useState(false);
  const url = setupUrl(link.token);
  return (
    <div className="flex flex-col gap-1.5 border-t border-tw-grey-light pt-3 first:border-0 first:pt-0">
      <p className="text-sm text-tw-navy m-0">
        <b>{link.name || link.email}</b> {link.name && <span className="text-tw-grey">&lt;{link.email}&gt;</span>}
      </p>
      <div className="flex items-center gap-2">
        <input readOnly value={url} className="flex-1 min-w-0 text-xs font-mono border border-tw-grey-light rounded-lg px-2 py-1.5" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="tw-btn tw-btn-secondary"
          onClick={() => {
            navigator.clipboard?.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a className="tw-btn tw-btn-primary no-underline" href={mailtoFor(link)}>
          Write email
        </a>
      </div>
      <p className="text-xs text-tw-grey m-0">Works once, valid until {formatDate(link.expiresAt)}.</p>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [users, setUsers] = useState<AccountInfo[]>([]);
  const [links, setLinks] = useState<SetupLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fileName, setFileName] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [results, setResults] = useState<ImportRow[] | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/teacher/login");
        return;
      }
      setIsAdmin(!!(user as unknown as { isAdmin?: boolean }).isAdmin);
      setChecked(true);
    });
    return () => unsub();
  }, [router]);

  const load = useCallback(async () => {
    try {
      const o = await adminOverview();
      setRequests(o.requests);
      setUsers(o.users);
    } catch (err: any) {
      setError(err?.message ?? "Could not load the accounts.");
    }
  }, []);

  useEffect(() => {
    if (checked && isAdmin && isLocalBackend) load();
  }, [checked, isAdmin, load]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    setResults(null);
    setPeople(null);
    setError(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const list = await readPeopleFile(file);
      if (list.length === 0) setError("No email addresses found in this file. It needs one column with email addresses.");
      else setPeople(list);
    } catch (err: any) {
      setError(err?.message ?? "This file could not be read.");
    }
  }

  function downloadLinks() {
    const rows = (results ?? []).filter((r) => r.token);
    const lines = ["name,email,link,valid until"].concat(
      rows.map((r) => [r.name, r.email, setupUrl(r.token!), formatDate(r.expiresAt!)].map(csvCell).join(","))
    );
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "teacher-links.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const pending = requests.filter((r) => r.status === "pending");
  const importLinks: SetupLink[] = (results ?? [])
    .filter((r) => r.token)
    .map((r) => ({ email: r.email, name: r.name, token: r.token!, expiresAt: r.expiresAt! }));

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-display text-xs tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
            <h1 className="font-display text-2xl text-tw-navy m-0">Teacher accounts</h1>
          </div>
          <Link href="/teacher/classes" className="text-sm text-tw-grey underline">
            Back to my classes
          </Link>
        </div>

        {!isLocalBackend && <p className="text-sm text-tw-grey">This page is only used on the university server.</p>}
        {isLocalBackend && checked && !isAdmin && <p className="text-sm text-tw-grey">This page is for administrators only.</p>}

        {isLocalBackend && isAdmin && (
          <>
            {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}

            <section className={card}>
              <h2 className="font-display text-lg text-tw-navy m-0">
                Requests for access {pending.length > 0 && <span className="text-tw-blue">({pending.length})</span>}
              </h2>
              {pending.length === 0 && <p className="text-sm text-tw-grey m-0">No open requests.</p>}
              {pending.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 border-t border-tw-grey-light pt-3 first:border-0 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm text-tw-navy m-0"><b>{r.name || "(no name)"}</b></p>
                    <p className="text-sm text-tw-grey m-0">{r.email} &middot; asked on {formatDate(r.createdAt)}</p>
                  </div>
                  <div className="flex gap-2 flex-none">
                    <button
                      className="tw-btn tw-btn-primary"
                      disabled={busy}
                      onClick={() => run(async () => {
                        const link = await adminApprove(r.id);
                        setLinks((l) => [link, ...l]);
                      })}
                    >
                      Approve
                    </button>
                    <button className="tw-btn tw-btn-secondary" disabled={busy} onClick={() => run(() => adminReject(r.id))}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </section>

            {links.length > 0 && (
              <section className={card}>
                <h2 className="font-display text-lg text-tw-navy m-0">Links to send</h2>
                <p className="text-sm text-tw-grey m-0">
                  Send each person their link. &ldquo;Write email&rdquo; opens a ready-made message in your mail program.
                  These links are shown only now; you can always create a new one under &ldquo;New password link&rdquo; below.
                </p>
                {links.map((l) => (
                  <LinkRow key={l.token} link={l} />
                ))}
              </section>
            )}

            <section className={card}>
              <h2 className="font-display text-lg text-tw-navy m-0">Create accounts from a list</h2>
              <p className="text-sm text-tw-grey m-0">
                Upload an Excel (.xlsx) or CSV file with one lecturer per row: names and email addresses. Accounts are created
                without passwords, and each person gets a one-time link to choose theirs.
              </p>
              <input type="file" accept=".xlsx,.csv,.txt,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
              {people && !results && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-tw-navy m-0">
                    <b>{fileName}</b>: {people.filter((p) => p.email).length} people found.
                  </p>
                  <ul className="text-sm text-tw-grey m-0 pl-5 max-h-40 overflow-auto">
                    {people.slice(0, 50).map((p, i) => (
                      <li key={i}>
                        {p.name || "(no name)"} &mdash; {p.email || <i>no email</i>}
                      </li>
                    ))}
                    {people.length > 50 && <li>&hellip; and {people.length - 50} more</li>}
                  </ul>
                  <button
                    className="tw-btn tw-btn-primary self-start"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        setResults(await adminImport(people));
                        setPeople(null);
                      })
                    }
                  >
                    Create accounts
                  </button>
                </div>
              )}
              {results && (
                <div className="flex flex-col gap-3">
                  <ul className="text-sm text-tw-navy m-0 pl-5">
                    {results.map((r, i) => (
                      <li key={i}>
                        {r.name || r.email} <span className="text-tw-grey">&mdash; {IMPORT_STATUS[r.status]}</span>
                      </li>
                    ))}
                  </ul>
                  {importLinks.length > 0 && (
                    <>
                      <button className="tw-btn tw-btn-secondary self-start" onClick={downloadLinks}>
                        Download all links as a spreadsheet (for a mail merge)
                      </button>
                      {importLinks.map((l) => (
                        <LinkRow key={l.token} link={l} />
                      ))}
                    </>
                  )}
                </div>
              )}
            </section>

            <section className={card}>
              <h2 className="font-display text-lg text-tw-navy m-0">Accounts ({users.length})</h2>
              {users.map((u) => (
                <div key={u.uid} className="flex items-center justify-between gap-3 border-t border-tw-grey-light pt-3 first:border-0 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm text-tw-navy m-0">
                      <b>{u.name || u.email}</b> {u.isAdmin && <span className="text-xs text-tw-blue">administrator</span>}
                    </p>
                    <p className="text-sm text-tw-grey m-0">
                      {u.email} &middot;{" "}
                      {u.disabled ? "switched off" : u.hasPassword ? "active" : "waiting for the person to choose a password"}
                    </p>
                  </div>
                  <div className="flex gap-3 flex-none text-sm">
                    <button
                      className="text-tw-blue underline"
                      disabled={busy}
                      onClick={() => run(async () => {
                        const link = await adminReset(u.uid);
                        setLinks((l) => [link, ...l]);
                      })}
                    >
                      New password link
                    </button>
                    {!u.isAdmin && (
                      <button className="text-tw-grey underline" disabled={busy} onClick={() => run(() => adminDisable(u.uid, !u.disabled))}>
                        {u.disabled ? "Switch on" : "Switch off"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

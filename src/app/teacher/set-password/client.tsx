"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isLocalBackend } from "@/lib/backend";
import { completePasswordSetup } from "@/backend/local/accounts";

const MIN_LENGTH = 10;

export default function SetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Please use at least ${MIN_LENGTH} characters. A few words in a row make a good password.`);
      return;
    }
    if (password !== repeat) {
      setError("The two passwords are not the same.");
      return;
    }
    setLoading(true);
    try {
      await completePasswordSetup(token ?? "", password);
      router.push("/teacher/classes");
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-tw-bg">
      <div className="w-[420px] bg-white border border-tw-grey-light rounded-2xl p-10 flex flex-col gap-5">
        <div>
          <span className="font-display text-sm tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
          <h1 className="font-display text-2xl text-tw-navy mt-1 mb-0">Choose your password</h1>
        </div>
        {!isLocalBackend ? (
          <p className="text-sm text-tw-grey m-0">This page is only used on the university server.</p>
        ) : token === "" ? (
          <p className="text-sm text-[#C1440E] m-0">
            This link is incomplete. Please open the whole link from your email, or ask the administrator for a new one.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="tw-field">
              <label htmlFor="pw">New password</label>
              <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
            </div>
            <div className="tw-field">
              <label htmlFor="pw2">Repeat password</label>
              <input id="pw2" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required autoComplete="new-password" />
            </div>
            {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
            <button type="submit" className="tw-btn tw-btn-primary" disabled={loading || token === null}>
              {loading ? "Please wait…" : "Save password and sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

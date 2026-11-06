"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { isLocalBackend } from "@/lib/backend";
import { requestAccess } from "@/backend/local/accounts";

export default function TeacherLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "request">("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "request") {
        await requestAccess(email, name);
        setRequested(true);
        return;
      }
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      router.push("/teacher/classes");
    } catch (err: any) {
      setError(err?.message?.replace("Firebase: ", "") ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-tw-bg">
      <div className="w-[420px] bg-white border border-tw-grey-light rounded-2xl p-10 flex flex-col gap-5">
        <div>
          <span className="font-display text-sm tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
          <h1 className="font-display text-2xl text-tw-navy mt-1 mb-0">
            {mode === "request" ? "Request teacher access" : "Teacher Sign In"}
          </h1>
        </div>

        {mode === "request" && requested ? (
          <div className="flex flex-col gap-3">
            <p className="text-[15px] text-tw-navy m-0">
              Thank you &mdash; your request has been sent. The administrator will send you a link by email to
              choose your password once it is approved.
            </p>
            <button
              type="button"
              className="text-sm text-tw-blue underline self-start"
              onClick={() => {
                setRequested(false);
                setMode("signin");
              }}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === "request" && (
              <p className="text-sm text-tw-grey m-0">
                Teacher accounts are set up by an administrator. Enter your work email address and we will let
                them know.
              </p>
            )}
            {mode === "request" && (
              <div className="tw-field">
                <label htmlFor="name">Your name</label>
                <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            )}
            <div className="tw-field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {mode !== "request" && (
              <div className="tw-field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            )}
            {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
            <button type="submit" className="tw-btn tw-btn-primary" disabled={loading}>
              {loading
                ? "Please wait…"
                : mode === "request"
                  ? "Send request"
                  : mode === "signup"
                    ? "Create Account"
                    : "Sign In"}
            </button>
          </form>
        )}

        {isLocalBackend ? (
          mode === "signin" ? (
            <>
              <button
                type="button"
                className="text-sm text-tw-blue underline"
                onClick={() => {
                  setError(null);
                  setMode("request");
                }}
              >
                No account yet? Request access
              </button>
              <p className="text-xs text-tw-grey m-0">Forgot your password? Ask the administrator for a new link.</p>
            </>
          ) : (
            !requested && (
              <button type="button" className="text-sm text-tw-blue underline" onClick={() => setMode("signin")}>
                Already have an account? Sign in
              </button>
            )
          )
        ) : (
          <button
            type="button"
            className="text-sm text-tw-blue underline"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          >
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create your teacher account"}
          </button>
        )}
      </div>
    </div>
  );
}

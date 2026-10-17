"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function TeacherLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
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
          <h1 className="font-display text-2xl text-tw-navy mt-1 mb-0">Teacher Sign In</h1>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="tw-field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
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
          {error && <p className="text-sm text-[#C1440E] m-0">{error}</p>}
          <button type="submit" className="tw-btn tw-btn-primary" disabled={loading}>
            {loading ? "Please wait…" : mode === "signup" ? "Create Account" : "Sign In"}
          </button>
        </form>
        <button
          type="button"
          className="text-sm text-tw-blue underline"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        >
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create your teacher account"}
        </button>
      </div>
    </div>
  );
}

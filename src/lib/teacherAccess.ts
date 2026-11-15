"use client";

import { auth } from "@/lib/firebase";

export type AllowedTeacher = { email: string; addedAt: number; signedIn: number | null };
export type AddResult = { email: string; status: "added" | "already" | "invalid" | "failed" };

export class TeacherAccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new TeacherAccessError(401, "Please sign in again.");
  let res: Response;
  try {
    res = await fetch("/api/teacher-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, idToken: await user.getIdToken(), ...extra }),
    });
  } catch {
    throw new TeacherAccessError(0, "Could not reach the server. Please try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string } & T;
  if (!res.ok) throw new TeacherAccessError(res.status, body.message ?? "Something went wrong.");
  return body;
}

export const listAllowed = () => call<{ rows: AllowedTeacher[]; admins: string[] }>("list");
export const addAllowed = (emails: string[]) => call<{ results: AddResult[] }>("add", { emails });
export const removeAllowed = (email: string) => call<{ removed: string }>("remove", { email });
export const approveExisting = () => call<{ added: number }>("approve-existing");

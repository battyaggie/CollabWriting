"use client";

import { signInWithCustomToken } from "firebase/auth";
import { auth, ensureAnonymousUser } from "@/lib/firebase";
import { isLocalBackend } from "@/lib/backend";

/**
 * Getting the same identity back on another device with nickname + PIN.
 *
 * A student is a random identity that belongs to one browser. The first time they join a class they choose a
 * PIN; later, on any device, the same nickname + PIN returns that identity, so they land in the same group with
 * the same text. The check is done by a server (never in the browser): the container's own server, or on Vercel
 * the route /api/identity. The rules (length, lock after wrong guesses) are in server/pin.mjs.
 */

export const PIN_MIN = 4;
export const PIN_MAX = 32;

export class IdentityError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
  }
}

const NOT_REACHED = "Could not check your PIN just now. Please try again in a moment.";

/** Problem with a PIN as typed (same rule as the server), or null. */
export function pinProblem(pin: string): string | null {
  const p = pin.trim();
  if (p.length < PIN_MIN) return `Your PIN needs at least ${PIN_MIN} characters.`;
  if (p.length > PIN_MAX) return `Your PIN can have at most ${PIN_MAX} characters.`;
  return null;
}

/**
 * Presents nickname + PIN for a class (`scope`: the class code, or the exercise code for a single session).
 * Resolves with the identity this browser has afterwards (the same one as before the first time, the original
 * one when coming back on another device). Throws IdentityError for a wrong PIN, a locked nickname or a bad PIN.
 */
export async function claimIdentity(scope: string, nickname: string, pin: string): Promise<{ uid: string }> {
  const user = await ensureAnonymousUser();

  if (isLocalBackend) {
    const { signInWithPin } = await import("@/backend/local/auth");
    try {
      const r = await signInWithPin(scope, nickname, pin);
      return { uid: r.user.uid };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const known = ["pin/wrong", "pin/locked", "pin/reset-expired", "invalid-argument"].includes(e.code ?? "");
      throw new IdentityError(known ? e.code!.replace("pin/", "") : "failed", known ? e.message ?? NOT_REACHED : NOT_REACHED);
    }
  }

  let res: Response;
  try {
    res = await fetch("/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "claim", scope, nickname, pin, idToken: await user.getIdToken() }),
    });
  } catch {
    throw new IdentityError("failed", NOT_REACHED);
  }
  // The PIN service is not set up on this deployment (no server key): joining works as it always did.
  if (res.status === 404 || res.status === 503) return { uid: user.uid };
  const body = (await res.json().catch(() => ({}))) as { customToken?: string | null; uid?: string; code?: string; message?: string };
  if (!res.ok) throw new IdentityError(body.code ?? "failed", body.message ?? NOT_REACHED);
  if (!body.customToken) return { uid: user.uid }; // already this identity
  const cred = await signInWithCustomToken(auth, body.customToken);
  return { uid: cred.user.uid };
}

/**
 * A teacher forgets all nicknames and PINs of a class, just before the class is deleted. Never throws: if it
 * cannot be done, deleting the class still goes ahead.
 */
export async function releaseNicknames(scope: string): Promise<void> {
  try {
    if (isLocalBackend) {
      const { releasePins } = await import("@/backend/local/auth");
      await releasePins(scope);
      return;
    }
    const user = auth.currentUser;
    if (!user) return;
    await fetch("/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "release", scope, idToken: await user.getIdToken() }),
    });
  } catch {
    /* best effort */
  }
}

/**
 * A teacher resets one student's forgotten PIN. The student keeps their identity (group and text) and has half an
 * hour to choose a new PIN on the join page. Throws IdentityError with a message for the teacher if it cannot be done.
 */
export async function resetStudentPin(scope: string, nickname: string): Promise<void> {
  if (isLocalBackend) {
    const { resetPin } = await import("@/backend/local/auth");
    try {
      await resetPin(scope, nickname);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      throw new IdentityError(e.code ?? "failed", e.message ?? "Could not reset the PIN. Please try again.");
    }
    return;
  }
  const user = auth.currentUser;
  if (!user) throw new IdentityError("unauthenticated", "Please sign in again.");
  let res: Response;
  try {
    res = await fetch("/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reset", scope, nickname, idToken: await user.getIdToken() }),
    });
  } catch {
    throw new IdentityError("failed", "Could not reach the server. Please try again.");
  }
  if (res.status === 404 && !(await res.clone().json().catch(() => null))?.code) {
    throw new IdentityError("unavailable", "PIN sign-in is not set up on this server.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new IdentityError(body.code ?? "failed", body.message ?? "Could not reset the PIN. Please try again.");
  }
}

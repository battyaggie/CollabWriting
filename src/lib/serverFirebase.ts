// Server-side Firebase (Admin SDK), for API routes that must act with more rights than a browser has.
// Needs the environment variable FIREBASE_SERVICE_ACCOUNT (see .env.local.example). Returns null without it.
import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as ServiceAccount;
  } catch {
    return null;
  }
}

export function adminServices() {
  const account = serviceAccount();
  if (!account) return null;
  const app = getApps()[0] ?? initializeApp({ credential: cert(account) });
  return { auth: getAuth(app), db: getFirestore(app) };
}

/** Addresses of the administrators: the environment variable ADMIN_EMAIL, comma-separated, case does not matter. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

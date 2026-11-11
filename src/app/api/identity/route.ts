// Vercel version of the nickname + PIN check (the container does the same inside server/app.mjs).
// See src/lib/identity.ts for the idea and server/pin.mjs for the rules, which both versions share.
//
// Needs the environment variable FIREBASE_SERVICE_ACCOUNT on the Vercel project: the JSON of a Firebase
// service-account key (Firebase console -> Project settings -> Service accounts -> Generate new private key),
// pasted as it is, or as base64. Without it this route answers 503 and joining works without PINs.
//
// Records live in the Firestore collection "pins". The security rules give nobody access to it (see
// firestore.rules); only this route, through the Admin SDK, reads and writes it.
import { NextResponse } from "next/server";
import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  LOCK_MS,
  WRONG_PIN_MESSAGE,
  cleanNickname,
  decideClaim,
  lockedMessage,
  pinProblem,
  recordId,
} from "../../../../server/pin.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as ServiceAccount;
  } catch {
    return null;
  }
}

function services() {
  const account = serviceAccount();
  if (!account) return null;
  const app = getApps()[0] ?? initializeApp({ credential: cert(account) });
  return { auth: getAuth(app), db: getFirestore(app) };
}

const reply = (status: number, code: string, message: string) => NextResponse.json({ code, message }, { status });
const text = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_BACKEND === "local") return reply(404, "unavailable", "Not available.");
  const svc = services();
  if (!svc) return reply(503, "unavailable", "PIN sign-in is not set up on this server.");
  const { auth, db } = svc;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return reply(400, "invalid", "Bad request.");
  }
  const scope = text(body.scope);
  if (!scope || scope.length > 200) return reply(400, "invalid", "Unknown class.");

  let caller;
  try {
    caller = await auth.verifyIdToken(text(body.idToken));
  } catch {
    return reply(401, "unauthenticated", "Please reload the page and try again.");
  }
  // Teachers sign in with email + password; students are anonymous, or already signed back in with a PIN ("custom").
  const provider = caller.firebase?.sign_in_provider;
  const isStudent = provider === "anonymous" || provider === "custom";

  if (body.action === "release") {
    // A teacher forgets all nicknames and PINs of their class (called just before the class is deleted).
    if (isStudent) return reply(403, "denied", "Teachers only.");
    const owner =
      (await db.doc(`courses/${scope}`).get()).data()?.teacherId ?? (await db.doc(`classes/${scope}`).get()).data()?.teacherId;
    if (!owner || owner !== caller.uid) return reply(403, "denied", "This is not your class.");
    const found = await db.collection("pins").where("scope", "==", scope).get();
    for (let i = 0; i < found.docs.length; i += 400) {
      const batch = db.batch();
      found.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    return NextResponse.json({ removed: found.size });
  }

  if (!isStudent) return reply(403, "denied", "Only students use a PIN.");
  const nickname = cleanNickname(body.nickname);
  if (!nickname || nickname.length > 60) return reply(400, "invalid-argument", "Enter a nickname.");
  const problem = pinProblem(body.pin);
  if (problem) return reply(400, "invalid-argument", problem);

  const ref = db.collection("pins").doc(recordId(scope, nickname));
  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.exists ? snap.data() : null;
    const d = decideClaim(stored, body.pin, caller.uid, Date.now());
    if (d.outcome === "registered") {
      // One nickname per identity per class: choosing a different nickname frees the old one.
      const others = await tx.get(db.collection("pins").where("scope", "==", scope).where("uid", "==", caller.uid));
      others.docs.forEach((o) => tx.delete(o.ref));
      tx.set(ref, { scope, nickname, ...d.record, createdAt: Date.now() });
    } else if (d.outcome !== "locked") {
      tx.update(ref, { failures: d.record.failures, lockedUntil: d.record.lockedUntil });
    }
    return d;
  });

  if (decision.outcome === "locked") return reply(429, "locked", lockedMessage(decision.retryInMs ?? LOCK_MS));
  if (decision.outcome === "wrong") return reply(403, "wrong", decision.locks ? lockedMessage(LOCK_MS) : WRONG_PIN_MESSAGE);

  // Right PIN (or first use). If this browser already is that identity there is nothing to switch.
  const uid = decision.uid as string;
  const customToken = uid === caller.uid ? null : await auth.createCustomToken(uid);
  return NextResponse.json({ uid, customToken, registered: decision.outcome === "registered" });
}

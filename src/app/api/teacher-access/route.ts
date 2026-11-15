// Who may be a teacher on the Vercel version (the container version has its own approval, see server/accounts.mjs).
//
// The list of approved email addresses is the Firestore collection "teacherAllowlist" (document id = the address in
// lower case). The security rules (firestore.rules) only let an approved address create classes, and give nobody
// access to the collection itself: only this route, with the Admin SDK, reads and writes it, and only for the
// administrators named in the environment variable ADMIN_EMAIL.
//
// Approving an address also creates its Firebase account (with a random password nobody knows). The teacher then
// uses "send me a password link" on the sign-in page, which proves the address is theirs. Nobody can sign up for
// an approved address first, because the account already exists.
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { adminEmails, adminServices } from "@/lib/serverFirebase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (status: number, code: string, message: string) => NextResponse.json({ code, message }, { status });
const text = (v: unknown) => (typeof v === "string" ? v : "");
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const MAX_ADD = 300;

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_BACKEND === "local") return reply(404, "unavailable", "Not available.");
  const svc = adminServices();
  const admins = adminEmails();
  if (!svc || admins.length === 0) {
    return reply(503, "unavailable", "Not set up on this server: FIREBASE_SERVICE_ACCOUNT and ADMIN_EMAIL are needed.");
  }
  const { auth, db } = svc;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return reply(400, "invalid", "Bad request.");
  }

  let caller;
  try {
    caller = await auth.verifyIdToken(text(body.idToken));
  } catch {
    return reply(401, "unauthenticated", "Please sign in again.");
  }
  const callerEmail = (caller.email ?? "").toLowerCase();
  if (caller.firebase?.sign_in_provider !== "password" || !admins.includes(callerEmail)) {
    return reply(403, "denied", "This is for administrators only.");
  }

  const list = db.collection("teacherAllowlist");

  // Makes sure there is an enabled account for the address (created with a random password if it is new).
  async function ensureAccount(email: string): Promise<void> {
    try {
      const u = await auth.getUserByEmail(email);
      if (u.disabled) await auth.updateUser(u.uid, { disabled: false });
    } catch (err) {
      if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
      await auth.createUser({ email, password: randomBytes(24).toString("base64url"), emailVerified: false });
    }
  }

  switch (body.action) {
    case "list": {
      const snap = await list.get();
      const rows = snap.docs.map((d) => ({ email: d.id, addedAt: Number(d.data().addedAt) || 0, signedIn: null as number | null }));
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const found = await auth.getUsers(chunk.map((r) => ({ email: r.email })));
        for (const u of found.users) {
          const row = chunk.find((r) => r.email === (u.email ?? "").toLowerCase());
          const t = u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : 0;
          if (row) row.signedIn = t || null;
        }
      }
      rows.sort((a, b) => a.email.localeCompare(b.email));
      return NextResponse.json({ rows, admins });
    }

    case "add": {
      const wanted = Array.isArray(body.emails) ? (body.emails as unknown[]).map((e) => text(e).trim().toLowerCase()).filter(Boolean) : [];
      if (wanted.length === 0) return reply(400, "invalid", "Enter at least one email address.");
      if (wanted.length > MAX_ADD) return reply(400, "invalid", `At most ${MAX_ADD} addresses at a time.`);
      const results: { email: string; status: "added" | "already" | "invalid" | "failed" }[] = [];
      for (const email of Array.from(new Set(wanted))) {
        if (!EMAIL.test(email) || email.length > 200) {
          results.push({ email, status: "invalid" });
          continue;
        }
        try {
          const ref = list.doc(email);
          const existed = (await ref.get()).exists;
          await ensureAccount(email);
          if (!existed) await ref.set({ addedAt: Date.now(), addedBy: callerEmail });
          results.push({ email, status: existed ? "already" : "added" });
        } catch {
          results.push({ email, status: "failed" });
        }
      }
      return NextResponse.json({ results });
    }

    case "remove": {
      const email = text(body.email).trim().toLowerCase();
      if (!EMAIL.test(email)) return reply(400, "invalid", "Unknown address.");
      if (admins.includes(email)) return reply(400, "invalid", "An administrator cannot be removed here.");
      await list.doc(email).delete();
      try {
        const u = await auth.getUserByEmail(email);
        await auth.updateUser(u.uid, { disabled: true });
        await auth.revokeRefreshTokens(u.uid);
      } catch {
        /* no account: nothing to switch off */
      }
      return NextResponse.json({ removed: email });
    }

    case "approve-existing": {
      // One-off: everybody who already has an email + password account stays approved.
      let added = 0;
      let token: string | undefined;
      do {
        const page = await auth.listUsers(1000, token);
        const batch = db.batch();
        let n = 0;
        for (const u of page.users) {
          const email = (u.email ?? "").toLowerCase();
          if (!email || !EMAIL.test(email) || !u.providerData.some((p) => p.providerId === "password")) continue;
          const ref = list.doc(email);
          if ((await ref.get()).exists) continue;
          batch.set(ref, { addedAt: Date.now(), addedBy: callerEmail, existing: true });
          n++;
        }
        if (n > 0) await batch.commit();
        added += n;
        token = page.pageToken;
      } while (token);
      return NextResponse.json({ added });
    }

    default:
      return reply(400, "invalid", "Unknown action.");
  }
}

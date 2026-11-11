// PIN logic shared by the container server (server/pins.mjs) and the Vercel route
// (src/app/api/identity/route.ts), so both versions behave the same. Pure functions, no storage.
//
// What a PIN is for: a student's identity is a random id that belongs to one browser. A nickname + PIN,
// chosen the first time they join a class, lets them get the same identity (and so the same group and text)
// back on another device. Per class (not per exercise), and per nickname: the nickname is the "user name".
// Only a salted scrypt hash of the PIN is ever stored.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const PIN_MIN = 4;
export const PIN_MAX = 32;
/** After this many wrong PINs in a row the nickname is locked for LOCK_MS (the only brake on guessing a 4-digit PIN). */
export const MAX_FAILURES = 5;
export const LOCK_MS = 10 * 60_000;
/** After a teacher resets a forgotten PIN the student has this long to choose a new one (see resetRecord). */
export const RESET_MS = 30 * 60_000;

export function cleanNickname(nickname) {
  return String(nickname ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** "Anna_K" and "anna_k " are the same nickname. */
export function nicknameKey(nickname) {
  return cleanNickname(nickname).toLowerCase();
}

export function cleanPin(pin) {
  return String(pin ?? "").trim();
}

/** Returns a message for the student if the PIN is not acceptable, otherwise null. */
export function pinProblem(pin) {
  const p = cleanPin(pin);
  if (p.length < PIN_MIN) return `Your PIN needs at least ${PIN_MIN} characters.`;
  if (p.length > PIN_MAX) return `Your PIN can have at most ${PIN_MAX} characters.`;
  return null;
}

/** The storage key of one nickname in one class. A hash, so it is safe as a document id whatever the nickname contains. */
export function recordId(scope, nickname) {
  return createHash("sha256").update(`${scope}\n${nicknameKey(nickname)}`).digest("hex");
}

export function hashPin(pin, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(cleanPin(pin), salt, 32).toString("hex") };
}

export function pinMatches(record, pin) {
  const want = Buffer.from(record.hash, "hex");
  const got = scryptSync(cleanPin(pin), record.salt, 32);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * A teacher resets a forgotten PIN: the nickname stays tied to the same identity (so the same group and text),
 * but has no PIN for RESET_MS. Whoever presents the nickname in that time chooses the new PIN, so the teacher
 * tells the student to do it straight away. After that time nothing can be claimed until the teacher resets again.
 */
export function resetRecord(record, nowMs) {
  return { ...record, salt: "", hash: "", failures: 0, lockedUntil: 0, resetUntil: nowMs + RESET_MS };
}

/**
 * Decides what happens when someone presents `pin` for a nickname.
 * `record` is what is stored for that nickname in that class, or null: { uid, salt, hash, failures, lockedUntil }.
 * `callerUid` is the identity of the browser asking (an anonymous student).
 * Returns { outcome, record, uid? }: "registered" (first use: the caller's identity is now tied to the nickname),
 * "ok" (right PIN: the stored identity is returned), "wrong", "locked", "reset-done" (the teacher had reset the PIN:
 * the PIN presented is now the PIN, and the stored identity is returned) or "reset-expired". `record` is what to
 * store afterwards.
 */
export function decideClaim(record, pin, callerUid, nowMs) {
  if (!record) {
    const { salt, hash } = hashPin(pin);
    return { outcome: "registered", uid: callerUid, record: { uid: callerUid, salt, hash, failures: 0, lockedUntil: 0 } };
  }
  if (record.hash === "") {
    if ((record.resetUntil ?? 0) <= nowMs) return { outcome: "reset-expired", record };
    const { salt, hash } = hashPin(pin);
    return { outcome: "reset-done", uid: record.uid, record: { ...record, salt, hash, failures: 0, lockedUntil: 0, resetUntil: 0 } };
  }
  if ((record.lockedUntil ?? 0) > nowMs) return { outcome: "locked", record, retryInMs: record.lockedUntil - nowMs };
  if (pinMatches(record, pin)) {
    return { outcome: "ok", uid: record.uid, record: { ...record, failures: 0, lockedUntil: 0 } };
  }
  const failures = (record.failures ?? 0) + 1;
  const locks = failures >= MAX_FAILURES;
  return {
    outcome: "wrong",
    record: { ...record, failures: locks ? 0 : failures, lockedUntil: locks ? nowMs + LOCK_MS : 0 },
    locks,
  };
}

export const WRONG_PIN_MESSAGE =
  "That PIN doesn't match this nickname. If someone else in your class already uses this nickname, please choose another one.";

export function lockedMessage(retryInMs) {
  const minutes = Math.max(1, Math.ceil(retryInMs / 60_000));
  return `Too many wrong PINs for this nickname. Please wait ${minutes} ${minutes === 1 ? "minute" : "minutes"} and try again.`;
}

export const RESET_EXPIRED_MESSAGE =
  "Your teacher reset this PIN, but the time to choose a new one has run out. Please ask your teacher to reset it again.";

export const NO_PIN_MESSAGE = "No PIN is set for that nickname in this class.";

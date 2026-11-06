import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { StoreError } from "./errors.mjs";

const scryptAsync = promisify(scrypt);

export const MIN_PASSWORD_LENGTH = 10;
const SETUP_LINK_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function normalizeEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (email.length > 200 || !EMAIL_RE.test(email)) throw new StoreError("invalid-argument", "Please enter a valid email address.");
  return email;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `s1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function checkPassword(password, stored) {
  const [tag, saltB64, hashB64] = String(stored ?? "").split("$");
  if (tag !== "s1" || !saltB64 || !hashB64) return false;
  const want = Buffer.from(hashB64, "base64");
  const got = await scryptAsync(password, Buffer.from(saltB64, "base64"), want.length);
  return timingSafeEqual(got, want);
}

/** Counts events per key within a time window (kept in memory; a restart resets it). */
export class RateLimiter {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.hits = new Map();
  }
  /** Returns true if the event is allowed, false if `key` has already had `max` events in the last `windowMs`. */
  allow(key, max, windowMs) {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < windowMs)) this.hits.delete(k);
    return true;
  }
}

/**
 * Teacher accounts. Nobody can register themselves: a lecturer asks for access, an administrator
 * approves, and the lecturer then chooses a password through a one-time link.
 */
export class Accounts {
  constructor(store, now = () => Date.now()) {
    this.db = store.db;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        uid        TEXT PRIMARY KEY,
        email      TEXT NOT NULL UNIQUE,
        name       TEXT NOT NULL DEFAULT '',
        pw         TEXT,
        is_admin   INTEGER NOT NULL DEFAULT 0,
        disabled   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS access_requests (
        id         TEXT PRIMARY KEY,
        email      TEXT NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS setup_tokens (
        hash       TEXT PRIMARY KEY,
        uid        TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  static publicUser(row) {
    return { uid: row.uid, email: row.email, name: row.name, isAnonymous: false, isAdmin: !!row.is_admin };
  }

  /** The signed-in teacher with this uid, or null (unknown uid = an anonymous student; disabled = no access). */
  getUser(uid) {
    const row = this.db.prepare("SELECT * FROM users WHERE uid = ?").get(uid);
    return row && !row.disabled ? row : null;
  }

  #byEmail(email) {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  }

  #newUid() {
    return `t${randomBytes(13).toString("hex")}`;
  }

  /** Makes sure the administrators named in the settings exist. Returns those who still need to choose a password. */
  bootstrapAdmins(emails) {
    const needSetup = [];
    for (const raw of emails) {
      const email = normalizeEmail(raw);
      let row = this.#byEmail(email);
      if (!row) {
        const uid = this.#newUid();
        this.db
          .prepare("INSERT INTO users (uid, email, name, is_admin, created_at) VALUES (?, ?, '', 1, ?)")
          .run(uid, email, this.now());
        row = this.#byEmail(email);
      } else if (!row.is_admin || row.disabled) {
        this.db.prepare("UPDATE users SET is_admin = 1, disabled = 0 WHERE uid = ?").run(row.uid);
      }
      if (!row.pw) needSetup.push({ email, setupToken: this.issueSetupToken(row.uid).token });
    }
    return needSetup;
  }

  /** A lecturer asks for access. Asking twice, or asking with an existing account, changes nothing. */
  createRequest(rawEmail, rawName) {
    const email = normalizeEmail(rawEmail);
    const name = String(rawName ?? "").trim().slice(0, 100);
    if (this.#byEmail(email)) return { created: false, reason: "has-account" };
    const pending = this.db.prepare("SELECT id FROM access_requests WHERE email = ? AND status = 'pending'").get(email);
    if (pending) return { created: false, reason: "already-pending" };
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE status = 'pending'").get().n;
    if (count >= 200) throw new StoreError("resource-exhausted", "Too many open requests. Please try again later.");
    const id = randomBytes(9).toString("hex");
    this.db
      .prepare("INSERT INTO access_requests (id, email, name, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(id, email, name, this.now());
    return { created: true, id, email, name };
  }

  listRequests() {
    return this.db
      .prepare("SELECT id, email, name, status, created_at AS createdAt, decided_at AS decidedAt FROM access_requests ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200")
      .all();
  }

  listUsers() {
    return this.db
      .prepare("SELECT uid, email, name, is_admin AS isAdmin, disabled, (pw IS NOT NULL) AS hasPassword, created_at AS createdAt FROM users ORDER BY email")
      .all()
      .map((u) => ({ ...u, isAdmin: !!u.isAdmin, disabled: !!u.disabled, hasPassword: !!u.hasPassword }));
  }

  /** Approves a request: creates the account (without a password) and a one-time setup link token. */
  approve(requestId) {
    const req = this.db.prepare("SELECT * FROM access_requests WHERE id = ?").get(requestId);
    if (!req) throw new StoreError("not-found", "No such request.");
    let user = this.#byEmail(req.email);
    if (!user) {
      this.db
        .prepare("INSERT INTO users (uid, email, name, created_at) VALUES (?, ?, ?, ?)")
        .run(this.#newUid(), req.email, req.name, this.now());
      user = this.#byEmail(req.email);
    } else if (user.disabled) {
      this.db.prepare("UPDATE users SET disabled = 0 WHERE uid = ?").run(user.uid);
    }
    this.db.prepare("UPDATE access_requests SET status = 'approved', decided_at = ? WHERE id = ?").run(this.now(), requestId);
    return { email: user.email, name: user.name, ...this.issueSetupToken(user.uid) };
  }

  /**
   * Creates accounts for a list of people at once (no passwords yet) and a one-time setup link for each.
   * Anyone who already has a password is left alone; anyone still waiting for their link gets a fresh one.
   * Open access requests from these addresses are marked approved.
   */
  importPeople(people) {
    if (!Array.isArray(people) || people.length > 300) throw new StoreError("invalid-argument", "Please import at most 300 people at a time.");
    const seen = new Set();
    const rows = [];
    for (const p of people) {
      const name = String(p?.name ?? "").trim().slice(0, 100);
      let email;
      try {
        email = normalizeEmail(p?.email);
      } catch {
        rows.push({ name, email: String(p?.email ?? "").slice(0, 200), status: "invalid" });
        continue;
      }
      if (seen.has(email)) {
        rows.push({ name, email, status: "duplicate" });
        continue;
      }
      seen.add(email);
      let user = this.#byEmail(email);
      let status = "created";
      if (!user) {
        this.db.prepare("INSERT INTO users (uid, email, name, created_at) VALUES (?, ?, ?, ?)").run(this.#newUid(), email, name, this.now());
        user = this.#byEmail(email);
      } else if (user.pw && !user.disabled) {
        rows.push({ name: user.name || name, email, status: "exists" });
        continue;
      } else {
        status = "link-renewed";
        if (user.disabled) this.db.prepare("UPDATE users SET disabled = 0 WHERE uid = ?").run(user.uid);
      }
      this.db
        .prepare("UPDATE access_requests SET status = 'approved', decided_at = ? WHERE email = ? AND status = 'pending'")
        .run(this.now(), email);
      rows.push({ name: user.name || name, email, status, ...this.issueSetupToken(user.uid) });
    }
    return rows;
  }

  reject(requestId) {
    const r = this.db
      .prepare("UPDATE access_requests SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(this.now(), requestId);
    if (!r.changes) throw new StoreError("not-found", "No such open request.");
  }

  /** A fresh one-time link token for choosing (or resetting) a password. Older ones stop working. */
  issueSetupToken(uid) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + SETUP_LINK_DAYS * 86400_000;
    this.db.prepare("DELETE FROM setup_tokens WHERE uid = ?").run(uid);
    this.db.prepare("INSERT INTO setup_tokens (hash, uid, expires_at) VALUES (?, ?, ?)").run(sha256(token), uid, expiresAt);
    return { token, expiresAt };
  }

  resetPassword(uid) {
    const user = this.db.prepare("SELECT * FROM users WHERE uid = ?").get(uid);
    if (!user) throw new StoreError("not-found", "No such account.");
    return { email: user.email, name: user.name, ...this.issueSetupToken(uid) };
  }

  setDisabled(uid, disabled) {
    const r = this.db.prepare("UPDATE users SET disabled = ? WHERE uid = ?").run(disabled ? 1 : 0, uid);
    if (!r.changes) throw new StoreError("not-found", "No such account.");
  }

  /** Uses a setup link: sets the password and returns the account. */
  async completeSetup(token, password) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new StoreError("auth/weak-password", `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (password.length > 200) throw new StoreError("auth/weak-password", "The password is too long.");
    const row = this.db.prepare("SELECT * FROM setup_tokens WHERE hash = ?").get(sha256(String(token ?? "")));
    if (!row || row.expires_at < this.now()) {
      throw new StoreError("auth/invalid-action-code", "This link has expired or was already used. Ask for a new one.");
    }
    const pw = await hashPassword(password);
    this.db.prepare("UPDATE users SET pw = ? WHERE uid = ?").run(pw, row.uid);
    this.db.prepare("DELETE FROM setup_tokens WHERE uid = ?").run(row.uid);
    const user = this.getUser(row.uid);
    if (!user) throw new StoreError("auth/user-disabled", "This account is switched off.");
    return user;
  }

  /** Checks an email and password. Always takes about the same time, whether or not the account exists. */
  async login(rawEmail, password) {
    let email;
    try {
      email = normalizeEmail(rawEmail);
    } catch {
      email = "";
    }
    const row = email ? this.#byEmail(email) : undefined;
    this.dummy ??= await hashPassword("dummy-password-for-timing");
    const ok = await checkPassword(String(password ?? ""), row?.pw ?? this.dummy);
    if (!row || !row.pw || !ok || row.disabled) {
      throw new StoreError("auth/invalid-credential", "Wrong email or password.");
    }
    return row;
  }
}

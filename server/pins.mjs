import { StoreError } from "./errors.mjs";
import {
  LOCK_MS,
  NO_PIN_MESSAGE,
  RESET_EXPIRED_MESSAGE,
  WRONG_PIN_MESSAGE,
  cleanNickname,
  decideClaim,
  lockedMessage,
  pinProblem,
  recordId,
  resetRecord,
} from "./pin.mjs";

/**
 * Nickname + PIN records of the container version (see pin.mjs). Kept in their own table, not in the
 * document store, so no screen can read them: the browser can only ask the server to check a PIN.
 */
export class Pins {
  constructor(store, now = () => Date.now()) {
    this.db = store.db;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pins (
        id           TEXT PRIMARY KEY,
        scope        TEXT NOT NULL,
        nickname     TEXT NOT NULL,
        uid          TEXT NOT NULL,
        salt         TEXT NOT NULL,
        hash         TEXT NOT NULL,
        failures     INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pins_scope ON pins(scope);
    `);
    // Added after the first version of this table (a PIN reset by a teacher is open until this time).
    if (!this.db.prepare("PRAGMA table_info(pins)").all().some((c) => c.name === "reset_until")) {
      this.db.exec("ALTER TABLE pins ADD COLUMN reset_until INTEGER NOT NULL DEFAULT 0");
    }
  }

  /**
   * A student presents a nickname and PIN for a class (`scope`: the class code, or the exercise code for a single session).
   * Returns { uid, registered }: the identity they now have. Throws a StoreError for a wrong PIN or a locked nickname.
   */
  claim(scope, nickname, pin, callerUid) {
    scope = String(scope ?? "");
    const nick = cleanNickname(nickname);
    if (!scope || scope.length > 200) throw new StoreError("invalid-argument", "Unknown class.");
    if (!nick || nick.length > 60) throw new StoreError("invalid-argument", "Enter a nickname.");
    const problem = pinProblem(pin);
    if (problem) throw new StoreError("invalid-argument", problem);

    const id = recordId(scope, nick);
    const t = this.now();
    const row = this.db.prepare("SELECT uid, salt, hash, failures, locked_until, reset_until FROM pins WHERE id = ?").get(id);
    const stored = row
      ? { uid: row.uid, salt: row.salt, hash: row.hash, failures: row.failures, lockedUntil: row.locked_until, resetUntil: row.reset_until }
      : null;
    const d = decideClaim(stored, pin, callerUid, t);

    if (d.outcome === "registered") {
      this.db.exec("BEGIN");
      try {
        // One nickname per identity per class: choosing a different nickname frees the old one.
        this.db.prepare("DELETE FROM pins WHERE scope = ? AND uid = ?").run(scope, callerUid);
        this.db
          .prepare("INSERT INTO pins (id, scope, nickname, uid, salt, hash, failures, locked_until, created_at) VALUES (?,?,?,?,?,?,0,0,?)")
          .run(id, scope, nick, callerUid, d.record.salt, d.record.hash, t);
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
      return { uid: callerUid, registered: true };
    }
    if (d.outcome === "locked") throw new StoreError("pin/locked", lockedMessage(d.retryInMs));
    if (d.outcome === "reset-expired") throw new StoreError("pin/reset-expired", RESET_EXPIRED_MESSAGE);
    this.db
      .prepare("UPDATE pins SET salt = ?, hash = ?, failures = ?, locked_until = ?, reset_until = ? WHERE id = ?")
      .run(d.record.salt, d.record.hash, d.record.failures, d.record.lockedUntil, d.record.resetUntil ?? 0, id);
    if (d.outcome === "wrong") {
      throw new StoreError("pin/wrong", d.locks ? lockedMessage(LOCK_MS) : WRONG_PIN_MESSAGE);
    }
    return { uid: d.uid, registered: false };
  }

  /**
   * A teacher resets one forgotten PIN: the nickname keeps its identity (group and text) but the student has
   * RESET_MS to choose a new PIN. Returns { until } (when the chance runs out).
   */
  reset(scope, nickname) {
    const nick = cleanNickname(nickname);
    const id = recordId(String(scope ?? ""), nick);
    const row = this.db.prepare("SELECT 1 AS found FROM pins WHERE id = ?").get(id);
    if (!row) throw new StoreError("not-found", NO_PIN_MESSAGE);
    const r = resetRecord({}, this.now());
    this.db
      .prepare("UPDATE pins SET salt = '', hash = '', failures = 0, locked_until = 0, reset_until = ? WHERE id = ?")
      .run(r.resetUntil, id);
    return { until: r.resetUntil };
  }

  /** Forgets every nickname and PIN of a class (used when the class is deleted). Returns how many were removed. */
  releaseScope(scope) {
    return Number(this.db.prepare("DELETE FROM pins WHERE scope = ?").run(String(scope)).changes);
  }
}

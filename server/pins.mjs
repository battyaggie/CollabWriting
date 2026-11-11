import { StoreError } from "./errors.mjs";
import { LOCK_MS, cleanNickname, decideClaim, lockedMessage, pinProblem, recordId, WRONG_PIN_MESSAGE } from "./pin.mjs";

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
    const row = this.db.prepare("SELECT uid, salt, hash, failures, locked_until FROM pins WHERE id = ?").get(id);
    const stored = row
      ? { uid: row.uid, salt: row.salt, hash: row.hash, failures: row.failures, lockedUntil: row.locked_until }
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
    this.db
      .prepare("UPDATE pins SET failures = ?, locked_until = ? WHERE id = ?")
      .run(d.record.failures, d.record.lockedUntil, id);
    if (d.outcome === "wrong") {
      throw new StoreError("pin/wrong", d.locks ? lockedMessage(LOCK_MS) : WRONG_PIN_MESSAGE);
    }
    return { uid: d.uid, registered: false };
  }

  /** Forgets every nickname and PIN of a class (used when the class is deleted). Returns how many were removed. */
  releaseScope(scope) {
    return Number(this.db.prepare("DELETE FROM pins WHERE scope = ?").run(String(scope)).changes);
  }
}

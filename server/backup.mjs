import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Writes a consistent copy of the whole database (VACUUM INTO) to `dir`, named by date and time, and
 * deletes the oldest copies so only the newest `keep` remain. Safe while the server is running; a
 * plain copy of the live database file is not, because it runs in WAL mode.
 * Returns the path of the new backup.
 */
export function backupNow(store, dir, keep = 14, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:]/g, "-").replace(/\.\d+Z$/, "Z");
  const final = join(dir, `collab-writing-${stamp}.sqlite`);
  const tmp = `${final}.part`;
  rmSync(tmp, { force: true });
  store.db.prepare("VACUUM INTO ?").run(tmp);
  renameSync(tmp, final); // a backup file only ever appears complete
  const all = readdirSync(dir).filter((f) => /^collab-writing-.*\.sqlite$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(dir, old), { force: true });
  return final;
}

/** Backs up now and then every `everyHours`. Returns a function that stops the timer. */
export function startBackups(store, { dir, keep, everyHours = 24, log = () => {} }) {
  const run = () => {
    try {
      log(`Backup written: ${backupNow(store, dir, keep)}`);
    } catch (err) {
      log("Backup FAILED:", err?.message ?? err);
    }
  };
  run();
  const timer = setInterval(run, everyHours * 3600_000);
  timer.unref();
  return () => clearInterval(timer);
}

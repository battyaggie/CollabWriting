// Entry point of the container: starts the backend and serves the Next.js app on the same port.
//
// Settings (environment variables):
//   PORT            port to listen on                      (default 3000)
//   DATA_DIR        folder for the database file           (default ./data; /data in the container)
//   SESSION_SECRET  secret for sign-in tokens; if unset, one is generated and kept in the database
//   ADMIN_EMAIL    email address(es) of the administrator(s), comma-separated; they approve teacher access
//   TRUST_PROXY=1  the server sits behind a reverse proxy that sets X-Forwarded-For (used for rate limits)
//   BACKUP_DIR     where daily database backups go        (default <DATA_DIR>/backups)
//   BACKUP_KEEP    how many backups to keep               (default 14)
//   BACKUP_EVERY_HOURS  hours between backups              (default 24; 0 = no automatic backups)
//   NO_NEXT=1       only run the backend (used by the tests)
import { join } from "node:path";
import { createBackend } from "./app.mjs";
import { startBackups } from "./backup.mjs";

const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? "./data";
const log = (...a) => console.log(new Date().toISOString(), ...a);

let nextHandler = null;
if (!process.env.NO_NEXT) {
  const { default: next } = await import("next");
  const nextApp = next({ dev: false, dir: process.cwd() });
  await nextApp.prepare();
  nextHandler = nextApp.getRequestHandler();
}

const backend = createBackend({
  dataFile: join(dataDir, "collab-writing.sqlite"),
  secret: process.env.SESSION_SECRET || undefined,
  nextHandler,
  log,
  adminEmails: (process.env.ADMIN_EMAIL ?? "").split(",").map((e) => e.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === "1",
});
for (const a of backend.adminSetups) {
  log(`Administrator ${a.email} has no password yet. Open  <address of this server>/teacher/set-password?token=${a.setupToken}  (valid 7 days)`);
}
if (!process.env.ADMIN_EMAIL) log("Warning: ADMIN_EMAIL is not set, so nobody can approve teacher accounts.");
const actual = await backend.listen(port);
log(`Collaborative Writing listening on port ${actual}, data in ${dataDir}`);

const backupEvery = Number(process.env.BACKUP_EVERY_HOURS ?? 24);
if (backupEvery > 0) {
  startBackups(backend.store, {
    dir: process.env.BACKUP_DIR ?? join(dataDir, "backups"),
    keep: Number(process.env.BACKUP_KEEP ?? 14),
    everyHours: backupEvery,
    log,
  });
}

const stop = async (signal) => {
  log(`${signal} received, shutting down`);
  await backend.close();
  process.exit(0);
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

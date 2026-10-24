// Entry point of the container: starts the backend and serves the Next.js app on the same port.
//
// Settings (environment variables):
//   PORT            port to listen on                      (default 3000)
//   DATA_DIR        folder for the database file           (default ./data; /data in the container)
//   SESSION_SECRET  secret for sign-in tokens; if unset, one is generated and kept in the database
//   NO_NEXT=1       only run the backend (used by the tests)
import { join } from "node:path";
import { createBackend } from "./app.mjs";

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
});
const actual = await backend.listen(port);
log(`Collaborative Writing listening on port ${actual}, data in ${dataDir}`);

const stop = async (signal) => {
  log(`${signal} received, shutting down`);
  await backend.close();
  process.exit(0);
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

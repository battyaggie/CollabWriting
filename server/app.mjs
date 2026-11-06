import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Store, splitPath, checkDocPath, checkCollPath } from "./store.mjs";
import { StoreError } from "./errors.mjs";
import { parseSpec, runQuery } from "./query.mjs";
import { attachWebSocket } from "./websocket.mjs";
import { firestoreRules } from "./rules.mjs";
import { Accounts, RateLimiter } from "./accounts.mjs";

/**
 * The whole backend in one object: HTTP (health check + the Next.js pages), one WebSocket per
 * browser tab, and the SQLite store. It speaks a small JSON protocol (see README "Protocol"):
 *
 *   browser -> server  {t:"hello", rid, token?}                    who am I?
 *                      {t:"anon", rid} / {t:"signout", rid}
 *                      {t:"sub", sid, kind:"doc"|"query", path, where?, order?}   live updates
 *                      {t:"unsub", sid}
 *                      {t:"get", rid, kind, path, where?, order?}  one-off read
 *                      {t:"commit", rid, writes:[...], reads?:{path:version}}
 *   server -> browser  {t:"res", rid, ok, ...}                     answer to a request
 *                      {t:"snap", sid, doc|docs}                   current result of a live query
 *                      {t:"suberr", sid, code, message}
 *
 * A write is applied, every affected live query is re-sent, and only THEN is the writer answered,
 * so a browser always sees the effect of its own write before the confirmation of it.
 */
export function createBackend({
  dataFile,
  secret,
  rules = firestoreRules,
  nextHandler = null,
  log = () => {},
  adminEmails = [],
  trustProxy = false,
  now = () => Date.now(),
}) {
  const store = new Store(dataFile);
  const accounts = new Accounts(store, now);
  const limiter = new RateLimiter(now);
  const adminSetups = accounts.bootstrapAdmins(adminEmails);

  let key = secret || store.getMeta("secret");
  if (!key) {
    key = randomBytes(32).toString("hex");
    store.setMeta("secret", key);
  }

  // A sign-in token is "uid.expiry.signature". Students keep theirs for a year, teachers for 30 days.
  const mac = (text) => createHmac("sha256", key).update(text).digest("base64url");
  const STUDENT_TOKEN_MS = 365 * 86400_000;
  const TEACHER_TOKEN_MS = 30 * 86400_000;
  const signToken = (uid, ttl) => {
    const body = `${uid}.${now() + ttl}`;
    return `${body}.${mac(body)}`;
  };
  function uidFromToken(token) {
    if (typeof token !== "string") return null;
    const i = token.lastIndexOf(".");
    if (i < 1) return null;
    const body = token.slice(0, i);
    const given = Buffer.from(token.slice(i + 1));
    const want = Buffer.from(mac(body));
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    const j = body.lastIndexOf(".");
    if (j < 1 || Number(body.slice(j + 1)) < now()) return null;
    return body.slice(0, j);
  }
  /** Teachers are looked up; any other (validly signed) uid is an anonymous student. A switched-off teacher is nobody. */
  function userFor(uid) {
    const row = accounts.getUser(uid);
    if (row) return Accounts.publicUser(row);
    if (accounts.db.prepare("SELECT 1 FROM users WHERE uid = ?").get(uid)) return null;
    return { uid, email: null, isAnonymous: true, isAdmin: false };
  }
  const tokenTtl = (user) => (user.isAnonymous ? STUDENT_TOKEN_MS : TEACHER_TOKEN_MS);

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/healthz") {
      try {
        store.getMeta("secret");
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      } catch {
        res.writeHead(500, { "content-type": "text/plain" }).end("database error");
      }
      return;
    }
    if (nextHandler) return nextHandler(req, res);
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  });

  const clients = new Set();

  function evaluate(sub) {
    if (sub.kind === "doc") return { doc: store.getDoc(sub.path) };
    return { docs: runQuery(store.listColl(sub.path), sub.spec) };
  }

  function sendSnap(c, sid, sub, force, cache) {
    let payload;
    if (cache) {
      const k = `${sub.kind}|${sub.path}|${sub.kind === "query" ? JSON.stringify(sub.spec) : ""}`;
      if (!cache.has(k)) cache.set(k, JSON.stringify(evaluate(sub)));
      payload = cache.get(k);
    } else {
      payload = JSON.stringify(evaluate(sub));
    }
    if (!force && payload === sub.last) return;
    sub.last = payload;
    c.ws.send(`{"t":"snap","sid":${JSON.stringify(sid)},${payload.slice(1)}`);
  }

  function notify(changed) {
    const docs = new Set(changed);
    const colls = new Set(changed.map((p) => splitPath(p).coll));
    const cache = new Map();
    for (const c of clients) {
      for (const [sid, sub] of c.subs) {
        if (sub.kind === "doc" ? docs.has(sub.path) : colls.has(sub.path)) sendSnap(c, sid, sub, false, cache);
      }
    }
  }

  function requireAdmin(c) {
    if (!c.user?.isAdmin) throw new StoreError("permission-denied", "Administrators only.");
  }

  async function handle(c, text) {
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return c.ws.close(1003);
    }
    if (m === null || typeof m !== "object") return c.ws.close(1003);
    // A teacher is checked again on every message, so switching an account off takes effect at once.
    if (c.user && !c.user.isAnonymous) c.user = userFor(c.user.uid);
    const send = (o) => c.ws.send(JSON.stringify(o));
    const reply = (extra = {}) => send({ t: "res", rid: m.rid, ok: true, ...extra });
    const fail = (err) => send({ t: "res", rid: m.rid, ok: false, code: err.code, message: err.message });

    try {
      switch (m.t) {
        case "hello": {
          const uid = uidFromToken(m.token);
          c.user = uid ? userFor(uid) : null;
          return reply({ user: c.user });
        }
        case "anon": {
          const uid = randomBytes(14).toString("hex");
          c.user = userFor(uid);
          return reply({ user: c.user, token: signToken(uid, STUDENT_TOKEN_MS) });
        }
        case "signout": {
          c.user = null;
          return reply();
        }
        case "signup":
          throw new StoreError(
            "auth/operation-not-allowed",
            "Accounts are created by an administrator. Please use \"Request access\"."
          );
        case "login": {
          const email = String(m.email ?? "").trim().toLowerCase();
          if (!limiter.allow(`login:${email}`, 10, 15 * 60_000) || !limiter.allow(`login-ip:${c.ip}`, 60, 15 * 60_000)) {
            throw new StoreError("auth/too-many-requests", "Too many attempts. Please wait a few minutes.");
          }
          const row = await accounts.login(m.email, m.password);
          c.user = Accounts.publicUser(row);
          return reply({ user: c.user, token: signToken(row.uid, TEACHER_TOKEN_MS) });
        }
        case "access-request": {
          if (!limiter.allow(`request-ip:${c.ip}`, 5, 3600_000)) {
            throw new StoreError("auth/too-many-requests", "Too many requests from this address. Please try again later.");
          }
          const r = accounts.createRequest(m.email, m.name);
          if (r.created) log(`Access requested by ${r.email}${r.name ? ` (${r.name})` : ""}`);
          return reply(); // the same answer whatever happened, so the form reveals nothing about existing accounts
        }
        case "set-password": {
          if (!limiter.allow(`setpw-ip:${c.ip}`, 20, 3600_000)) {
            throw new StoreError("auth/too-many-requests", "Too many attempts. Please try again later.");
          }
          const row = await accounts.completeSetup(m.token, m.password);
          c.user = Accounts.publicUser(row);
          return reply({ user: c.user, token: signToken(row.uid, TEACHER_TOKEN_MS) });
        }
        case "admin-overview":
          requireAdmin(c);
          return reply({ requests: accounts.listRequests(), users: accounts.listUsers() });
        case "admin-approve":
          requireAdmin(c);
          return reply(accounts.approve(String(m.id)));
        case "admin-reject":
          requireAdmin(c);
          accounts.reject(String(m.id));
          return reply();
        case "admin-import":
          requireAdmin(c);
          return reply({ rows: accounts.importPeople(m.people) });
        case "admin-reset":
          requireAdmin(c);
          return reply(accounts.resetPassword(String(m.uid)));
        case "admin-disable":
          requireAdmin(c);
          if (m.uid === c.user.uid) throw new StoreError("invalid-argument", "You cannot switch off your own account.");
          accounts.setDisabled(String(m.uid), !!m.disabled);
          return reply();
        case "sub": {
          const sid = String(m.sid);
          try {
            if (c.subs.size >= 200) throw new StoreError("resource-exhausted", "Too many live queries");
            let sub;
            if (m.kind === "doc") {
              checkDocPath(m.path);
              sub = { kind: "doc", path: m.path };
            } else {
              checkCollPath(m.path);
              sub = { kind: "query", path: m.path, spec: parseSpec(m) };
            }
            rules.canRead(c.user, m.path, store);
            c.subs.set(sid, sub);
            sendSnap(c, sid, sub, true);
          } catch (err) {
            if (!(err instanceof StoreError)) throw err;
            send({ t: "suberr", sid, code: err.code, message: err.message });
          }
          return;
        }
        case "unsub":
          c.subs.delete(String(m.sid));
          return;
        case "get": {
          let sub;
          if (m.kind === "doc") {
            checkDocPath(m.path);
            sub = { kind: "doc", path: m.path };
          } else {
            checkCollPath(m.path);
            sub = { kind: "query", path: m.path, spec: parseSpec(m) };
          }
          rules.canRead(c.user, m.path, store);
          return reply(evaluate(sub));
        }
        case "commit": {
          rules.canWrite(c.user, m.writes, store);
          const changed = store.commit(m.writes, m.reads ?? {});
          notify(changed);
          return reply();
        }
        default:
          throw new StoreError("invalid-argument", `Unknown message: ${m.t}`);
      }
    } catch (err) {
      if (err instanceof StoreError) return fail(err);
      log("error", err);
      return fail(new StoreError("internal", "Server error"));
    }
  }

  attachWebSocket(server, {
    path: "/ws",
    onConnection(ws, req) {
      const forwarded = trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
      const c = { ws, user: null, subs: new Map(), ip: forwarded || req.socket.remoteAddress || "unknown" };
      clients.add(c);
      ws.on("message", (text) => {
        handle(c, text).catch((err) => log("error", err));
      });
      ws.on("close", () => clients.delete(c));
    },
  });

  return {
    server,
    store,
    accounts,
    adminSetups,
    listen(port, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    close() {
      for (const c of clients) c.ws.close(1001);
      return new Promise((resolve) => {
        server.close(() => {
          store.close();
          resolve();
        });
        server.closeAllConnections?.();
      });
    },
  };
}
